/** Immutable attempt artifacts survive checkout disposal. */
import { dirname } from "@std/path";
import { atomicReplaceText } from "../../shared/atomic_write.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { ArtifactSchema } from "../completion/evidence.ts";
import { withOperationLock } from "../operation_lock.ts";
import type { EnvironmentArtifact } from "./types.ts";
import { artifactPath } from "./artifact_read.ts";

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
