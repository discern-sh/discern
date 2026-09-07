/** Resolve registered attempt coordinates once for one operation; recheck containment on every use. */
import { dirname, join } from "@std/path";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
} from "../../shared/git_admin_state.ts";
import { ArtifactPathSchema } from "./evidence.ts";
import { RecordIdSchema } from "./identity.ts";

export type ArtifactPathResolver = (
  attemptId: string,
  path: string,
) => Promise<string>;

/** Retain only the common directory; containment is checked for each coordinate.
 * A publisher may supply the directory from its currently locked write preflight. */
export async function openArtifactPaths(
  root: string,
  commonGitDirectory?: string,
): Promise<ArtifactPathResolver> {
  const directory = commonGitDirectory === undefined
    ? await gitAdminStatePath(await Deno.realPath(root), "completionArtifacts")
    : join(commonGitDirectory, GIT_ADMIN_STATE.completionArtifacts.path);
  if (directory === undefined) {
    throw new Error(
      "Common attempt storage is unavailable; retain the environment and restore Git administration.",
    );
  }
  return async (attemptId, path) => {
    RecordIdSchema.parse(attemptId);
    ArtifactPathSchema.parse(path);
    let ancestor = directory;
    while (true) {
      try {
        if (await Deno.realPath(ancestor) !== ancestor) {
          throw new Error(
            `Artifact storage has a symlink ancestor: ${ancestor}`,
          );
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
  };
}

/** Single reads open their own path scope; no root or byte cache crosses operations. */
export async function artifactPath(
  root: string,
  attemptId: string,
  path: string,
): Promise<string> {
  return await (await openArtifactPaths(root))(attemptId, path);
}
