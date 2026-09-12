import { ignoredFileDetails } from "./ignored.ts";
/**
 * The worktree lifecycle's **plan types and pure projections** (ADR 0027). Each
 * effectful worktree verb — setup, teardown, accept, prune — describes what it
 * would do as a typed plan, then a thin executor in `lifecycle.ts` applies it.
 * Building a plan does only read-only I/O (resolve identity, read the ledger,
 * scan git); the executors own every mutation.
 *
 * The plan TYPES and their projection to the shared {@link EnginePlan} live here
 * (pure, no I/O — unit-testable and importable without pulling in the git layer);
 * the BUILDERS that gather the read-only state and the EXECUTORS that mutate live
 * with the rest of the lifecycle in `lifecycle.ts`.
 */

import {
  BUILT_IN_STEP_LABELS,
  type EnginePlan,
  type PlanStep,
  type StepLabel,
  verbatimStepLabel,
} from "../../shared/result.ts";
import type { ResolvedGeneratedGroup } from "../../shared/generated_artifacts.ts";
import type { JobTimeout } from "../jobs/types.ts";
import type { IgnoredFileChangeSummary } from "./ignored.ts";
import type { LedgerItem } from "./resources.ts";
import {
  DROP_RECOVERY_REF_LIMIT,
  DROP_RECOVERY_REF_PREFIX,
  PROOF_NOTES_REF,
} from "../../shared/git_conventions.ts";
import type { GitWorktreePruneScan, OrphanWorktreeSweepScan } from "./git.ts";
import type { ContainedWorktree } from "./containment.ts";
import type { ReappearedWorktreePathScan } from "./retired_paths.ts";
import type { GitCount } from "../../shared/git_count.ts";

/** The shared note for the complete refresh reconciliation. */
export const FULL_REFRESH_STEP_NOTE =
  "run the complete refresh reconciliation for shared files and checkout-local Agent artifacts";

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
      label: verbatimStepLabel(item.entry.resource_name),
      disposition: "run",
      note: item.entry.resource_identity,
    })),
  };
}

// ── accept ──────────────────────────────────────────────────────────────────

/** The read-only diagnosis an acceptance acts on. The preconditions (behind main,
 * dirty worktree, dirty main, main checkout off the trunk) are checked while
 * BUILDING this — a plan only exists for an acceptance that may proceed. The
 * landing is always the TRUNK: the single place work lands (the landing model —
 * composition happens on the pull axis, `start --from` / `update --from`). */
export interface AcceptPlan {
  worktreeBranch: string;
  worktreePath: string;
  mainRepo: string;
  /** The trunk the acceptance fast-forwards (`[repository].trunk`). */
  trunk: string;
  /** Whether refresh maintains proof-note fetch mappings. */
  proofNotes: "local" | "fetch";
  /** Shared checkout-convergence commands run in the trunk after landing. */
  repositoryEnsureSteps: string[];
  /** Configured smoke jobs run in the trunk after convergence. */
  smokeSteps: Array<{
    label: string;
    command: string;
    timeout?: JobTimeout | undefined;
  }>;
  /** Whether any external resource is declared (→ a teardown step). */
  hasResources: boolean;
  /** Ignored-file drift detected against the setup-time baseline, when enabled. */
  ignoredFileChanges: IgnoredFileChangeSummary;
}

/**
 * Project an acceptance onto the shared renderer: the ordered mutations it will
 * perform. Dirty worktrees are refused before a plan exists, so every acceptance
 * plan lands committed history only.
 */
export function acceptPlanToEngine(plan: AcceptPlan): EnginePlan {
  const steps: PlanStep[] = [{
    kind: "tracked-refresh-check",
    label: BUILT_IN_STEP_LABELS.trackedRefreshLandingBoundary,
    disposition: "gate",
    note:
      "after Proof or gate validation, verify the current engine's refresh plan has no pending tracked-file effect",
  }];
  // Land on the trunk FIRST: fast-forward it to the branch tip (always clean —
  // the gate guarantees the branch contains the trunk). Then converge and prove
  // the receiving checkout before the cleanup tail tears down resources and
  // removes the worktree. A concurrent-landing loss still refuses at the
  // fast-forward with the worktree and its resources intact.
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
    disposition: "run",
    note: `${plan.trunk} → ${plan.worktreeBranch} in ${plan.mainRepo}`,
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.reconcileProofNoteFetch,
    disposition: "run",
    note: plan.proofNotes === "fetch"
      ? "add the Proof note fetch mapping for each remote"
      : "remove only Proof note fetch mappings discern previously managed",
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.writeProofNote,
    disposition: "run",
    note: `attach the landed Proof under ${PROOF_NOTES_REF}`,
  });
  steps.push({
    kind: "refresh",
    label: BUILT_IN_STEP_LABELS.materializeLocalAgentArtifacts,
    disposition: "run",
    note:
      "materialize only ignored/local Agent artifacts in the trunk checkout",
  });
  for (const command of plan.repositoryEnsureSteps) {
    steps.push({
      kind: "repository-ensure",
      label: verbatimStepLabel(command),
      disposition: "run",
      note: "converge the trunk checkout on the landed tree",
    });
  }
  for (const smoke of plan.smokeSteps) {
    steps.push({
      kind: "job",
      label: verbatimStepLabel(smoke.label),
      disposition: "run",
      note: smoke.command,
      group: "Smoke",
    });
  }
  steps.push({
    kind: "checkout-clean-check",
    label: BUILT_IN_STEP_LABELS.checkTrunkCheckout,
    disposition: "run",
    note:
      "report tracked dirt present immediately after landing or introduced by ensure/smoke convergence",
  });
  steps.push({
    kind: "resource-destroy",
    label: BUILT_IN_STEP_LABELS.teardownResources,
    disposition: plan.hasResources ? "run" : "skip",
    note: plan.hasResources
      ? "destroy this worktree's external resources"
      : "no resources declared",
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.removeWorktree,
    disposition: "run",
    note: plan.worktreePath,
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.deleteBranch,
    disposition: "run",
    note: `${plan.worktreeBranch} (merged into ${plan.trunk})`,
  });
  const ignoredDetails = ignoredFileDetails(plan.ignoredFileChanges);
  return {
    title: "Acceptance plan",
    details: [
      `Branch:        ${plan.worktreeBranch}`,
      `From worktree: ${plan.worktreePath}`,
      `Into trunk:    ${plan.mainRepo} (fast-forward ${plan.trunk}, delete ${plan.worktreeBranch})`,
      ...ignoredDetails,
    ],
    steps,
  };
}

// ── update ───────────────────────────────────────────────────────────────

/** The read-only diagnosis an integration acts on: which source ref is coming in
 * (the trunk by default, any ref via `--from`), how far behind the worktree
 * branch is, and whether it already contains the source (→ nothing to merge; the
 * refresh + ensure convergence still runs, so a re-run after a manual conflict
 * resolution restores everything the aborted merge skipped). The worktree
 * precondition is checked while BUILDING this — a plan only exists for an
 * integration that may proceed. */
export interface UpdatePlan {
  /** The source being merged in: the integration branch (`[repository].trunk`
   * / `DISCERN_TRUNK`), or the `--from` ref. */
  source: string;
  /** Whether `source` came from an explicit `--from` (vs the trunk default). */
  fromOverride: boolean;
  /** The worktree's current branch (display only). */
  worktreeBranch: string;
  /** Commits behind the source, or unknown when Git could not read the count. */
  behind: GitCount;
  /** Whether the branch already contains the source (→ nothing to merge). */
  alreadyUpdated: boolean;
  /** Configured generated-artifact groups re-run during convergence. */
  generatedGroups: ResolvedGeneratedGroup[];
  /** Exact refresh-compiled paths eligible for built-in conflict resolution. */
  refreshCompiledPaths: string[];
  /** Checkout-generic `[repository].ensure` commands run after merge + refresh. */
  repositoryEnsureSteps: string[];
  /** Worktree-only `[worktree.setup].ensure` commands run after shared convergence. */
  worktreeEnsureSteps: string[];
}

/**
 * Project an integration onto the shared renderer: merge the source ref,
 * run the complete refresh reconciliation, then re-run the convergent
 * checkout-shared and worktree-only ensure buckets to converge the merged tree. When the
 * branch already contains the source only the merge is `skip`ped — the refresh and
 * the ensure convergence run on EVERY pass (like session start), which is what
 * makes "re-run `discern update`" the recovery after a manually resolved
 * conflict: the no-op re-run restores the convergence the aborted merge skipped.
 */
export function updatePlanToEngine(plan: UpdatePlan): EnginePlan {
  const act = !plan.alreadyUpdated;
  const steps: PlanStep[] = [
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.merge,
      disposition: act ? "run" : "skip",
      note: act
        ? `merge ${plan.source} into ${plan.worktreeBranch}`
        : `already up to date with ${plan.source}`,
    },
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.autoResolveGeneratedConflicts,
      disposition: act ? "run" : "skip",
      note: act
        ? "take the incoming side of generated conflicts before regeneration"
        : "no merge conflicts to classify",
    },
    ...plan.generatedGroups.map((group): PlanStep => ({
      kind: "job",
      label: verbatimStepLabel(`generated:${group.name}`),
      disposition: "run",
      note: group.run,
      group: "Generated artifacts",
    })),
    {
      kind: "refresh",
      label: BUILT_IN_STEP_LABELS.completeRefresh,
      disposition: "run",
      note: FULL_REFRESH_STEP_NOTE,
    },
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
      disposition: act ? "run" : "skip",
      note:
        "after a merge, commit successfully re-derived tracked paths whose bytes changed; without a merge, report changed tracked refresh paths for review and an intentional commit",
    },
  ];
  for (const step of plan.repositoryEnsureSteps) {
    steps.push({
      kind: "repository-ensure",
      label: verbatimStepLabel(step),
      disposition: "run",
      note: "converge the checkout on the current tree",
    });
  }
  for (const step of plan.worktreeEnsureSteps) {
    steps.push({
      kind: "setup-ensure",
      label: verbatimStepLabel(step),
      disposition: "run",
      note: "converge the worktree on the current tree",
    });
  }
  return {
    title: "Update plan",
    details: [
      `Branch:    ${plan.worktreeBranch}`,
      `Update: ${plan.source}`,
      plan.alreadyUpdated
        ? "Status:    already up to date"
        : `Behind by: ${plan.behind} commit(s)`,
    ],
    steps,
  };
}

// ── start ─────────────────────────────────────────────────────────────────────

/** One external resource identity the new worktree setup will create. */
export interface StartResourcePlan {
  readonly name: string;
  readonly identity: string;
}

/** The plan a `discern start` would carry out: create a fresh linked worktree at a
 * resolved sibling location on its own branch, then run its first-time setup. The
 * id and branch are minted while building this. A caller such as the Desk may
 * retain this plan through confirmation and apply those same concrete values. */
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
  /** The immutable commit `from` resolved to while planning. */
  fromCommit: string;
  /** The local trunk name resolved while planning. */
  trunk: string;
  /** Positive count of trunk commits absent from the selected base. Omitted
   * when the base is equal to or ahead of trunk. */
  behindTrunk?: number;
  /** Human display title preserved in worktree task metadata. */
  title: string;
  /** Optional one-line task brief preserved in worktree task metadata. */
  brief?: string;
  /** External resource identities setup will create for this worktree. */
  resources: readonly StartResourcePlan[];
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
    `Title:        ${plan.title}`,
    `From:         ${plan.from}`,
    `Base commit:  ${plan.fromCommit}`,
    `Trunk:        ${plan.trunk}`,
    `Path:         ${plan.worktreePath}`,
  ];
  if (plan.behindTrunk !== undefined) {
    details.push(`Behind trunk: ${plan.behindTrunk}`);
  }
  if (plan.brief !== undefined) {
    details.push(`Brief:        ${plan.brief}`);
  }
  details.push(
    plan.resources.length === 0
      ? "Resources:    none"
      : `Resources:    ${
        plan.resources.map((resource) =>
          `${resource.name}=${resource.identity}`
        ).join(", ")
      }`,
  );
  if (plan.note !== undefined) {
    details.push(`Name:         ${plan.note}`);
  }
  return {
    title: "Start plan",
    details,
    steps: [
      {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.addWorktree,
        disposition: "run",
        note: `${plan.worktreePath} on ${plan.branch}`,
      },
      {
        kind: "task-metadata",
        label: BUILT_IN_STEP_LABELS.writeTaskMetadata,
        disposition: "run",
        note: "record the display title, brief, and creation source",
      },
      {
        kind: "setup-step",
        label: BUILT_IN_STEP_LABELS.setup,
        disposition: "run",
        note:
          "ready the new worktree (branch, resources, env, port, agent files)",
      },
    ],
  };
}

// ── task title rename ───────────────────────────────────────────────────────

/** Read-only plan for changing one worktree's human title. */
export interface TaskRenamePlan {
  readonly id: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly previousTitle: string;
  readonly title: string;
  readonly willWrite: boolean;
}

/** Project a metadata-only title change onto the shared plan vocabulary. */
export function taskRenamePlanToEngine(plan: TaskRenamePlan): EnginePlan {
  return {
    title: "Task title plan",
    details: [
      `Worktree id:  ${plan.id}`,
      `Branch:       ${plan.branch}`,
      `Path:         ${plan.worktreePath}`,
      `Current title: ${plan.previousTitle}`,
      `New title:     ${plan.title}`,
    ],
    steps: [{
      kind: "task-metadata",
      label: BUILT_IN_STEP_LABELS.writeTaskMetadata,
      disposition: plan.willWrite ? "run" : "skip",
      note: plan.willWrite
        ? "replace the human display title; preserve worktree identity and task facts"
        : "the task already has this recorded title",
    }],
  };
}

// ── setup ─────────────────────────────────────────────────────────────────────

/** One step a worktree setup would perform — precomputed from the config so the
 * plan lists exactly what setup will do (and a dry-run touches nothing). */
export interface SetupStepDesc {
  kind: PlanStep["kind"];
  label: StepLabel;
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

// ── drop ──────────────────────────────────────────────────────────────────────

/** The read-only diagnosis a `worktree drop` acts on: the resolved target, what
 * discarding it would lose (uncommitted changes, unmerged commits — the
 * `--force` blockers), and the resources to tear down. Built from the main
 * checkout; a plan exists even when blocked, so `--dry-run` can show what a
 * `--force` WOULD discard. */
export interface DropPlan {
  /** The resolved worktree's canonical path. */
  targetPath: string;
  /** The worktree's id (its directory basename, or the resolved identity). */
  id: string;
  /** The checked-out branch to delete after removal, or "" when detached. */
  branch: string;
  /** Whether the branch is deleted after removal — false when detached (no
   * branch) or when the worktree holds the TRUNK: drop discards a line of
   * work, and the trunk is never a line of work to discard. A branch without
   * exact worktree-identity ownership is also retained. */
  deleteBranch: boolean;
  /** Preserve the recorded HEAD before any destructive effect. */
  preserveHead: boolean;
  /** Why a named branch is retained when {@link deleteBranch} is false. */
  branchKeepReason?: string | undefined;
  /** What a drop would discard — empty when the worktree is clean and merged.
   * Each entry is a human sentence ("3 uncommitted changes", …). */
  blockers: string[];
  /** Ledger entries for the worktree's resources, in destruction order. */
  entries: LedgerItem[];
  /** Commit recorded in Git's worktree registration. */
  head: string;
  /** Checkout cleanliness from the live Git snapshot; absent when unreadable. */
  clean?: boolean | undefined;
}

/** A healthy checkout removal that retains its branch and human task wording. */
export interface ParkPlan {
  targetPath: string;
  id: string;
  branch: string;
  head: string;
  entries: LedgerItem[];
  title: string;
  keepsBrief: boolean;
  removesGrant: boolean;
  removesProof: boolean;
}

/** Project Park's distinct artifact contract onto the shared plan renderer. */
export function parkPlanToEngine(plan: ParkPlan): EnginePlan {
  return {
    title: "Park plan",
    details: [
      `Branch kept:      ${plan.branch} at ${plan.head}`,
      `Task metadata:    ${plan.title}${plan.keepsBrief ? " with brief" : ""}`,
      `Checkout removed: ${plan.targetPath}`,
      `Landing grant:    ${plan.removesGrant ? "removed" : "none recorded"}`,
      `Proof:            ${
        plan.removesProof ? "removed with checkout" : "none recorded"
      }`,
    ],
    steps: [{
      kind: "task-metadata",
      label: BUILT_IN_STEP_LABELS.writeTaskMetadata,
      disposition: "run",
      note: "retain the task title, brief, and creation source for resume",
    }, {
      kind: "resource-destroy",
      label: BUILT_IN_STEP_LABELS.teardownResources,
      disposition: plan.entries.length > 0 ? "run" : "skip",
      note: plan.entries.length > 0
        ? "destroy resources recorded for this checkout"
        : "no resources recorded",
    }, {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.removeWorktree,
      disposition: "run",
      note: plan.targetPath,
    }, {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.deleteBranch,
      disposition: "skip",
      note: `${plan.branch} is retained for resume`,
    }],
  };
}

/** Project a drop onto the shared renderer: tear down resources, remove the
 * worktree, delete its branch. */
export function dropPlanToEngine(plan: DropPlan): EnginePlan {
  const steps: PlanStep[] = [];
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.preserveBranchTip,
    disposition: plan.preserveHead ? "run" : "skip",
    note: plan.preserveHead
      ? `retain the commit under ${DROP_RECOVERY_REF_PREFIX}/ (newest ${DROP_RECOVERY_REF_LIMIT})`
      : plan.branch === ""
      ? "detached HEAD is already reachable from the trunk"
      : plan.branchKeepReason ?? `${plan.branch} is kept`,
  });
  steps.push({
    kind: "resource-destroy",
    label: BUILT_IN_STEP_LABELS.teardownResources,
    disposition: plan.entries.length > 0 ? "run" : "skip",
    note: plan.entries.length > 0
      ? "destroy this worktree's external resources"
      : "no resources recorded",
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.removeWorktree,
    disposition: "run",
    note: plan.targetPath,
  });
  steps.push({
    kind: "git",
    label: BUILT_IN_STEP_LABELS.deleteBranch,
    disposition: plan.deleteBranch ? "run" : "skip",
    note: plan.deleteBranch
      ? plan.branch
      : plan.branch === ""
      ? "detached — no branch to delete"
      : plan.branchKeepReason ?? `${plan.branch} is kept`,
  });
  const details = [
    `Worktree: ${plan.id}`,
    `Path:     ${plan.targetPath}`,
    `Branch:   ${plan.branch !== "" ? plan.branch : "(detached)"}`,
  ];
  if (plan.blockers.length > 0) {
    details.push(`Discards: ${plan.blockers.join("; ")}`);
  }
  return { title: "Drop plan", details, steps };
}

// ── prune ─────────────────────────────────────────────────────────────────────

/**
 * What `worktree prune` would reclaim — the carried read-only scans
 * (positively-owned merged worktrees, owned stale metadata, owned orphan
 * directories) plus reappearance and resource evidence. The deliverable a
 * dry-run renders and the apply executor acts on.
 */
export interface PrunePlan {
  /** Git-worktree/branch/stale-metadata scan to apply exactly. */
  gitScan: GitWorktreePruneScan;
  /** Ledger entries to tear down before removing each still-live worktree. */
  worktreeResourceTeardowns: Array<{
    worktreePath: string;
    gitKey: string | undefined;
    entries: LedgerItem[];
  }>;
  /** Orphan-directory scan to apply exactly. */
  orphanScan: OrphanWorktreeSweepScan;
  /** Removed paths that exist again without a live worktree registration. */
  reappearedPathScan: ReappearedWorktreePathScan;
  /** Orphaned worktree resource ledger entries GC would reclaim. */
  resourceReclaims: LedgerItem[];
  /** Orphaned resource ledger entries kept as live, guarded, or opted out. */
  resourceReclaimsKept: number;
  /** Contained worktrees — spent early stages of a `start --from` train whose
   * commits travel inside a live descendant branch. Always REPORTED when found;
   * reclaimed (checkout + per-worktree state destroyed, branch ref kept) only
   * under the explicit `reclaimContained` opt-in. */
  contained: ContainedWorktree[];
  /** Whether this run's explicit opt-in covers reclaiming the contained group.
   * Without it the group renders as skipped — the offer, never the act. */
  reclaimContained: boolean;
}

/** List branches released by owned worktree removal. */
function pruneBranchesToDelete(scan: GitWorktreePruneScan): string[] {
  return scan.worktreesToRemove.map((w) => w.branch).filter((b) => b !== "");
}

/** Project a prune plan onto the shared renderer, grouping by what is reclaimed. */
export function prunePlanToEngine(plan: PrunePlan): EnginePlan {
  const steps: PlanStep[] = [];
  for (const teardown of plan.worktreeResourceTeardowns) {
    for (const item of teardown.entries) {
      steps.push({
        kind: "resource-destroy",
        label: verbatimStepLabel(item.entry.resource_identity),
        disposition: "run",
        note: `tear down before removing ${teardown.worktreePath}`,
        group: "Resources",
      });
    }
  }
  for (const w of plan.gitScan.worktreesToRemove) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(w.path),
      disposition: "run",
      note: "remove owned clean merged worktree",
      group: "Worktrees",
    });
  }
  for (const b of pruneBranchesToDelete(plan.gitScan)) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(b),
      disposition: "run",
      note: "delete merged owned branch",
      group: "Branches",
    });
  }
  for (const b of plan.gitScan.orphanedLandedBranches) {
    steps.push(
      b.disposition === "delete"
        ? {
          kind: "git",
          label: verbatimStepLabel(b.branch),
          disposition: "run",
          note: "finish the recorded landed-branch deletion",
          group: "Branches",
        }
        : {
          kind: "git",
          label: verbatimStepLabel(b.branch),
          disposition: "skip",
          note: b.disposition === "clear"
            ? `clear the landed-branch record (${b.reason})`
            : `keep the landed-branch record (${b.reason})`,
          group: "Branches",
        },
    );
  }
  for (const m of plan.gitScan.staleMetadata) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(m.path),
      disposition: "run",
      note: "prune stale git metadata",
      group: "Stale metadata",
    });
  }
  for (const d of plan.orphanScan.removable) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(d.path),
      disposition: "run",
      note: "reclaim orphan directory",
      group: "Orphan directories",
    });
  }
  for (const kept of plan.orphanScan.kept) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(kept.path),
      disposition: "skip",
      note: kept.reason,
      group: "Kept orphan directories",
    });
  }
  for (const path of plan.reappearedPathScan.removable) {
    const sample = path.kind !== "directory"
      ? `path is a ${path.kind}`
      : path.contents.length === 0
      ? `${path.entries} filesystem entr${path.entries === 1 ? "y" : "ies"}`
      : `${path.contents.join(", ")}${
        path.contents_truncated ? ", and more" : ""
      }`;
    steps.push({
      kind: "git",
      label: verbatimStepLabel(path.path),
      disposition: "run",
      note: `remove files written after worktree removal (${sample})`,
      group: "Reappeared worktree paths",
    });
  }
  for (const path of plan.reappearedPathScan.kept) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(path.path),
      disposition: "skip",
      note: path.cleanup_blocked_reason ?? "cleanup is blocked",
      group: "Kept reappeared worktree paths",
    });
  }
  for (const r of plan.resourceReclaims) {
    steps.push({
      kind: "resource-destroy",
      label: verbatimStepLabel(r.entry.resource_identity),
      disposition: "run",
      note: "reclaim orphaned resource",
      group: "Resources",
    });
  }
  for (const c of plan.contained) {
    steps.push({
      kind: "git",
      label: verbatimStepLabel(c.path),
      disposition: plan.reclaimContained ? "run" : "skip",
      // Both modes carry the full evidence — the branch tips and the
      // container's lead — so the human confirms shas, not bare names.
      note: plan.reclaimContained
        ? `reclaim checkout; keep branch ${c.branch} @ ${c.tip.slice(0, 12)} ` +
          `(contained in ${c.containingBranch} @ ` +
          `${c.containingTip.slice(0, 12)}, +${c.containerAhead} ahead)`
        : `contained in ${c.containingBranch} @ ` +
          `${c.containingTip.slice(0, 12)} (${c.tip.slice(0, 12)} carried ` +
          `+${c.containerAhead} ahead) — pass --contained to reclaim the ` +
          `checkout; the branch ref is kept`,
      group: "Contained worktrees",
    });
  }
  const staleCount = plan.gitScan.staleMetadata.length;
  const details = staleCount === 0 ? [] : [
    `Stale metadata: ${staleCount} entr${staleCount === 1 ? "y" : "ies"}`,
  ];
  if (plan.contained.length > 0) {
    const n = plan.contained.length;
    details.push(
      plan.reclaimContained
        ? `Contained (reclaiming): ${n} checkout${n === 1 ? "" : "s"} — ` +
          `branch refs kept; each checkout and its per-worktree state ` +
          `(gate Proof included) destroyed`
        : `Contained (kept): ${n} checkout${n === 1 ? "" : "s"} whose ` +
          `commits travel inside a live branch — reclaim with --contained; ` +
          `branch refs are always kept`,
    );
  }
  return { title: "Prune plan", details, steps };
}

/** True when a prune plan would change nothing. A contained group counts only
 * under the reclaim opt-in — without it the group is a report, not a change.
 * Landed-branch records count only when a recorded deletion would finish;
 * clearing superseded records is bounded-evidence housekeeping, not a change
 * to the repository's work. */
export function prunePlanIsEmpty(plan: PrunePlan): boolean {
  return plan.gitScan.worktreesToRemove.length === 0 &&
    pruneBranchesToDelete(plan.gitScan).length === 0 &&
    !plan.gitScan.orphanedLandedBranches.some((candidate) =>
      candidate.disposition === "delete"
    ) &&
    plan.gitScan.staleMetadata.length === 0 &&
    plan.orphanScan.removable.length === 0 &&
    plan.reappearedPathScan.removable.length === 0 &&
    plan.resourceReclaims.length === 0 &&
    !(plan.reclaimContained && plan.contained.length > 0);
}
