/**
 * A task's checkout: retry its setup, rename it, park it, reclaim it, or drop
 * it. Each is reviewed from the lifecycle core's own plan; a drop that would
 * discard work asks for the branch name up front and passes force only when
 * the typed name matches.
 */

import {
  DropWouldDiscardWork,
  WorktreeGitError,
} from "../../worktree/lifecycle.ts";
import { taskTextValidationError } from "../../../shared/task_metadata.ts";
import type { DeskFlowStep, DeskPrepared } from "../flow_types.ts";
import {
  type DeskFlowContext,
  resultPlan,
  reviewedAction,
  stepOffer,
} from "./context.ts";

type ActionStep = Extract<DeskFlowStep, { readonly kind: "action" }>;

/**
 * Drop: the removal plan, its discarded work in danger, and the branch name
 * typed up front when work would be discarded. A drop the core still refuses
 * as discarding work asks again with the challenge.
 */
export async function prepareDrop(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "drop");
  const ctx = await context.runtime.lifecycle(context.root);
  const plan = await context.runtime.dropPlan(ctx, row.entry.path);
  const expected = plan.subject;
  const blockers = expected?.blockers ?? [];
  const challenged = step.stage === "challenge" || blockers.length > 0;
  const branch = row.entry.branch;
  const prepared = reviewedAction(context, row, offer, {
    plan,
    doing: `Dropping ${row.task.name}`,
    extra: {
      lines: blockers.map((blocker) => ({
        mark: "discards" as const,
        text: `Discards ${blocker}`,
      })),
    },
    run: async (command, { challenge }) => {
      const force = challenged && challenge === branch;
      try {
        await context.runtime.drop(ctx, row.entry.path, {
          ...(force ? { force: true } : {}),
          ...(expected === undefined ? {} : { expected }),
        });
      } catch (error) {
        if (!(error instanceof DropWouldDiscardWork) || force) throw error;
        return {
          command,
          ok: false,
          message: { tone: "warning", text: error.message },
          next: { ...step, stage: "challenge" },
        };
      }
      return `Dropped ${row.task.name}; its last commit is kept for a while`;
    },
  });
  return challenged
    ? {
      ...prepared,
      content: { ...prepared.content, challenge: { mustEqual: branch } },
    }
    : prepared;
}

/** Rename: the new title, the core's preview, then the rename. */
export async function prepareRename(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "rename");
  const title = (step.values?.title ?? "").trim();
  const invalid = title === ""
    ? "Enter a task title."
    : taskTextValidationError(title, "title");
  if (invalid !== undefined) throw new WorktreeGitError(invalid);
  const ctx = await context.runtime.lifecycle(row.entry.path);
  return reviewedAction(context, row, offer, {
    plan: resultPlan(await context.runtime.renamePlan(ctx, title)),
    doing: `Renaming ${row.task.name}`,
    extra: {
      title: `Rename ${row.task.name} to ${JSON.stringify(title)}?`,
      command: ["discern", "worktree", "rename", title],
    },
    run: async () => {
      const result = await context.runtime.rename(ctx, title);
      if (!result.ok) {
        throw new WorktreeGitError(result.message ?? "Title change refused.");
      }
      return result.message ?? `Renamed the task to ${title}`;
    },
  });
}
