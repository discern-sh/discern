/**
 * Git transaction for a completed upgrade.
 *
 * The clean-tree guard means every tracked change an upgrade leaves behind is
 * the upgrade's own, so discern composed the whole diff and commits it. This
 * module owns the before/after path accounting and the commit; it never
 * decides whether the upgrade itself succeeded, and a commit Git refuses
 * leaves the upgraded files in place for the owner to commit.
 */

import type { WorktreeState } from "../lib/git.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
  type DiscernProjectUpgradeCommitValues,
} from "../shared/discern_commit.ts";
import {
  literalPathspec,
  parsePorcelainZ,
  type PorcelainEntry,
} from "../shared/git_paths.ts";
import { runGit } from "../shared/subprocess.ts";
import { gitFailureLine } from "./setup_completion_git.ts";

/** What became of the upgrade's changes in Git. */
export type UpgradeCommitOutcome =
  /** discern committed exactly `paths`; `head` is that commit. */
  | { state: "committed"; head: string; paths: string[] }
  /** The upgrade changed no committable path, so there is nothing to commit. */
  | { state: "unchanged" }
  /** discern left the changes for the owner; `reason` says why. */
  | { state: "uncommitted"; reason: string }
  /** discern tried and could not commit `paths`; `reason` is the cause. */
  | { state: "failed"; reason: string; paths: string[] };

/** What the checkout held before the upgrade wrote anything. */
interface UpgradeCommitBaseline {
  /** The Git top level every reported path is relative to. */
  readonly toplevel: string;
  /** Untracked paths that predate the upgrade and stay the owner's. */
  readonly untracked: ReadonlySet<string>;
}

/** Whether this invocation will commit its changes, decided before it writes. */
export type UpgradeCommitPlan =
  | { kind: "commit"; baseline: UpgradeCommitBaseline }
  | { kind: "leave"; reason: string };

/** List every changed and untracked path, each untracked file on its own row. */
async function statusEntries(
  toplevel: string,
): Promise<PorcelainEntry[] | undefined> {
  const status = await runGit(
    ["status", "--porcelain", "-z", "--untracked-files=all"],
    { cwd: toplevel },
  );
  return status.success ? parsePorcelainZ(status.stdout) : undefined;
}

/**
 * Decide, before the upgrade writes, whether it will commit. The clean tree
 * the guard just proved is what makes the later diff wholly the upgrade's, so
 * a caller that bypassed the guard keeps the commit for themselves: their
 * changes and the upgrade's can share a path.
 */
export async function planUpgradeCommit(
  root: string,
  state: WorktreeState,
  allowDirty: boolean,
): Promise<UpgradeCommitPlan> {
  if (state.kind === "not-a-repo") {
    return { kind: "leave", reason: "This directory is not a Git repository." };
  }
  if (allowDirty) {
    return {
      kind: "leave",
      reason: "`--allow-dirty` leaves the commit to you.",
    };
  }
  const top = await runGit(["rev-parse", "--show-toplevel"], { cwd: root });
  const toplevel = top.stdout.replace(/\r?\n$/, "");
  const entries = top.success && toplevel !== ""
    ? await statusEntries(toplevel)
    : undefined;
  if (entries === undefined) {
    return {
      kind: "leave",
      reason: "Git could not report the checkout's state before the upgrade.",
    };
  }
  return {
    kind: "commit",
    baseline: {
      toplevel,
      untracked: new Set(
        entries.filter((entry) => entry.status === "??").map((entry) =>
          entry.path
        ),
      ),
    },
  };
}

/**
 * Commit what the upgrade changed: every tracked change, plus each file it
 * created. A file the owner had already left untracked stays untracked.
 * Every path comes from `git status`, which never lists an ignored untracked
 * file, so `--force` admits nothing new: it only stops Git exiting 1 after
 * staging a tracked file beneath a folder the project's ignore rules exclude.
 */
async function commitUpgradeChanges(
  baseline: UpgradeCommitBaseline,
  values: DiscernProjectUpgradeCommitValues,
): Promise<UpgradeCommitOutcome> {
  const cwd = baseline.toplevel;
  const entries = await statusEntries(cwd);
  if (entries === undefined) {
    return {
      state: "failed",
      reason: "Git could not report which paths the upgrade changed.",
      paths: [],
    };
  }
  const changed = new Set<string>();
  for (const entry of entries) {
    if (entry.status === "??" && baseline.untracked.has(entry.path)) continue;
    changed.add(entry.path);
    if (entry.origPath !== undefined) changed.add(entry.origPath);
  }
  const paths = [...changed].sort();
  if (paths.length === 0) return { state: "unchanged" };

  const branch = await runGit(["branch", "--show-current"], { cwd });
  if (branch.success && branch.stdout.trim() === "") {
    return {
      state: "failed",
      reason: "HEAD is detached, so there is no branch to commit to.",
      paths,
    };
  }
  const staged = await runGit(
    ["add", "-A", "--force", "--", ...paths.map(literalPathspec)],
    { cwd },
  );
  if (!staged.success) {
    return { state: "failed", reason: gitFailureLine(staged.stderr), paths };
  }
  const commit = await commitDiscernChanges({
    site: DISCERN_AUTHORED_COMMIT_SITES.projectUpgrade,
    values,
    cwd,
    pathspecs: paths,
  });
  if (!commit.success) {
    return { state: "failed", reason: gitFailureLine(commit.stderr), paths };
  }
  if (commit.owned === undefined) {
    return {
      state: "failed",
      reason:
        "Git created the commit without returning discern ownership evidence.",
      paths,
    };
  }
  return { state: "committed", head: commit.owned.head, paths };
}

/** Carry out the plan once the upgrade's own writes have finished. */
export async function settleUpgradeCommit(
  plan: UpgradeCommitPlan,
  completed: boolean,
  values: DiscernProjectUpgradeCommitValues,
): Promise<UpgradeCommitOutcome> {
  if (plan.kind === "leave") {
    return { state: "uncommitted", reason: plan.reason };
  }
  if (!completed) {
    return {
      state: "uncommitted",
      reason: "The upgrade did not complete, so discern committed nothing.",
    };
  }
  return await commitUpgradeChanges(plan.baseline, values);
}
