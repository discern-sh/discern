/**
 * Recorded landed branches whose final deletion a landing could not finish —
 * the scan that re-verifies each bounded landing record against live refs,
 * and the apply that settles every disposition through the shared deletion
 * chokepoint. `worktree prune` consumes both; recording them is the deletion
 * chokepoint's own act in `ownership.ts`.
 *
 * The two Git predicates the scan needs live in `git.ts`, which itself
 * consumes this module, so the caller injects them instead of importing back.
 */

import type { Logger } from "../../lib/log.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import {
  clearRetiredWorktreeBranch,
  readRetiredWorktreeBranchRecords,
} from "./retired_paths.ts";
import { deleteAutomaticallyOwnedBranch } from "./ownership.ts";

/** How prune settles one recorded landed branch whose deletion is outstanding. */
export type OrphanedLandedBranchDisposition = "delete" | "clear" | "blocked";

/**
 * One landed branch a landing record proves discern owned, re-verified against
 * live refs at scan time: `delete` finishes the recorded deletion, `clear`
 * retires a record live state has superseded, `blocked` keeps both until the
 * named condition changes.
 */
export interface OrphanedLandedBranch {
  readonly branch: string;
  readonly expectedCommit: string;
  readonly mergedInto: string;
  readonly recordedAt: string;
  readonly disposition: OrphanedLandedBranchDisposition;
  readonly reason: string;
}

/** The Git facts the scan verifies through the caller's own readers. */
export interface LandedBranchScanDeps {
  readonly localBranchExists: (
    repoRoot: string,
    branch: string,
  ) => Promise<boolean>;
  readonly commitIsMerged: (
    repoRoot: string,
    commit: string,
    target: string,
  ) => Promise<boolean>;
}

/** One quiesced Git read for this module's ref inspections. */
function git(args: string[], cwd: string): Promise<GitResult> {
  return runGit(args, { cwd, quiesceDescendants: true });
}

/**
 * Re-verify every stored landing record against live refs, read-only. A
 * record enters the deletable set only when the branch still sits at the
 * recorded tip, is not checked out, and that tip is still reachable from the
 * recorded merge target — the same facts the landing verified before its ref
 * update failed. Superseded records are marked for clearing; uncertain ones
 * stay blocked with the condition that must change.
 */
export async function scanOrphanedLandedBranches(
  repoRoot: string,
  mainBranch: string,
  scheduledBranches: ReadonlySet<string>,
  checkedOutBranches: ReadonlySet<string>,
  deps: LandedBranchScanDeps,
): Promise<OrphanedLandedBranch[]> {
  const candidates: OrphanedLandedBranch[] = [];
  for (const record of await readRetiredWorktreeBranchRecords(repoRoot)) {
    if (scheduledBranches.has(record.branch)) {
      // The branch's own worktree removal is planned this run; its ordinary
      // deletion settles the record through the shared deletion chokepoint.
      continue;
    }
    const base = {
      branch: record.branch,
      expectedCommit: record.expected_commit,
      mergedInto: record.merged_into,
      recordedAt: record.recorded_at,
    };
    if (record.branch === mainBranch) {
      candidates.push({
        ...base,
        disposition: "clear",
        reason: "the trunk is never deleted, so the record cannot apply",
      });
      continue;
    }
    if (checkedOutBranches.has(record.branch)) {
      candidates.push({
        ...base,
        disposition: "clear",
        reason: "the branch is checked out again",
      });
      continue;
    }
    const current = await git(
      ["rev-parse", "--verify", `refs/heads/${record.branch}^{commit}`],
      repoRoot,
    );
    if (!current.success) {
      const exists = await git(
        ["show-ref", "--verify", "--quiet", `refs/heads/${record.branch}`],
        repoRoot,
      );
      candidates.push(
        exists.code === 1
          ? {
            ...base,
            disposition: "clear",
            reason: "the branch is already gone",
          }
          : {
            ...base,
            disposition: "blocked",
            reason: current.stderr.trim() ||
              "Git could not inspect the branch",
          },
      );
      continue;
    }
    if (current.stdout.trim() !== record.expected_commit) {
      candidates.push({
        ...base,
        disposition: "clear",
        reason: "the branch moved after its landing was recorded",
      });
      continue;
    }
    if (!(await deps.localBranchExists(repoRoot, record.merged_into))) {
      candidates.push({
        ...base,
        disposition: "blocked",
        reason:
          `local branch '${record.merged_into}' is unavailable to prove the landing`,
      });
      continue;
    }
    if (
      !(await deps.commitIsMerged(
        repoRoot,
        record.expected_commit,
        record.merged_into,
      ))
    ) {
      candidates.push({
        ...base,
        disposition: "blocked",
        reason:
          `the recorded tip is no longer reachable from ${record.merged_into}, so the branch is kept`,
      });
      continue;
    }
    candidates.push({
      ...base,
      disposition: "delete",
      reason:
        `landed into ${record.merged_into}; only the branch deletion remained`,
    });
  }
  return candidates;
}

/** The apply outcome `worktree prune` folds into its own result. */
export interface LandedBranchApplyResult {
  readonly deleted: string[];
  readonly records: {
    branch: string;
    action: "cleared" | "kept";
    reason: string;
  }[];
  readonly failed: boolean;
}

/**
 * Settle every scanned disposition: clear superseded records, keep blocked
 * ones loudly, and finish each recorded deletion through the shared deletion
 * chokepoint, whose compare-and-swap re-runs at apply time and clears the
 * landing record itself.
 */
export async function applyOrphanedLandedBranches(
  repoRoot: string,
  candidates: readonly OrphanedLandedBranch[],
  log: Logger,
): Promise<LandedBranchApplyResult> {
  const deleted: string[] = [];
  const records: LandedBranchApplyResult["records"] = [];
  let failed = false;
  for (const candidate of candidates) {
    if (candidate.disposition === "clear") {
      await clearRetiredWorktreeBranch(repoRoot, candidate.branch);
      log.line(
        `Cleared the landed-branch record for ${candidate.branch} (${candidate.reason}).`,
      );
      records.push({
        branch: candidate.branch,
        action: "cleared",
        reason: candidate.reason,
      });
      continue;
    }
    if (candidate.disposition === "blocked") {
      log.warn(
        `Kept the landed-branch record for ${candidate.branch}: ${candidate.reason}.`,
      );
      records.push({
        branch: candidate.branch,
        action: "kept",
        reason: candidate.reason,
      });
      continue;
    }
    log.line(`Deleting landed branch ${candidate.branch}...`);
    const outcome = await deleteAutomaticallyOwnedBranch({
      repoRoot,
      branch: candidate.branch,
      expectedCommit: candidate.expectedCommit,
      ownership: { kind: "landing-record", branch: candidate.branch },
      mergedInto: candidate.mergedInto,
    });
    if (outcome.kind === "deleted" || outcome.kind === "absent") {
      // Either way the recorded deletion is settled, and the shared deletion
      // chokepoint has already cleared the landing record.
      deleted.push(candidate.branch);
    } else if (outcome.refusal === "unavailable") {
      failed = true;
      log.error(
        `Could not finish deleting landed branch ${candidate.branch}: ${outcome.reason}. ` +
          "The landing record is kept; fix the cause and re-run `discern worktree prune`.",
      );
      records.push({
        branch: candidate.branch,
        action: "kept",
        reason: outcome.reason,
      });
    } else {
      log.warn(
        `Skipped landed branch ${candidate.branch}: ${outcome.reason}. ` +
          "The landing record is kept for the next scan to settle.",
      );
      records.push({
        branch: candidate.branch,
        action: "kept",
        reason: outcome.reason,
      });
    }
  }
  return { deleted, records, failed };
}
