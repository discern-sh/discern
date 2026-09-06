/** Read-only attempt provenance; identity reads must not load mutation capabilities. */
import { dirname, join } from "@std/path";
import type { z } from "@zod/zod";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { ArtifactSchema } from "../completion/evidence.ts";
import { RecordIdSchema } from "../completion/identity.ts";

/** Resolve only the registered attempt lifetime, refusing symlink redirection. */
export async function artifactPath(
  root: string,
  attemptId: string,
  path: string,
): Promise<string> {
  root = await Deno.realPath(root);
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
