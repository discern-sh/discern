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
import type { GitWorktreePruneScan, OrphanWorktreeSweepScan } from "./git.ts";

// ── teardown ────────────────────────────────────────────────────────────────

/** What `worktree teardown` would destroy: this worktree's ledger entries, in the
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
  steps.push({
    kind: "refresh",
    label: "refresh agent files",
    disposition: "run",
    note: plan.to === "trunk"
      ? "re-materialize the trunk checkout's generated agent files + skills"
      : "re-materialize the review checkout's generated agent files + skills",
  });
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

/** The read-only diagnosis an integration acts on: which source ref is coming in
 * (the trunk by default, any ref via `--from`), how far behind the worktree
 * branch is, and whether it already contains the source (→ nothing to merge; the
 * refresh + ensure convergence still runs, so a re-run after a manual conflict
 * resolution restores everything the aborted merge skipped). The worktree
 * precondition is checked while BUILDING this — a plan only exists for an
 * integration that may proceed. */
export interface IntegratePlan {
  /** The source being merged in: the integration branch (`[project].main_branch`
   * / `MAIN_BRANCH`), or the `--from` ref. */
  source: string;
  /** Whether `source` came from an explicit `--from` (vs the trunk default). */
  fromOverride: boolean;
  /** The worktree's current branch (display only). */
  worktreeBranch: string;
  /** Commits the branch is behind the source (0 when already up to date). */
  behind: number;
  /** Whether the branch already contains the source (→ nothing to merge). */
  alreadyIntegrated: boolean;
  /** The `[worktree.setup].ensure` commands run after the merge + refresh,
   * to converge the worktree on the current tree (empty when none are declared). */
  ensureSteps: string[];
}

/**
 * Project an integration onto the shared renderer: merge the source ref,
 * re-materialize the agent files + skills, then re-run the convergent
 * `[worktree.setup].ensure` to converge the worktree on the merged tree. When the
 * branch already contains the source only the merge is `skip`ped — the refresh and
 * the ensure convergence run on EVERY pass (like session start), which is what
 * makes "re-run `discern integrate`" the recovery after a manually resolved
 * conflict: the no-op re-run restores the convergence the aborted merge skipped.
 */
export function integratePlanToEngine(plan: IntegratePlan): EnginePlan {
  const act = !plan.alreadyIntegrated;
  const steps: PlanStep[] = [
    {
      kind: "git",
      label: "merge",
      disposition: act ? "run" : "skip",
      note: act
        ? `merge ${plan.source} into ${plan.worktreeBranch}`
        : `already up to date with ${plan.source}`,
    },
    {
      kind: "refresh",
      label: "refresh agent files",
      disposition: "run",
      note: "re-materialize the generated agent files + skills",
    },
  ];
  for (const step of plan.ensureSteps) {
    steps.push({
      kind: "setup-ensure",
      label: step,
      disposition: "run",
      note: "converge the worktree on the current tree",
    });
  }
  return {
    title: "Integration plan",
    details: [
      `Branch:    ${plan.worktreeBranch}`,
      `Integrate: ${plan.source}`,
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
  /** The ref the new branch forks from — the trunk by default, any ref via
   * `--from` (the landing model's pull axis). */
  from: string;
  /** A normalisation/fallback note when the caller named the worktree (see
   * `chooseWorktreeName`) — surfaced in the dry-run preview so the caller sees the
   * name it would actually get. Absent for an unnamed (codename) start. */
  note?: string;
}

/** Project a start onto the shared renderer: create the worktree, then set it up. */
export function startPlanToEngine(plan: StartPlan): EnginePlan {
  const details = [
    `New worktree: ${plan.id}`,
    `Branch:       ${plan.branch}`,
    `From:         ${plan.from}`,
    `Path:         ${plan.worktreePath}`,
  ];
  if (plan.note !== undefined) {
    details.push(`Name:         ${plan.note}`);
  }
  return {
    title: "Start plan",
    details,
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
 * What `worktree prune` would reclaim — the carried read-only scans (stale
 * worktrees, fully-merged dangling branches, stale metadata, orphan directories)
 * plus the pure orphan-resource classification. The deliverable a dry-run renders
 * and the apply executor acts on.
 */
export interface PrunePlan {
  /** Git-worktree/branch/stale-metadata scan to apply exactly. */
  gitScan: GitWorktreePruneScan;
  /** Orphan-directory scan to apply exactly. */
  orphanScan: OrphanWorktreeSweepScan;
  /** Orphaned worktree resource ledger entries GC would reclaim. */
  resourceReclaims: LedgerItem[];
  /** Orphaned resource ledger entries kept as live, guarded, or opted out. */
  resourceReclaimsKept: number;
}

function pruneBranchesToDelete(scan: GitWorktreePruneScan): string[] {
  return [
    ...scan.worktreesToRemove.map((w) => w.branch).filter((b) => b !== ""),
    ...scan.branchesToDelete,
  ];
}

/** Project a prune plan onto the shared renderer, grouping by what is reclaimed. */
export function prunePlanToEngine(plan: PrunePlan): EnginePlan {
  const steps: PlanStep[] = [];
  for (const w of plan.gitScan.worktreesToRemove) {
    steps.push({
      kind: "git",
      label: w.path,
      disposition: "run",
      note: "remove stale worktree",
      group: "Worktrees",
    });
  }
  for (const b of pruneBranchesToDelete(plan.gitScan)) {
    steps.push({
      kind: "git",
      label: b,
      disposition: "run",
      note: "delete fully-merged branch",
      group: "Branches",
    });
  }
  for (const m of plan.gitScan.staleMetadata) {
    steps.push({
      kind: "git",
      label: m.path,
      disposition: "run",
      note: "prune stale git metadata",
      group: "Stale metadata",
    });
  }
  for (const d of plan.orphanScan.removable) {
    steps.push({
      kind: "git",
      label: d.path,
      disposition: "run",
      note: "reclaim orphan directory",
      group: "Orphan directories",
    });
  }
  for (const kept of plan.orphanScan.kept) {
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
      label: r.entry.resource_identity,
      disposition: "run",
      note: "reclaim orphaned resource",
      group: "Resources",
    });
  }
  const staleCount = plan.gitScan.staleMetadata.length;
  const details = staleCount === 0 ? [] : [
    `Stale metadata: ${staleCount} entr${staleCount === 1 ? "y" : "ies"}`,
  ];
  return { title: "Prune plan", details, steps };
}

/** True when a prune plan would change nothing (every scan came back empty). */
export function prunePlanIsEmpty(plan: PrunePlan): boolean {
  return plan.gitScan.worktreesToRemove.length === 0 &&
    pruneBranchesToDelete(plan.gitScan).length === 0 &&
    plan.gitScan.staleMetadata.length === 0 &&
    plan.orphanScan.removable.length === 0 &&
    plan.resourceReclaims.length === 0;
}
