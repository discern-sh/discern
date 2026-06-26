/**
 * The worktree lifecycle's **plan types and pure projections** (ADR 0027). Each
 * effectful worktree verb — setup, teardown, graduate, prune — describes what it
 * would do as a typed plan, then a thin executor in `lifecycle.ts` applies it.
 * Building a plan does only read-only I/O (resolve identity, read the ledger,
 * scan git); the executors own every mutation.
 *
 * The plan TYPES and their projection to the shared {@link EnginePlan} live here
 * (pure, no I/O — unit-testable and importable without pulling in the git layer);
 * the BUILDERS that gather the read-only state and the EXECUTORS that mutate live
 * with the rest of the lifecycle in `lifecycle.ts`.
 */

import type { EnginePlan, PlanStep } from "../../shared/result.ts";
import type { GraduateTarget } from "../../shared/config_schema.ts";
import type { LedgerItem } from "./resources.ts";

// ── teardown ────────────────────────────────────────────────────────────────

/** What `worktree:teardown` would destroy: this worktree's ledger entries, in the
 * reverse-creation order they will be destroyed in. */
export interface TeardownPlan {
  /** Ledger entries for this worktree, sorted for destruction (reverse seq). */
  entries: LedgerItem[];
}

/** Project a teardown plan onto the shared renderer. */
export function teardownPlanToEngine(plan: TeardownPlan): EnginePlan {
  return {
    title: "Teardown plan",
    details: [],
    steps: plan.entries.map((item): PlanStep => ({
      kind: "resource-destroy",
      label: item.entry.resource_name,
      disposition: "run",
      note: item.entry.resource_identity,
    })),
  };
}

// ── graduate ──────────────────────────────────────────────────────────────────

/** The read-only diagnosis a graduation acts on. The preconditions (behind main,
 * dirty main) are checked while BUILDING this — a plan only exists for a
 * graduation that may proceed. */
export interface GraduatePlan {
  /** Where the branch lands: `"branch"` (review-first, branch preserved) or
   * `"trunk"` (fast-forward the trunk and delete the now-merged branch). */
  to: GraduateTarget;
  worktreeBranch: string;
  worktreePath: string;
  mainRepo: string;
  mainBranch: string;
  /** The trunk a `--to trunk` graduation fast-forwards (`[project].main_branch`). */
  trunk: string;
  /** Whether the worktree has uncommitted changes (→ a WIP-commit/unstage dance). */
  worktreeDirty: boolean;
  /** Whether any external resource is declared (→ a teardown step). */
  hasResources: boolean;
}

/**
 * Project a graduation onto the shared renderer: the ordered mutations it will
 * perform. The dirty-worktree WIP-commit/unstage steps appear only when the
 * worktree is dirty, mirroring the executor.
 */
export function graduatePlanToEngine(plan: GraduatePlan): EnginePlan {
  const steps: PlanStep[] = [];
  steps.push({
    kind: "resource-destroy",
    label: "teardown resources",
    disposition: plan.hasResources ? "run" : "skip",
    note: plan.hasResources
      ? "destroy this worktree's external resources"
      : "no resources declared",
  });
  if (plan.worktreeDirty) {
    steps.push({
      kind: "git",
      label: "wip-commit",
      disposition: "run",
      note: "commit leftover uncommitted changes as WIP",
    });
  }
  steps.push({
    kind: "git",
    label: "remove-worktree",
    disposition: "run",
    note: plan.worktreePath,
  });
  if (plan.to === "trunk") {
    // Land on the trunk: fast-forward it to the branch tip (always clean — the
    // gate guarantees the branch contains the trunk), then delete the merged branch.
    steps.push({
      kind: "git",
      label: "fast-forward-trunk",
      disposition: "run",
      note: `${plan.trunk} → ${plan.worktreeBranch} in ${plan.mainRepo}`,
    });
    steps.push({
      kind: "git",
      label: "delete-branch",
      disposition: "run",
      note: `${plan.worktreeBranch} (merged into ${plan.trunk})`,
    });
  } else {
    steps.push({
      kind: "git",
      label: "checkout",
      disposition: "run",
      note: `${plan.worktreeBranch} in ${plan.mainRepo}`,
    });
  }
  if (plan.worktreeDirty) {
    steps.push({
      kind: "git",
      label: "unstage-wip",
      disposition: "run",
      note: "soft-reset so the changes land staged-but-uncommitted",
    });
  }
  const landing = plan.to === "trunk"
    ? `Into trunk:    ${plan.mainRepo} (fast-forward ${plan.trunk}, delete ${plan.worktreeBranch})`
    : `Into main:     ${plan.mainRepo} (on ${plan.mainBranch})`;
  return {
    title: "Graduation plan",
    details: [
      `Branch:        ${plan.worktreeBranch}`,
      `From worktree: ${plan.worktreePath}`,
      landing,
    ],
    steps,
  };
}

// ── setup ─────────────────────────────────────────────────────────────────────

/** One step a worktree setup would perform — precomputed from the config so the
 * plan lists exactly what setup will do (and a dry-run touches nothing). */
export interface SetupStepDesc {
  kind: PlanStep["kind"];
  label: string;
  note?: string | undefined;
}

/** What `worktree` (setup) would do, derived from the config + resolved identity. */
export interface SetupPlan {
  /** The branch the worktree will be put on. */
  branch: string;
  steps: SetupStepDesc[];
}

/** Project a setup plan onto the shared renderer (every step runs). */
export function setupPlanToEngine(plan: SetupPlan): EnginePlan {
  return {
    title: "Worktree setup plan",
    details: [`Branch: ${plan.branch}`],
    steps: plan.steps.map((s): PlanStep => ({
      kind: s.kind,
      label: s.label,
      disposition: "run",
      note: s.note,
    })),
  };
}

// ── prune ─────────────────────────────────────────────────────────────────────

/**
 * What `worktree:prune` would reclaim — the result of the read-only scans (stale
 * worktrees, fully-merged dangling branches, orphan directories) plus the pure
 * orphan-resource classification. The deliverable a dry-run renders and the apply
 * executor acts on.
 */
export interface PrunePlan {
  /** Stale worktree directories git would remove. */
  worktreesToRemove: string[];
  /** Fully-merged dangling branches that would be deleted. */
  branchesToDelete: string[];
  /** Orphan gitlinked directories that would be reclaimed. */
  orphanDirs: string[];
  /** Orphaned worktree resources GC would reclaim (handle labels). */
  resourceReclaims: string[];
}

/** Project a prune plan onto the shared renderer, grouping by what is reclaimed. */
export function prunePlanToEngine(plan: PrunePlan): EnginePlan {
  const steps: PlanStep[] = [];
  for (const w of plan.worktreesToRemove) {
    steps.push({
      kind: "git",
      label: w,
      disposition: "run",
      note: "remove stale worktree",
      group: "Worktrees",
    });
  }
  for (const b of plan.branchesToDelete) {
    steps.push({
      kind: "git",
      label: b,
      disposition: "run",
      note: "delete fully-merged branch",
      group: "Branches",
    });
  }
  for (const d of plan.orphanDirs) {
    steps.push({
      kind: "git",
      label: d,
      disposition: "run",
      note: "reclaim orphan directory",
      group: "Orphan directories",
    });
  }
  for (const r of plan.resourceReclaims) {
    steps.push({
      kind: "resource-destroy",
      label: r,
      disposition: "run",
      note: "reclaim orphaned resource",
      group: "Resources",
    });
  }
  return { title: "Prune plan", details: [], steps };
}

/** True when a prune plan would change nothing (every scan came back empty). */
export function prunePlanIsEmpty(plan: PrunePlan): boolean {
  return plan.worktreesToRemove.length === 0 &&
    plan.branchesToDelete.length === 0 &&
    plan.orphanDirs.length === 0 &&
    plan.resourceReclaims.length === 0;
}
