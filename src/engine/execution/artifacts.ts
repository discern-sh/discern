/** Immutable attempt artifacts survive checkout disposal. */
import { dirname, join } from "@std/path";
import { atomicReplaceText } from "../../shared/atomic_write.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { ArtifactSchema } from "../completion/evidence.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { withOperationLock } from "../operation_lock.ts";
import type { EnvironmentArtifact } from "./types.ts";

/** Resolve only the registered attempt lifetime, refusing symlink redirection. */
async function artifactPath(
  root: string,
  attemptId: string,
  path: string,
): Promise<string> {
  RecordIdSchema.parse(attemptId);
  const directory = await gitAdminStatePath(root, "completionArtifacts");
  if (directory === undefined) {
    throw new Error(
      "Common attempt storage is unavailable; retain the environment and restore Git administration.",
    );
  }
  let ancestor = directory;
  while (true) {
    try {
      if (await Deno.realPath(ancestor) !== ancestor) {
        throw new Error(`Artifact storage has a symlink ancestor: ${ancestor}`);
      }
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      ancestor = dirname(ancestor);
    }
  }
  let current = directory;
  for (const part of [attemptId, ...path.split("/")]) {
    current = join(current, part);
    try {
      if ((await Deno.lstat(current)).isSymlink) {
        throw new Error(`Artifact path is a symlink: ${current}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return current;
}

/** Publish complete bytes once; an existing different artifact remains untouched. */
export async function saveEnvironmentArtifact(
  root: string,
  subject: {
    readonly attempt_id: string;
    readonly candidate_id: string;
    readonly context: string;
  },
  name: string,
  value: unknown,
): Promise<EnvironmentArtifact> {
  const raw = JSON.stringify(value);
  const artifact = ArtifactSchema.parse({
    ...subject,
    path: `environment/${name}.json`,
    digest: await sha256Hex(raw),
    bytes: new TextEncoder().encode(raw).length,
  });
  await withOperationLock(root, { command: "accept" }, async () => {
    const path = await artifactPath(root, artifact.attempt_id, artifact.path);
    const old = await readTextIfExists(path);
    if (old !== undefined && old !== raw) {
      throw new Error(
        `Attempt artifact already contains different bytes: ${path}. Preserve it for recovery.`,
      );
    }
    if (old === undefined) {
      await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await atomicReplaceText(path, raw, { mode: 0o600, sync: true });
    }
  });
  return artifact;
}

/** Recovery consumes captured bytes only after verifying their receipt. */
export async function readEnvironmentArtifact(
  root: string,
  artifact: EnvironmentArtifact,
): Promise<unknown> {
  ArtifactSchema.parse(artifact);
  const path = await artifactPath(root, artifact.attempt_id, artifact.path);
  const raw = await Deno.readTextFile(path);
  if (
    await sha256Hex(raw) !== artifact.digest ||
    new TextEncoder().encode(raw).length !== artifact.bytes
  ) {
    throw new Error(
      `Attempt artifact failed its content check: ${path}. Retain the checkout and recover the recorded bytes.`,
    );
  }
  return JSON.parse(raw);
}

/** Journal coordinates are derived from the environment's current attempt. */
export async function readExecutionDocument(
  root: string,
  attemptId: string,
  name: "intent" | "installed",
): Promise<unknown> {
  const path = await artifactPath(root, attemptId, `environment/${name}.json`);
  return JSON.parse(await Deno.readTextFile(path));
}
