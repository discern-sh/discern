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
import type { LifecycleContext } from "../../worktree/lifecycle.ts";
import type { CheckoutRecordEnds, DropPlan } from "../../worktree/plan.ts";
import type { EnginePlan } from "../../../shared/result.ts";
import type { DeskRuntime } from "../desk.ts";
import { basename } from "@std/path";
import { taskTextValidationError } from "../../../shared/task_metadata.ts";
import { type DeskRow, deskRowId } from "../model.ts";
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
 * What the owner types to drop a checkout that holds work: its branch, or,
 * for a detached checkout (one mid-rebase, say), its id or directory name.
 * Never empty, so an empty field can never match it.
 */
export function dropChallenge(row: DeskRow): string {
  const name = [row.entry.branch, row.entry.id, basename(row.entry.path)]
    .find((candidate) => candidate !== undefined && candidate.trim() !== "");
  if (name === undefined) {
    throw new WorktreeGitError(
      "This checkout has no branch, id or directory name to confirm a drop with.",
    );
  }
  return name;
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
      const challenge = blockers.length === 0 ? undefined : dropChallenge(row);
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
          challenge: challenge ?? "none",
        },
        ...(challenge === undefined ? {} : { challenge }),
        alternatives,
        running: `Dropping ${row.task.name}`,
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
    const force = challenged && challenge === dropChallenge(row);
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
        running: `Renaming ${row.task.name}`,
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

/** The landing records a removal's plan says it ends. */
type RemovalEnds = CheckoutRecordEnds & { readonly removesProof?: boolean };

/**
 * An effect on a task's checkout that keeps its branch: its core's plan,
 * with the landing records it ends, and the effect that plan describes.
 */
interface CheckoutEffect {
  readonly action: "park" | "reclaim" | "retry_setup";
  /** Whose lifecycle context reads and runs it: the project's or the task's. */
  readonly within: "project" | "task";
  readonly plan: (
    runtime: DeskRuntime,
    ctx: LifecycleContext,
    path: string,
  ) => Promise<EnginePlan & { readonly subject?: RemovalEnds }>;
  readonly run: (
    runtime: DeskRuntime,
    ctx: LifecycleContext,
    path: string,
  ) => Promise<void>;
  /** What it is called while it runs, and the success message, for the task's title. */
  readonly running: (title: string) => string;
  readonly done: (title: string) => string;
}

/** What a removal's plan subject ends, as review facts. */
function removalFacts(subject: RemovalEnds | undefined): DeskPlanFacts {
  if (subject === undefined) return {};
  return {
    endsGrant: subject.endsGrant,
    leavesQueue: subject.leavesQueue,
    ...(subject.removesProof === undefined
      ? {}
      : { removesProof: subject.removesProof }),
  };
}

/** One checkout effect, reviewed from its plan and held to its binding. */
function checkoutEffectFlow(effect: CheckoutEffect): DeskFlow {
  const lifecycle = (
    context: DeskFlowContext,
    path: string,
  ): Promise<LifecycleContext> =>
    Promise.resolve(
      context.runtime.lifecycle(
        effect.within === "project" ? context.root : path,
      ),
    );
  return {
    review: (context, step) =>
      reviewOffer(context, step, effect.action, async (row) => {
        const ctx = await lifecycle(context, row.entry.path);
        const plan = await effect.plan(context.runtime, ctx, row.entry.path);
        return {
          plan,
          facts: removalFacts(plan.subject),
          running: effect.running(row.task.name),
        };
      }),
    apply: async (context, step, expected) => {
      const changed = await rebound(context, step, expected, effect.action);
      if (changed !== undefined) return changed;
      const { row, offer } = stepOffer(context, step, effect.action);
      const ctx = await lifecycle(context, row.entry.path);
      await effect.run(context.runtime, ctx, row.entry.path);
      return succeeded(offerCommand(offer), effect.done(row.task.name));
    },
  };
}

/** Park: the park plan with what it ends, then the park. */
const PARK_FLOW = checkoutEffectFlow({
  action: "park",
  within: "project",
  plan: async (runtime, ctx, path) => await runtime.parkPlan(ctx, path),
  run: async (runtime, ctx, path) => await runtime.park(ctx, path),
  running: (title) => `Parking ${title}`,
  done: (title) => `Parked ${title}; its branch is kept`,
});

/** Reclaim: the contained checkout's removal with what it ends. */
const RECLAIM_FLOW = checkoutEffectFlow({
  action: "reclaim",
  within: "project",
  plan: async (runtime, ctx, path) => await runtime.reclaimPlan(ctx, path),
  run: async (runtime, ctx, path) => await runtime.reclaim(ctx, path),
  running: (title) => `Reclaiming ${title}'s checkout`,
  done: (title) => `Reclaimed ${title}'s checkout; its branch is kept`,
});

/** Retry setup: the setup plan, then setup from the step that failed. */
const RETRY_SETUP_FLOW = checkoutEffectFlow({
  action: "retry_setup",
  within: "task",
  plan: async (runtime, ctx) => await runtime.setupPlan(ctx),
  run: async (runtime, ctx) => await runtime.setup(ctx),
  running: (title) => `Retrying setup for ${title}`,
  done: (title) => `Setup completed for ${title}`,
});

/** The checkout family's flows, by registry action. */
export const CHECKOUT_FLOWS = {
  drop: DROP_FLOW,
  rename: RENAME_FLOW,
  park: PARK_FLOW,
  reclaim: RECLAIM_FLOW,
  retry_setup: RETRY_SETUP_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
