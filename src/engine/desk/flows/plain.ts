/**
 * The lifecycle actions whose review is the core's own plan and whose effect
 * reports nothing beyond completing: retry setup, park, reclaim, update from
 * the trunk, and revoke pre-authorization. One table holds what differs.
 */

import type { LifecycleContext } from "../../worktree/lifecycle.ts";
import type { EnginePlan } from "../../../shared/result.ts";
import type { DeskRuntime } from "../desk.ts";
import type { DeskRow } from "../model.ts";
import type { DeskFlowStep, DeskPrepared } from "../flow_types.ts";
import {
  type DeskFlowContext,
  resultPlan,
  reviewedAction,
  stepOffer,
} from "./context.ts";

/** What one plain action reads, does, and says. */
interface PlainAction {
  /** Where the lifecycle core runs: the task's checkout or the main one. */
  readonly at: "task" | "root";
  readonly plan: (
    runtime: DeskRuntime,
    ctx: LifecycleContext,
    row: DeskRow,
  ) => Promise<EnginePlan | undefined> | EnginePlan | undefined;
  readonly run: (
    runtime: DeskRuntime,
    ctx: LifecycleContext,
    row: DeskRow,
  ) => Promise<unknown> | unknown;
  /** The handoff and success sentences, by task title and trunk. */
  readonly doing: (title: string, trunk: string) => string;
  readonly done: (title: string, trunk: string) => string;
}

/** Every plain action, by its registry id. */
const PLAIN_ACTIONS = {
  retry_setup: {
    at: "task",
    plan: (runtime, ctx) => runtime.setupPlan(ctx),
    run: (runtime, ctx) => runtime.setup(ctx),
    doing: (title) => `Retrying setup for ${title}`,
    done: (title) => `Setup completed for ${title}`,
  },
  park: {
    at: "root",
    plan: (runtime, ctx, row) => runtime.parkPlan(ctx, row.entry.path),
    run: (runtime, ctx, row) => runtime.park(ctx, row.entry.path),
    doing: (title) => `Parking ${title}`,
    done: (title) => `Parked ${title}; its branch is kept`,
  },
  reclaim: {
    at: "root",
    plan: (runtime, ctx, row) => runtime.reclaimPlan(ctx, row.entry.path),
    run: (runtime, ctx, row) => runtime.reclaim(ctx, row.entry.path),
    doing: (title) => `Reclaiming ${title}'s checkout`,
    done: (title) => `Reclaimed ${title}'s checkout; its branch is kept`,
  },
  update: {
    at: "task",
    plan: async (runtime, ctx) => resultPlan(await runtime.updatePlan(ctx)),
    run: (runtime, ctx) => runtime.update(ctx, {}),
    doing: (title, trunk) => `Updating ${title} from ${trunk}`,
    done: (title, trunk) => `Updated ${title} from ${trunk}`,
  },
  revoke_grant: {
    at: "task",
    plan: (runtime, _ctx, row) => runtime.clearEffortGrantPlan(row.entry.path),
    run: (runtime, _ctx, row) => runtime.clearEffortGrant(row.entry.path),
    doing: (title) => `Revoking pre-authorization for ${title}`,
    done: (title) => `Revoked pre-authorization for ${title}`,
  },
} as const satisfies Readonly<Record<string, PlainAction>>;

/** The actions this table reviews. */
export type PlainActionId = keyof typeof PLAIN_ACTIONS;

/** Whether an action is reviewed and run by the table. */
export function isPlainAction(action: string): action is PlainActionId {
  return Object.hasOwn(PLAIN_ACTIONS, action);
}

/** Review one plain action from its core's plan, then run it. */
export async function preparePlain(
  context: DeskFlowContext,
  step: Extract<DeskFlowStep, { readonly kind: "action" }>,
  action: PlainActionId,
): Promise<DeskPrepared> {
  const plain: PlainAction = PLAIN_ACTIONS[action];
  const { row, offer } = stepOffer(context, step, action);
  const { runtime } = context;
  const ctx = await runtime.lifecycle(
    plain.at === "task" ? row.entry.path : context.root,
  );
  const title = row.task.name;
  const trunk = context.config.repository.trunk;
  return reviewedAction(context, row, offer, {
    plan: await plain.plan(runtime, ctx, row),
    doing: plain.doing(title, trunk),
    run: async () => {
      await plain.run(runtime, ctx, row);
      return plain.done(title, trunk);
    },
  });
}
