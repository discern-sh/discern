/**
 * Minimal git inspection for the installer (ADR 0014).
 *
 * `upgrade` mutates managed files in place. If it goes wrong — a bad engine
 * change, an interrupted run, or simply a result the user dislikes — the clean
 * recovery is `git checkout`, which is only clean when the upgrade's changes are
 * the *only* uncommitted changes to tracked files. So `upgrade` refuses to run
 * against a tree with pre-existing uncommitted tracked changes (unless
 * `--allow-dirty`), keeping every upgrade trivially reversible.
 *
 * Untracked files are deliberately ignored: they do not interfere with reverting
 * the upgrade's tracked-file writes, and demanding a pristine tree (no scratch
 * files) would be needless friction. A directory that is not a git repository
 * cannot offer this safety net at all — the caller proceeds with a note rather
 * than blocking, since git is not a hard requirement of an install.
 */

/** Whether a working tree is clean enough that an upgrade stays revertible. */
import { runGit } from "../shared/subprocess.ts";
import { parsePorcelainZ } from "../shared/git_paths.ts";

export type WorktreeState =
  | { kind: "clean" }
  | { kind: "dirty"; changes: string[] }
  | { kind: "not-a-repo" };

/**
 * Inspect `cwd` for uncommitted changes to *tracked* files via
 * `git status --porcelain -z`. Untracked entries (`??`) are filtered out. A git
 * binary that is missing or errors (e.g. not a repository) yields `not-a-repo`,
 * never a throw — the caller decides what to do with each outcome.
 */
export async function worktreeState(
  cwd: string,
  opts: { env?: Record<string, string> } = {},
): Promise<WorktreeState> {
  // A failed run covers both "git not installed" and "not a git repository":
  // either way the upgrade has no git safety net, which is `not-a-repo`.
  const r = await runGit(["status", "--porcelain", "-z"], {
    cwd,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });
  if (!r.success) {
    return { kind: "not-a-repo" };
  }
  const changes = parsePorcelainZ(r.stdout)
    .filter((entry) => !entry.status.startsWith("??"))
    .map((entry) => `${entry.status} ${entry.path}`);
  return changes.length === 0 ? { kind: "clean" } : { kind: "dirty", changes };
}
