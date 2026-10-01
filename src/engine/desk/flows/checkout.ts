/**
 * A task's checkout: retry its setup, rename it, park it, reclaim it, or drop
 * it. Each is reviewed from the lifecycle core's own plan and held to its
 * binding when it runs. A drop that would discard work asks for the branch
 * name up front, bound to the plan's own blockers, and passes force only
 * when the typed name matches; Park instead is one key away.
 */

import {
  DropWouldDiscardWork,
  WorktreeGitError,
} from "../../worktree/lifecycle.ts";
import type { DropPlan } from "../../worktree/plan.ts";
import { taskTextValidationError } from "../../../shared/task_metadata.ts";
import { deskRowId } from "../model.ts";
import { renameTitle } from "../desk_transitions.ts";
import type { DeskPlanFacts } from "../review_facts.ts";
import type { DeskReviewAlternative } from "../flow_types.ts";
import {
  type DeskFlow,
  type DeskFlowContext,
  offerCommand,
  rebound,
  resultPlan,
  reviewOffer,
  stepOffer,
  succeeded,
} from "./context.ts";

/** Whether a drop blocker counts work it would discard, rather than doubt. */
function counted(blocker: string): boolean {
  return /^\d/u.test(blocker) || blocker.startsWith("branch '");
}

/** The drop plan's blockers, split into discarded work and doubts. */
function dropFacts(plan: DropPlan): DeskPlanFacts {
  const discards = plan.blockers.filter(counted);
  const uncertain = plan.blockers.filter((blocker) => !counted(blocker));
  return {
    ...(discards.length === 0 ? {} : { discards }),
    ...(uncertain.length === 0 ? {} : { uncertain }),
    endsGrant: plan.endsGrant,
    leavesQueue: plan.leavesQueue,
  };
}

/**
 * Drop: the removal plan, its discarded work in danger, the branch name
 * typed up front when the plan's blockers predict lost work, and Park
 * instead beside Keep.
 */
const DROP_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "drop", async (row) => {
      const ctx = await context.runtime.lifecycle(context.root);
      const plan = await context.runtime.dropPlan(ctx, row.entry.path);
      const blockers = plan.subject?.blockers ?? [];
      const park = row.decision.actions.find((offer) =>
        offer.action === "park"
      );
      const alternatives: DeskReviewAlternative[] =
        park?.availability === "enabled"
          ? [{
            id: "park",
            label: "Park instead",
            ...(park.key === undefined ? {} : { key: park.key }),
            intent: { kind: "action", action: "park", id: deskRowId(row) },
          }]
          : [];
      return {
        plan,
        facts: plan.subject === undefined ? {} : dropFacts(plan.subject),
        core: {
          kind: "drop",
          ...(plan.subject === undefined ? {} : { plan: plan.subject }),
        },
        bound: {
          plan: `${plan.subject?.head ?? "unknown"}:${
            plan.subject?.state ?? "unknown"
          }`,
          challenge: blockers.length === 0 ? "none" : row.entry.branch,
        },
        ...(blockers.length === 0 ? {} : { challenge: row.entry.branch }),
        alternatives,
        handoff: `Dropping ${row.task.name}`,
      };
    }),
  apply: async (context, step, expected, { challenge }) => {
    const changed = await rebound(context, step, expected, "drop");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "drop");
    const command = offerCommand(offer);
    const plan = expected.core?.kind === "drop"
      ? expected.core.plan
      : undefined;
    const challenged = (plan?.blockers.length ?? 0) > 0;
    const force = challenged && challenge === row.entry.branch;
    const ctx = await context.runtime.lifecycle(context.root);
    try {
      await context.runtime.drop(ctx, row.entry.path, {
        ...(force ? { force: true } : {}),
        ...(plan === undefined ? {} : { expected: plan }),
      });
    } catch (error) {
      if (!(error instanceof DropWouldDiscardWork) || force) throw error;
      return {
        command,
        ok: false,
        message: { tone: "warning", text: error.message },
        next: step,
      };
    }
    return succeeded(
      command,
      `Dropped ${row.task.name}; its last commit is kept for a while`,
    );
  },
};

/** The title a rename asks for, checked as the core will check it. */
function renameValue(
  context: DeskFlowContext,
  step: Parameters<DeskFlow["review"]>[1],
): { readonly title: string; readonly invalid?: string } {
  const { row } = stepOffer(context, step, "rename");
  const title = (step.values?.title ?? renameTitle(row)).trim();
  const invalid = title === ""
    ? "Enter a task title."
    : title === renameTitle(row)
    ? "Type a different title to rename it."
    : taskTextValidationError(title, "title");
  return { title, ...(invalid === undefined ? {} : { invalid }) };
}

/** Rename: the new title, then the metadata-only rename. */
const RENAME_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "rename", async (row) => {
      const { title, invalid } = renameValue(context, step);
      const plan = invalid === undefined
        ? resultPlan(
          await context.runtime.renamePlan(
            await context.runtime.lifecycle(row.entry.path),
            title,
          ),
        )
        : undefined;
      return {
        question: `Rename ${row.task.name}?`,
        ...(plan === undefined ? {} : { plan }),
        core: { kind: "rename", title },
        argv: ["discern", "worktree", "rename", title],
        ...(invalid === undefined ? {} : { blockers: [invalid] }),
        handoff: `Renaming ${row.task.name}`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "rename");
    if (changed !== undefined) return changed;
    const { row } = stepOffer(context, step, "rename");
    const title = expected.core?.kind === "rename" ? expected.core.title : "";
    const ctx = await context.runtime.lifecycle(row.entry.path);
    const result = await context.runtime.rename(ctx, title);
    if (!result.ok) {
      throw new WorktreeGitError(result.message ?? "Title change refused.");
    }
    return succeeded(
      `discern worktree rename ${JSON.stringify(title)}`,
      result.message ?? `Renamed the task to ${title}`,
    );
  },
};

/** Park: the park plan with what it ends, then the park. */
const PARK_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "park", async (row) => {
      const ctx = await context.runtime.lifecycle(context.root);
      const plan = await context.runtime.parkPlan(ctx, row.entry.path);
      return {
        plan,
        facts: plan.subject === undefined ? {} : {
          endsGrant: plan.subject.endsGrant,
          leavesQueue: plan.subject.leavesQueue,
          removesProof: plan.subject.removesProof,
        },
        handoff: `Parking ${row.task.name}`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "park");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "park");
    const ctx = await context.runtime.lifecycle(context.root);
    await context.runtime.park(ctx, row.entry.path);
    return succeeded(
      offerCommand(offer),
      `Parked ${row.task.name}; its branch is kept`,
    );
  },
};

/** Reclaim: the contained checkout's removal with what it ends. */
const RECLAIM_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "reclaim", async (row) => {
      const ctx = await context.runtime.lifecycle(context.root);
      const plan = await context.runtime.reclaimPlan(ctx, row.entry.path);
      return {
        plan,
        facts: plan.subject === undefined ? {} : {
          endsGrant: plan.subject.endsGrant,
          leavesQueue: plan.subject.leavesQueue,
        },
        handoff: `Reclaiming ${row.task.name}'s checkout`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "reclaim");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "reclaim");
    const ctx = await context.runtime.lifecycle(context.root);
    await context.runtime.reclaim(ctx, row.entry.path);
    return succeeded(
      offerCommand(offer),
      `Reclaimed ${row.task.name}'s checkout; its branch is kept`,
    );
  },
};

/** Retry setup: the setup plan, then setup from the step that failed. */
const RETRY_SETUP_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "retry_setup", async (row) => {
      const ctx = await context.runtime.lifecycle(row.entry.path);
      return {
        plan: await context.runtime.setupPlan(ctx),
        handoff: `Retrying setup for ${row.task.name}`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "retry_setup");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "retry_setup");
    await context.runtime.setup(
      await context.runtime.lifecycle(row.entry.path),
    );
    return succeeded(
      offerCommand(offer),
      `Setup completed for ${row.task.name}`,
    );
  },
};

/** The checkout family's flows, by registry action. */
export const CHECKOUT_FLOWS = {
  drop: DROP_FLOW,
  rename: RENAME_FLOW,
  park: PARK_FLOW,
  reclaim: RECLAIM_FLOW,
  retry_setup: RETRY_SETUP_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
