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
export type WorktreeState =
  | { kind: "clean" }
  | { kind: "dirty"; changes: string[] }
  | { kind: "not-a-repo" };

/**
 * Inspect `cwd` for uncommitted changes to *tracked* files via
 * `git status --porcelain`. Untracked entries (`??`) are filtered out. A git
 * binary that is missing or errors (e.g. not a repository) yields `not-a-repo`,
 * never a throw — the caller decides what to do with each outcome.
 */
export async function worktreeState(cwd: string): Promise<WorktreeState> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("git", {
      args: ["status", "--porcelain"],
      cwd,
      stdout: "piped",
      stderr: "null",
    }).output();
  } catch {
    return { kind: "not-a-repo" }; // git not installed or not runnable
  }
  if (!output.success) {
    return { kind: "not-a-repo" }; // not a git repository
  }
  const changes = new TextDecoder()
    .decode(output.stdout)
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("??"));
  return changes.length === 0 ? { kind: "clean" } : { kind: "dirty", changes };
}
