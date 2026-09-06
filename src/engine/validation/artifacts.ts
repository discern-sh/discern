import { sha256Hex } from "../../shared/sha256.ts";
/** Attempt-owned artifact capture and read-only byte verification. */
import { dirname, relative } from "@std/path";
import {
  ArtifactPathSchema,
  ArtifactSchema,
  type ComponentEvidence,
} from "../completion/evidence.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { lstatIfExists } from "../../shared/fs_presence.ts";
import { resolveContainedProjectWritePath } from "../../shared/project_path.ts";
import { readCompleteCapture } from "../jobs/captured.ts";
import { artifactKey } from "./selection.ts";

/** Hash exact binary bytes for immutable artifact addressing. */
export async function bytesDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Observe file identity before and after a producer to reject stale mutable output. */
export async function artifactStamp(
  root: string,
  path: string,
): Promise<string | null> {
  const safe = await resolveContainedProjectWritePath(
    root,
    ArtifactPathSchema.parse(path),
    "producer artifact",
  );
  const info = await lstatIfExists(safe);
  if (info === undefined) return null;
  if (!info.isFile) throw new Error("producer artifact is not a regular file");
  return JSON.stringify([
    info.dev,
    info.ino,
    info.size,
    info.mtime?.getTime(),
    info.ctime?.getTime(),
    await bytesDigest(await readCompleteCapture(safe)),
  ]);
}

/** Resolve an attempt coordinate without following symbolic links or creating storage. */
async function artifactPath(
  root: string,
  attempt: string,
  path: string,
): Promise<string> {
  const directory = await gitAdminStatePath(root, "completionArtifacts");
  if (directory === undefined) {
    throw new Error("completion artifact storage is unavailable");
  }
  // Resolve from existing common administration so absent attempt directories remain read-only.
  let anchor = dirname(directory);
  while (await lstatIfExists(anchor) === undefined) anchor = dirname(anchor);
  return await resolveContainedProjectWritePath(
    anchor,
    `${relative(anchor, directory)}/${RecordIdSchema.parse(attempt)}/${
      ArtifactPathSchema.parse(path)
    }`,
    "attempt artifact",
  );
}

/** The retained protocol output coordinate shared by capture and diagnostic readers. */
export async function protocolOutputPath(label: string): Promise<string> {
  return `output/${await sha256Hex(label)}/stdout.log`;
}

/** Publish once with createNew: mutable paths never become evidence coordinates. */
export async function retainArtifact(
  root: string,
  subject: Pick<ComponentEvidence, "attempt_id" | "candidate_id"> & {
    readonly context: string;
  },
  path: string,
  bytes: Uint8Array,
): Promise<ComponentEvidence["artifacts"][number]> {
  const artifact = ArtifactSchema.parse({
    ...subject,
    path,
    digest: await bytesDigest(bytes),
    bytes: bytes.length,
  });
  const destination = await artifactPath(root, subject.attempt_id, path);
  await Deno.mkdir(dirname(destination), { recursive: true });
  const file = await Deno.open(destination, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written === 0) throw new Error("incomplete attempt artifact capture");
      offset += written;
    }
    await file.sync();
  } finally {
    file.close();
  }
  return artifact;
}

/** Capture a freshly produced, stable file into its attempt's immutable storage. */
export async function captureProducedArtifact(
  root: string,
  subject: Pick<ComponentEvidence, "attempt_id" | "candidate_id"> & {
    readonly context: string;
  },
  path: string,
  previous: string | null,
): Promise<ComponentEvidence["artifacts"][number]> {
  const current = await artifactStamp(root, path);
  if (current === null || current === previous) {
    throw new Error(`missing or stale mutable producer artifact '${path}'`);
  }
  const safe = await resolveContainedProjectWritePath(
    root,
    path,
    "producer artifact",
  );
  const bytes = await readCompleteCapture(safe);
  if (await artifactStamp(root, path) !== current) {
    throw new Error("producer artifact changed during capture");
  }
  return await retainArtifact(root, subject, path, bytes);
}

/** Verify captured length and digest before exposing artifact bytes. */
export async function readArtifact(
  root: string,
  artifact: ComponentEvidence["artifacts"][number],
): Promise<Uint8Array> {
  ArtifactSchema.parse(artifact);
  const bytes = await readCompleteCapture(
    await artifactPath(root, artifact.attempt_id, artifact.path),
  );
  if (
    bytes.length !== artifact.bytes ||
    await bytesDigest(bytes) !== artifact.digest
  ) throw new Error("attempt artifact bytes do not match their evidence");
  return bytes;
}

/** Audit stored bytes; only complete matching artifacts join the eligible set. */
export async function auditArtifacts(
  root: string,
  evidence: readonly ComponentEvidence[],
): Promise<ReadonlySet<string>> {
  const audited = new Set<string>();
  for (const component of evidence) {
    for (const artifact of component.artifacts) {
      const [result] = await Promise.allSettled([readArtifact(root, artifact)]);
      if (result?.status === "fulfilled") audited.add(artifactKey(artifact));
    }
  }
  return audited;
}
