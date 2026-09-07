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
