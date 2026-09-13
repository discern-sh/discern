/** Branch-preserving Park plan and apply core. */
import { withWorktreeOwnership } from "../operation_lock.ts";

import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { fileExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  appliedResult,
  BUILT_IN_STEP_LABELS,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  type StepResult,
  verbatimStepLabel,
} from "../../shared/result.ts";
import {
  PARKED_TASK_METADATA_SCHEMA_VERSION,
  type ParkedTaskMetadata,
  type StoredTaskMetadata,
  TASK_METADATA_SCHEMA_VERSION,
} from "../../shared/task_metadata.ts";
import type { LifecycleContext } from "./lifecycle.ts";
import {
  integrationBranch,
  localBranchExists,
  removeWorktreeSafely,
  resolveCommitRef,
  WorktreeGitError,
  worktreeSetupComplete,
} from "./git.ts";
import { writeParkedTaskMetadata } from "./parked_task_metadata.ts";
import { type ParkPlan, parkPlanToEngine } from "./plan.ts";
import { buildRemovalPlan } from "./removal_plan.ts";
import { destroyResources } from "./resources.ts";
import { readStoredTaskMetadata } from "./task_metadata.ts";

interface PreparedPark {
  readonly plan: ParkPlan;
  readonly task: StoredTaskMetadata;
}

/** Read-only Park diagnosis. Unknown or dirty state never yields a plan. */
async function buildParkPlan(
  ctx: LifecycleContext,
  target: string,
): Promise<PreparedPark> {
  const removal = await buildRemovalPlan(ctx, target, "park");
  const trunk = integrationBranch(ctx.config.repository.trunk);
  if (removal.branch === "" || removal.branch === trunk) {
    throw new WorktreeGitError(
      "Park needs a named task branch separate from the trunk. The checkout and branch were kept. Choose Show recovery steps in `discern desk`.",
    );
  }
  if (removal.clean !== true) {
    throw new WorktreeGitError(
      removal.clean === false
        ? `Park refused ${removal.id} because its checkout has uncommitted changes. Commit or discard those changes, then re-run \`discern worktree park ${removal.id}\`.`
        : `Park could not verify ${removal.id}'s checkout as clean. Run \`git status --short\` in ${removal.targetPath}, repair the reported Git state, then re-run \`discern worktree park ${removal.id}\`.`,
    );
  }
  if (!(await worktreeSetupComplete(removal.targetPath))) {
    throw new WorktreeGitError(
      `Park refused ${removal.id} because setup has not reached its ready marker. Run \`discern worktree setup\` in ${removal.targetPath}, then re-run \`discern worktree park ${removal.id}\`.`,
    );
  }
  if (!(await localBranchExists(ctx.root, removal.branch))) {
    throw new WorktreeGitError(
      `Park could not verify branch ${removal.branch}. Run \`git show-ref --verify refs/heads/${removal.branch}\` from ${ctx.root}, repair the branch ref, then re-run.`,
    );
  }
  const branchHead = await resolveCommitRef(ctx.root, removal.branch);
  if (branchHead !== removal.head) {
    throw new WorktreeGitError(
      `Park observed branch ${removal.branch} at ${branchHead}, while Git's worktree registration records ${removal.head}. Run \`git worktree repair\`, then re-run \`discern worktree park ${removal.id}\`.`,
    );
  }
  let task: StoredTaskMetadata;
  try {
    task = await readStoredTaskMetadata(removal.targetPath) ?? {
      schema_version: TASK_METADATA_SCHEMA_VERSION,
      title: removal.id,
    };
  } catch (error) {
    throw new WorktreeGitError(
      `Park could not preserve task metadata for ${removal.id}: ${
        error instanceof Error ? error.message : String(error)
      } Run \`discern status --all\` to inspect the task metadata failure, repair it, then re-run.`,
      { cause: error },
    );
  }
  const grantPath = await gitAdminStatePath(removal.targetPath, "effortGrant");
  const proofPath = await gitAdminStatePath(removal.targetPath, "gateProof");
  return {
    task,
    plan: {
      targetPath: removal.targetPath,
      id: removal.id,
      branch: removal.branch,
      head: removal.head,
      entries: removal.entries,
      title: task.title,
      keepsBrief: task.brief !== undefined,
      removesGrant: grantPath !== undefined && await fileExists(grantPath),
      removesProof: proofPath !== undefined && await fileExists(proofPath),
    },
  };
}

/** Exact read-only Park plan for the CLI and Desk. */
export async function worktreeParkPlan(
  ctx: LifecycleContext,
  target: string,
): Promise<EnginePlan> {
  return parkPlanToEngine((await buildParkPlan(ctx, target)).plan);
}

/** Compare the facts whose movement would invalidate a reviewed Park plan. */
function sameParkSubject(left: ParkPlan, right: ParkPlan): boolean {
  return left.targetPath === right.targetPath && left.id === right.id &&
    left.branch === right.branch && left.head === right.head &&
    right.entries.length === left.entries.length &&
    right.entries.every((entry, index) =>
      entry.entry.resource_name === left.entries[index]?.entry.resource_name &&
      entry.entry.resource_identity ===
        left.entries[index]?.entry.resource_identity
    );
}

/** Resource teardown may empty the ledger; checkout identity must stay fixed. */
function sameParkSubjectAfterTeardown(
  planned: ParkPlan,
  current: ParkPlan,
): boolean {
  return planned.targetPath === current.targetPath &&
    planned.id === current.id &&
    planned.branch === current.branch && planned.head === current.head &&
    current.entries.length === 0;
}

/**
 * Apply Park with a plan rebuild before and after resource teardown. The branch
 * and task metadata survive; an unreadable or moving checkout remains present.
 */
export async function worktreeParkResult(
  ctx: LifecycleContext,
  target: string,
  dryRun: boolean,
): Promise<DiscernResult> {
  const prepared = await buildParkPlan(ctx, target);
  if (dryRun) {
    return previewResult("worktree park", parkPlanToEngine(prepared.plan));
  }
  return await withWorktreeOwnership(prepared.plan.targetPath, async () => {
    const beforeApply = await buildParkPlan(ctx, prepared.plan.targetPath);
    if (!sameParkSubject(prepared.plan, beforeApply.plan)) {
      throw new WorktreeGitError(
        "Task changed after the Park plan was built. Nothing was removed. Review a refreshed plan, then re-run.",
      );
    }
    const record: ParkedTaskMetadata = {
      schema_version: PARKED_TASK_METADATA_SCHEMA_VERSION,
      id: prepared.plan.id,
      branch: prepared.plan.branch,
      head: prepared.plan.head,
      parked_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
      task: prepared.task,
    };
    try {
      await writeParkedTaskMetadata(ctx.root, record);
    } catch (error) {
      throw new WorktreeGitError(
        `Park stopped before cleanup because task metadata could not be retained: ${
          error instanceof Error ? error.message : String(error)
        } Run \`discern doctor\`, then re-run \`discern worktree park ${prepared.plan.id}\`.`,
        { cause: error },
      );
    }

    const { destroyed, failed } = await destroyResources(
      { config: ctx.config, log: ctx.log, cwd: prepared.plan.targetPath },
      prepared.plan.entries,
    );
    if (failed.length > 0) {
      throw new WorktreeGitError(
        `Park stopped because resource cleanup failed for ${
          failed.join(", ")
        }. The checkout and branch remain. Fix the failed destroy command above, then re-run \`discern worktree park ${prepared.plan.id}\`.`,
      );
    }
    const afterTeardown = await buildParkPlan(ctx, prepared.plan.targetPath);
    if (!sameParkSubjectAfterTeardown(prepared.plan, afterTeardown.plan)) {
      throw new WorktreeGitError(
        `Task changed during resource cleanup. The checkout and branch remain; resources ${
          destroyed.length === 0 ? "were unchanged" : "were removed"
        }. Run \`discern worktree setup\` in ${prepared.plan.targetPath}, review the refreshed state, then re-run Park.`,
      );
    }
    await removeWorktreeSafely(prepared.plan.targetPath, ctx.root);
    const steps: StepResult[] = [
      {
        step: {
          kind: "task-metadata",
          label: BUILT_IN_STEP_LABELS.writeTaskMetadata,
          disposition: "run",
          note: `retained for ${prepared.plan.branch}`,
        },
        outcome: "ok",
      },
      ...prepared.plan.entries.map((item): StepResult => ({
        step: {
          kind: "resource-destroy",
          label: verbatimStepLabel(item.entry.resource_name),
          disposition: "run",
          note: item.entry.resource_identity,
        },
        outcome: destroyed.includes(item.entry.resource_name)
          ? "ok"
          : "skipped",
      })),
      {
        step: {
          kind: "git",
          label: BUILT_IN_STEP_LABELS.removeWorktree,
          disposition: "run",
          note: prepared.plan.targetPath,
        },
        outcome: "ok",
      },
      {
        step: {
          kind: "git",
          label: BUILT_IN_STEP_LABELS.deleteBranch,
          disposition: "skip",
          note: `${prepared.plan.branch} retained for resume`,
        },
        outcome: "skipped",
      },
    ];
    return appliedResult("worktree park", steps);
  });
}
