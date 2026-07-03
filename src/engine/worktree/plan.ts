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
import type { IgnoredFileChangeSummary } from "./ignored.ts";
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
 * dirty worktree, dirty main) are checked while BUILDING this — a plan only exists for a
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
  /** Whether any external resource is declared (→ a teardown step). */
  hasResources: boolean;
  /** Ignored-file drift detected against the setup-time baseline, when enabled. */
  ignoredFileChanges: IgnoredFileChangeSummary;
}

/**
 * Project a graduation onto the shared renderer: the ordered mutations it will
 * perform. Dirty worktrees are refused before a plan exists, so every graduation
 * plan lands committed history only.
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
  if (plan.to === "trunk") {
    // Land on the trunk: fast-forward it to the branch tip (always clean — the
    // gate guarantees the branch contains the trunk), then remove the worktree and
    // delete the merged branch.
    steps.push({
      kind: "git",
      label: "fast-forward-trunk",
      disposition: "run",
      note: `${plan.trunk} → ${plan.worktreeBranch} in ${plan.mainRepo}`,
    });
    steps.push({
      kind: "git",
      label: "remove-worktree",
      disposition: "run",
      note: plan.worktreePath,
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
      label: "remove-worktree",
      disposition: "run",
      note: plan.worktreePath,
    });
    steps.push({
      kind: "git",
      label: "checkout",
      disposition: "run",
      note: `${plan.worktreeBranch} in ${plan.mainRepo}`,
    });
  }
  const landing = plan.to === "trunk"
    ? `Into trunk:         ${plan.mainRepo} (fast-forward ${plan.trunk}, delete ${plan.worktreeBranch})`
    : `Into main checkout: ${plan.mainRepo} (on ${plan.mainBranch})`;
  const ignoredDetails = ignoredFileDetails(plan.ignoredFileChanges);
  return {
    title: "Graduation plan",
    details: [
      `Branch:        ${plan.worktreeBranch}`,
      `From worktree: ${plan.worktreePath}`,
      landing,
      ...ignoredDetails,
    ],
    steps,
  };
}

function ignoredFileDetails(summary: IgnoredFileChangeSummary): string[] {
  if (summary.status !== "changed" || summary.changed_total === 0) {
    return [];
  }
  const more = summary.truncated
    ? `, +${summary.changed_total - summary.changed_roots.length} more`
    : "";
  return [
    `Ignored files changed since setup: ${
      summary.changed_roots.join(", ")
    }${more}`,
  ];
}

// ── integrate ───────────────────────────────────────────────────────────────

/** The read-only diagnosis an integration acts on: which integration branch is
 * coming in, how far behind the worktree branch is, and whether it already
 * contains main (→ a no-op: merge + refresh both skip). The worktree precondition
 * is checked while BUILDING this — a plan only exists for an integration that may
 * proceed. */
export interface IntegratePlan {
  /** The integration branch being merged in (`[project].main_branch` / `MAIN_BRANCH`). */
  mainBranch: string;
  /** The worktree's current branch (display only). */
  worktreeBranch: string;
  /** Commits the branch is behind main (0 when already up to date). */
  behind: number;
  /** Whether the branch already contains main (→ a no-op: merge + refresh both skip). */
  alreadyIntegrated: boolean;
  /** The `[worktree.setup].ensure` commands run after a successful merge + refresh,
   * to converge the worktree on the merged tree (empty when none are declared). */
  ensureSteps: string[];
}

/**
 * Project an integration onto the shared renderer: merge the integration branch,
 * re-materialize the agent files + skills, then re-run the convergent
 * `[worktree.setup].ensure` to converge the worktree on the merged tree. When the
 * branch already contains main every step is `skip`ped (nothing to merge, so nothing
 * to refresh and no convergence needed).
 */
export function integratePlanToEngine(plan: IntegratePlan): EnginePlan {
  const act = !plan.alreadyIntegrated;
  const steps: PlanStep[] = [
    {
      kind: "git",
      label: "merge",
      disposition: act ? "run" : "skip",
      note: act
        ? `merge ${plan.mainBranch} into ${plan.worktreeBranch}`
        : `already up to date with ${plan.mainBranch}`,
    },
    {
      kind: "refresh",
      label: "refresh agent files",
      disposition: act ? "run" : "skip",
      note: act
        ? "re-materialize the generated agent files + skills"
        : "nothing merged — no refresh needed",
    },
  ];
  for (const step of plan.ensureSteps) {
    steps.push({
      kind: "setup-ensure",
      label: step,
      disposition: act ? "run" : "skip",
      note: act
        ? "converge the worktree on the merged tree"
        : "nothing merged — no convergence needed",
    });
  }
  return {
    title: "Integration plan",
    details: [
      `Branch:    ${plan.worktreeBranch}`,
      `Integrate: ${plan.mainBranch}`,
      plan.alreadyIntegrated
        ? "Status:    already up to date"
        : `Behind by: ${plan.behind} commit(s)`,
    ],
    steps,
  };
}

// ── start ─────────────────────────────────────────────────────────────────────

/** The plan a `discern start` would carry out: create a fresh linked worktree at a
 * resolved sibling location on its own branch, then run its first-time setup. The
 * id/branch are minted while building this (a fresh id each run), so the preview
 * shows concrete, representative values. */
export interface StartPlan {
  /** The freshly-minted worktree id. */
  id: string;
  /** The branch the new worktree is created on (`<branch_prefix><id>`). */
  branch: string;
  /** Where the new checkout lands (`<worktree_root>/<id>`). */
  worktreePath: string;
}

/** Project a start onto the shared renderer: create the worktree, then set it up. */
export function startPlanToEngine(plan: StartPlan): EnginePlan {
  return {
    title: "Start plan",
    details: [
      `New worktree: ${plan.id}`,
      `Branch:       ${plan.branch}`,
      `Path:         ${plan.worktreePath}`,
    ],
    steps: [
      {
        kind: "git",
        label: "add-worktree",
        disposition: "run",
        note: `${plan.worktreePath} on ${plan.branch}`,
      },
      {
        kind: "setup-step",
        label: "setup",
        disposition: "run",
        note:
          "ready the new worktree (branch, resources, env, port, agent files)",
      },
    ],
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
  /** Orphan gitlinked directories kept because they still contain local work. */
  orphanDirsKept: { path: string; reason: string }[];
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
  for (const kept of plan.orphanDirsKept) {
    steps.push({
      kind: "git",
      label: kept.path,
      disposition: "skip",
      note: kept.reason,
      group: "Kept orphan directories",
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
