/**
 * Link the private documentation overlay into a linked worktree.
 *
 * `project/map/_private/` lives only in the main checkout (after the public
 * launch it is a separate private repository cloned there, gitignored here).
 * Linked worktrees receive it as a symlink so the same canonical path works
 * everywhere and edits land in the private clone. Run from
 * `[worktree.setup].ensure` on every linked-worktree setup pass, this script:
 *
 *  - derives the main checkout from `git rev-parse --git-common-dir`;
 *  - exits 0 silently unless the main checkout has the overlay, this is a
 *    linked worktree, and the worktree lacks a healthy link — a clean public
 *    clone sees a quiet no-op;
 *  - never touches a real (non-symlink) directory at the target, so a
 *    checkout whose `_private` files are still tracked is left alone;
 *  - replaces a broken or mispointed symlink with a healthy one.
 */

import { dirname, join, resolve } from "@std/path";
import { directoryExists, lstatIfExists } from "../src/shared/fs_presence.ts";
import { runGit } from "../src/shared/subprocess.ts";

/** The overlay's canonical repository-relative path. */
const OVERLAY_REL = "project/map/_private";

/** Run a git query; undefined when git is unavailable or the query fails. */
async function gitQuery(args: string[]): Promise<string | undefined> {
  try {
    // The setup hook deliberately grants only --allow-run=git, not env access.
    const output = await runGit(args, {
      cwd: Deno.cwd(),
      bin: "git",
      environmentPermissionFallback: "isolated-read-only",
    });
    if (!output.success) return undefined;
    return output.stdout.trim();
  } catch {
    // discern-best-effort: private-docs-git-query-fallback
    return undefined;
  }
}

const commonDir = await gitQuery(["rev-parse", "--git-common-dir"]);
const topLevel = await gitQuery(["rev-parse", "--show-toplevel"]);
if (commonDir === undefined || topLevel === undefined) Deno.exit(0);

const mainRoot = dirname(resolve(Deno.cwd(), commonDir));
const checkoutRoot = resolve(Deno.cwd(), topLevel);
if (mainRoot === checkoutRoot) Deno.exit(0); // the main checkout itself

const source = join(mainRoot, OVERLAY_REL);
if (!(await directoryExists(source))) Deno.exit(0); // no overlay to link

const target = join(checkoutRoot, OVERLAY_REL);
const targetInfo = await lstatIfExists(target);

if (targetInfo !== undefined && !targetInfo.isSymlink) Deno.exit(0);

if (targetInfo?.isSymlink === true) {
  const pointsAt = resolve(dirname(target), await Deno.readLink(target));
  if (pointsAt === source && await directoryExists(target)) Deno.exit(0);
  await Deno.remove(target);
}

await Deno.symlink(source, target, { type: "dir" });
