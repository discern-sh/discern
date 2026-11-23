/**
 * The work-tree probe, answered from operation-scoped discovery.
 *
 * Several independent readers ask Git the same question before doing anything
 * else: is this directory inside a work tree? Inside one discern operation the
 * answer cannot change without a topology change, which discovery already
 * tracks, so the probe replays the retained answer instead of spawning Git
 * again. Outside an operation it runs the exact query.
 */

import {
  discoverGit,
  type GitDiscoveryResult,
  type GitDiscoveryRunner,
} from "./git_discovery.ts";
import { runGit } from "./subprocess.ts";

/**
 * Ask whether `cwd` is inside a Git work tree. The result has the shape of
 * `git rev-parse --is-inside-work-tree`: success with `true` inside a work
 * tree; anything else means it is not one.
 */
export async function probeInsideWorkTree(
  cwd: string,
  run: GitDiscoveryRunner = (dir, args) => runGit(args, { cwd: dir }),
): Promise<GitDiscoveryResult> {
  return await discoverGit(cwd, { kind: "inside-work-tree" }, run);
}
