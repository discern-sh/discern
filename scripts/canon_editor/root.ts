/**
 * The repository root, derived from this module's own location so the
 * Canon Editor works identically under `deno task`, the project script, and a
 * test importing it from anywhere.
 */

import { fromFileUrl, join } from "@std/path";
import { statIfExists } from "../../src/shared/fs_presence.ts";

/** Absolute path of the repository this Canon Editor process edits. */
export const REPO_ROOT: string = join(
  fromFileUrl(import.meta.url),
  "..",
  "..",
  "..",
);

/**
 * The reason the editor may not serve from this root, or undefined when it
 * may. A linked worktree carries `.git` as a gitlink file; the main
 * checkout's is a directory, and the editor's write-back must never land on
 * the trunk's tree by a stray launch.
 */
export async function mainCheckoutIssue(
  root: string = REPO_ROOT,
): Promise<string | undefined> {
  if ((await statIfExists(join(root, ".git")))?.isFile) return undefined;
  return "Canon Editor edits the tree it runs in, so it only serves " +
    "from a worktree. Start one with `discern start` and launch the editor " +
    "there; `open <entry>` still works here, read-only.";
}
