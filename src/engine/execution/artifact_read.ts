import { readBoundedText } from "../../shared/bounded_file.ts";
import { EXECUTION_DOCUMENT_BYTES } from "./snapshot_schema.ts";
import { artifactPath } from "../completion/artifact_paths.ts";
export { artifactPath } from "../completion/artifact_paths.ts";
/** Read-only attempt provenance; identity reads must not load mutation capabilities. */
import type { z } from "@zod/zod";
import { sha256Hex } from "../../shared/sha256.ts";
import { ArtifactSchema } from "../completion/evidence.ts";

/** Recovery consumes captured bytes only after verifying their receipt. */
export async function readEnvironmentArtifact(
  root: string,
  artifact: z.infer<typeof ArtifactSchema>,
): Promise<unknown> {
  ArtifactSchema.parse(artifact);
  const path = await artifactPath(root, artifact.attempt_id, artifact.path);
  const raw = await readBoundedExecutionDocument(path);
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
  return JSON.parse(await readBoundedExecutionDocument(path));
}

/** Inline aggregates beyond the reader budget stay intact for explicit reconciliation. */
export async function readBoundedExecutionDocument(
  path: string,
): Promise<string> {
  const stat = await Deno.lstat(path);
  if (!stat.isFile || stat.isSymlink || stat.size > EXECUTION_DOCUMENT_BYTES) {
    throw new Error(
      `Recovery document is unsupported or exceeds the bounded reader at ${path}. Preserve its bytes and the retained checkout; reconcile this artifact with a compatible recovery reader.`,
    );
  }
  return await readBoundedText(path, EXECUTION_DOCUMENT_BYTES);
}
