/**
 * The landing's checkout preflight and post-landing cleanup — the pieces the
 * direct and integration executors share. The preflight proves the main
 * checkout is clean, idle, and on the trunk before any effect; the cleanup
 * removes the effort's resources, checkout, and branch exactly when the
 * branch holds nothing beyond what landed. This module never imports
 * `accept.ts` at runtime.
 */

import { commandEvidence } from "../../shared/command_evidence.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { BUILT_IN_STEP_LABELS } from "../../shared/result.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { ACCEPT_NOTHING_LANDED, short } from "./accept_support.ts";
import {
  inspectGitOperation,
  removeWorktreeSafely,
  WorktreeGitError,
} from "./git.ts";
import { teardownResources } from "./lifecycle.ts";
import { deleteAutomaticallyOwnedBranch } from "./ownership.ts";
import type { AcceptExecutionProgress, EffortCheckout } from "./accept.ts";

/** Git's own words for a failed command, with a status fallback. */
function gitFailureDetail(result: GitResult): string {
  return result.stderr.trim() || result.stdout.trim() ||
    `git exited with status ${result.code}`;
}

/** The refusal when the main checkout sits on a branch other than the trunk. */
function offTrunkAcceptRefusal(
  mainRepo: string,
  mainBranch: string,
  trunk: string,
): string {
  const switchCommand = commandEvidence([
    "git",
    "-C",
    mainRepo,
    "switch",
    trunk,
  ]);
  return `The main checkout at ${mainRepo} is on '${mainBranch}', not ` +
    `'${trunk}' (the trunk). Acceptance lands by fast-forwarding the trunk ` +
    `there, so return it first — \`${switchCommand}\` — ` +
    `then re-run \`discern accept\`. Your branch keeps all its commits.`;
}

/** The refusal when the trunk moved between this landing's reads. */
function inProgressMainCheckoutRefusal(
  mainRepo: string,
  operation: "rebase" | "merge" | "cherry-pick",
): string {
  const finish = commandEvidence([
    "git",
    "-C",
    mainRepo,
    operation,
    "--continue",
  ]);
  const abort = commandEvidence(["git", "-C", mainRepo, operation, "--abort"]);
  return `The main checkout at ${mainRepo} has an in-progress ${operation}. ` +
    `Acceptance will not move its trunk or switch branches. Finish it with ` +
    `\`${finish}\` or abort it with \`${abort}\`, then re-run \`discern accept\`. ` +
    `${ACCEPT_NOTHING_LANDED}`;
}

/** Assert the main checkout is clean, idle, and on the trunk. */
export async function assertMainCheckoutReady(
  effort: EffortCheckout,
): Promise<void> {
  const { mainRepo, trunk } = effort;
  const mainStatus = await runGit(
    ["status", "--porcelain", "-z", "--untracked-files=no"],
    { cwd: mainRepo, quiesceDescendants: true },
  );
  if (!mainStatus.success) {
    throw new WorktreeGitError(
      `discern could not read tracked status in the main checkout at ${mainRepo}. ${ACCEPT_NOTHING_LANDED} Repair that checkout, then re-run \`discern accept\`. Git said: ${
        gitFailureDetail(mainStatus)
      }`,
    );
  }
  const operation = await inspectGitOperation(mainRepo);
  if (operation.kind === "unavailable") {
    throw new WorktreeGitError(
      `discern could not inspect in-progress Git operations in the main checkout at ${mainRepo}. ${ACCEPT_NOTHING_LANDED} Repair that checkout, then re-run \`discern accept\`. Git said: ${operation.detail}`,
    );
  }
  if (operation.kind === "active") {
    throw new WorktreeGitError(
      inProgressMainCheckoutRefusal(mainRepo, operation.operation),
    );
  }
  const mainBranchRun = await runGit(["branch", "--show-current"], {
    cwd: mainRepo,
  });
  if (!mainBranchRun.success) {
    throw new WorktreeGitError(
      `discern could not read the current branch in the main checkout at ${mainRepo}. ${ACCEPT_NOTHING_LANDED} Repair that checkout, then re-run \`discern accept\`. Git said: ${
        gitFailureDetail(mainBranchRun)
      }`,
    );
  }
  const mainBranch = mainBranchRun.stdout.trim() !== ""
    ? mainBranchRun.stdout.trim()
    : "(detached)";
  if (parsePorcelainZ(mainStatus.stdout).length > 0) {
    throw new WorktreeGitError(
      `Main checkout at ${mainRepo} has uncommitted tracked changes on '${mainBranch}'. Commit or stash them, then re-run \`discern accept\`; acceptance will not move your main-checkout work for you. Your worktree branch '${effort.branch}' is untouched and still holds all its commits.`,
    );
  }
  if (mainBranch !== trunk) {
    throw new WorktreeGitError(
      offTrunkAcceptRefusal(mainRepo, mainBranch, trunk),
    );
  }
}

/** The landing's projected steps for one effort, from its own configuration. */
export type CleanupDisposition =
  | { readonly kind: "removed" }
  | {
    readonly kind: "resources-remain";
    /** The resources whose destroy command failed, still recorded for recovery. */
    readonly failed: readonly string[];
  }
  | { readonly kind: "later-commits" }
  | { readonly kind: "uncommitted-changes" };

/** Whether the disposition leaves the effort's checkout (and its worktree-scoped
 * state, such as the acceptance journal) on disk. */
export function cleanupKeepsCheckout(disposition: CleanupDisposition): boolean {
  return disposition.kind === "later-commits" ||
    disposition.kind === "uncommitted-changes";
}

/** Remove the effort's resources, checkout, and branch when nothing remains
 * beyond the landing. A failed resource destroy is retained (with its recovery
 * advisory) and reported as the `resources-remain` disposition, so the
 * result's first sentence can state the incomplete cleanup truthfully. */
export async function cleanUpEffort(
  effort: EffortCheckout,
  landed: string,
  progress: AcceptExecutionProgress,
  /** The author-branch revision the landing consumed — the submitted head.
   * For a direct landing it is the landed commit itself; for an integrated
   * landing the trunk holds a composed commit while the branch may still sit
   * exactly at its submission, which is equally "nothing beyond the
   * landing". */
  submittedHead: string = landed,
): Promise<CleanupDisposition> {
  const log = effort.ctx.log;
  const results = progress.steps;
  const tipRun = await runGit(
    ["rev-parse", "--verify", `refs/heads/${effort.branch}^{commit}`],
    { cwd: effort.mainRepo },
  );
  const tip = tipRun.success ? tipRun.stdout.trim() : "";
  if (tip !== submittedHead) return { kind: "later-commits" };
  const status = await runGit(["status", "--porcelain", "-z"], {
    cwd: effort.path,
    quiesceDescendants: true,
  });
  if (!status.success || status.stdout.trim() !== "") {
    return { kind: "uncommitted-changes" };
  }

  log.info("Tearing down the worktree's resources…");
  const teardown = await teardownResources(effort.ctx);
  results.push({
    step: {
      kind: "resource-destroy",
      label: BUILT_IN_STEP_LABELS.teardownResources,
      disposition: "run",
      note: teardown.failed.length === 0
        ? `${teardown.destroyed.length} resource(s) destroyed`
        : `resource teardown failed for: ${teardown.failed.join(", ")}`,
    },
    outcome: teardown.failed.length === 0 ? "ok" : "failed",
    ...(teardown.failed.length === 0 ? {} : {
      advisory: {
        kind: "acceptance-cleanup-incomplete" as const,
        evidence: teardown.failed.map((resource) =>
          `Worktree resource '${resource}' remains recorded for recovery.`
        ),
        next_action:
          "Run `discern worktree prune` from the main checkout after fixing the failed destroy command or its prerequisites.",
      },
    }),
  });

  log.info(`Removing worktree: ${effort.path}`);
  try {
    await removeWorktreeSafely(effort.path, effort.mainRepo);
  } catch (error) {
    throw new WorktreeGitError(
      `Landed ${effort.branch} at ${
        short(landed)
      } on ${effort.trunk}, but its checkout at ${effort.path} could not be removed: run discern worktree prune from ${effort.mainRepo} after fixing the cause. Removal reported: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  log.ok("Worktree directory removed.");
  results.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.removeWorktree,
      disposition: "run",
    },
    outcome: "ok",
  });
  progress.landing.worktree_removed = true;

  const ownership = {
    kind: "worktree" as const,
    branch: effort.branch,
    id: effort.id,
    settings: effort.settings,
    source: "registered" as const,
  };
  const deletion = await deleteAutomaticallyOwnedBranch({
    repoRoot: effort.mainRepo,
    branch: effort.branch,
    expectedCommit: submittedHead,
    ownership,
    mergedInto: effort.trunk,
  });
  if (deletion.kind === "refused") {
    const verifyBranch = commandEvidence([
      "git",
      "-C",
      effort.mainRepo,
      "rev-parse",
      "--verify",
      `refs/heads/${effort.branch}^{commit}`,
    ]);
    const deleteBranch = commandEvidence([
      "git",
      "-C",
      effort.mainRepo,
      "branch",
      "-d",
      effort.branch,
    ]);
    throw new WorktreeGitError(
      `Landed ${effort.branch} at ${
        short(landed)
      } on ${effort.trunk}, but Git could not delete the merged branch: ${deletion.reason}. Run discern worktree prune from ${effort.mainRepo}; to clean it by hand, run \`${verifyBranch}\` and, only if it still prints ${submittedHead}, \`${deleteBranch}\`. Do not rerun acceptance or replay consent.`,
    );
  }
  log.ok(`Deleted merged branch ${effort.branch}.`);
  results.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.deleteBranch,
      disposition: "run",
    },
    outcome: "ok",
  });
  progress.landing.branch_deleted = true;
  return teardown.failed.length === 0
    ? { kind: "removed" }
    : { kind: "resources-remain", failed: [...teardown.failed] };
}
