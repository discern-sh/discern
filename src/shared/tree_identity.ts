/**
 * The dirty-diff half of discern's "same exact tree" identity. A committed
 * tree is named by its HEAD sha alone; an uncommitted tree adds this
 * fingerprint — the POSIX cksum of `git diff HEAD` (tracked files only) — so
 * two runs over the same sha with the same uncommitted edits compare equal.
 *
 * One definition, two writers: the logbook stamps it into each event's `tree`
 * field (what a flake reader compares), and the gate stamps it into the
 * last-run marker (what the unchanged-tree rerun precondition compares). They
 * never read each other's records, but they must agree on what "the same exact
 * tree" means — sharing the function here is what keeps them agreeing.
 */

import { runGit } from "./subprocess.ts";
import { cksumString } from "./crc.ts";

/** Fingerprint the uncommitted diff at `root`, `undefined` when git cannot
 * answer. Hex form of the checksum; empty diff fingerprints too (a staged-only
 * or untracked-only tree still gets a stable value). */
export async function treeDiffFingerprint(
  root: string,
): Promise<string | undefined> {
  const diff = await runGit(["diff", "HEAD"], { cwd: root });
  if (!diff.success) {
    return undefined;
  }
  return cksumString(diff.stdout).toString(16);
}
