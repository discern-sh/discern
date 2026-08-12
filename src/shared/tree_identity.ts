/**
 * How two legacy/current consumers fingerprint recorded working state at two
 * precisions:
 *
 * - {@link treeDiffFingerprint} — the POSIX cksum of `git diff HEAD` (tracked
 *   files only). The logbook stamps it into each legacy event's `tree` field.
 *   It supports a deliberately weak tracked-start comparison; it is not a
 *   complete validation-input identity.
 * - {@link workingStateFingerprint} — the tracked diff PLUS every path
 *   `git status` reports (untracked included, `-uall`) with its size and
 *   mtime. The gate's last-run marker uses it because a REFUSAL rides on the
 *   comparison: an edit to an untracked file (a materialized artifact, a
 *   scratch input a job reads) must move the identity, or `done` would refuse
 *   a tree that genuinely changed. A same-size same-millisecond rewrite can
 *   still collide, which is why the refusal stays overridable by design.
 */

import { join } from "@std/path";
import { runGit } from "./subprocess.ts";
import { cksumString } from "./crc.ts";
import { parsePorcelainZ } from "./git_paths.ts";

/** The tracked-diff fingerprint of an otherwise dirty untracked-only tree. */
export const EMPTY_TREE_DIFF_FINGERPRINT = cksumString("").toString(16);

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
  return diff.stdout === ""
    ? EMPTY_TREE_DIFF_FINGERPRINT
    : cksumString(diff.stdout).toString(16);
}

/** Fingerprint everything uncommitted at `root` — the tracked diff plus a
 * (path, size, mtime) record for every status-reported path, untracked files
 * individually (`-uall`). `undefined` when git cannot answer. */
export async function workingStateFingerprint(
  root: string,
): Promise<string | undefined> {
  const diff = await runGit(["diff", "HEAD"], { cwd: root });
  if (!diff.success) {
    return undefined;
  }
  const status = await runGit(["status", "--porcelain", "-z", "-uall"], {
    cwd: root,
  });
  if (!status.success) {
    return undefined;
  }
  const stats: string[] = [];
  for (const entry of parsePorcelainZ(status.stdout)) {
    for (const path of [entry.origPath, entry.path]) {
      if (path === undefined) {
        continue;
      }
      try {
        const info = await Deno.stat(join(root, path));
        stats.push(`${path}\0${info.size}\0${info.mtime?.getTime() ?? 0}`);
      } catch {
        stats.push(`${path}\0gone`);
      }
    }
  }
  stats.sort();
  return cksumString(`${diff.stdout}\0${status.stdout}\0${stats.join("\0")}`)
    .toString(16);
}
