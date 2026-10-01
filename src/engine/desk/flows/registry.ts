/**
 * Every reviewed Desk flow, by the action or command it reviews: the five
 * family modules' flows composed into one table. A step's review and its
 * effect are found here, so a review sheet and its confirm always reach the
 * same flow.
 */

import type { DeskAction } from "../model.ts";
import type { DeskCommand } from "../commands.ts";
import type {
  DeskApplyContext,
  DeskExpected,
  DeskFlowStep,
  DeskOutcome,
  DeskReview,
} from "../flow_types.ts";
import type { DeskFlow, DeskFlowContext } from "./context.ts";
import { LANDING_FLOWS } from "./landing.ts";
import { CHECKOUT_FLOWS } from "./checkout.ts";
import { CHECKS_FLOWS } from "./checks.ts";
import { START_FLOWS } from "./start.ts";
import { CHILDREN_FLOWS } from "./children.ts";

/** The reviewed flows by task action. */
export const DESK_ACTION_FLOWS: Readonly<
  Partial<Record<DeskAction, DeskFlow>>
> = {
  ...LANDING_FLOWS,
  ...CHECKOUT_FLOWS,
  ...CHECKS_FLOWS,
  follow_up: START_FLOWS.follow_up,
  agent: CHILDREN_FLOWS.agent,
  scripts: CHILDREN_FLOWS.scripts,
};

/** The reviewed flows by Desk command. */
export const DESK_COMMAND_FLOWS: Readonly<
  Partial<Record<DeskCommand, DeskFlow>>
> = {
  new_task: START_FLOWS.new_task,
  resume: START_FLOWS.resume,
  main_scripts: CHILDREN_FLOWS.main_scripts,
  updates: CHILDREN_FLOWS.updates,
};

/** The flow a step reviews and applies; a step without one is a caller error. */
export function flowFor(step: DeskFlowStep): DeskFlow {
  const flow = step.kind === "action"
    ? DESK_ACTION_FLOWS[step.action]
    : DESK_COMMAND_FLOWS[step.command];
  if (flow === undefined) {
    throw new TypeError(
      `${step.kind === "action" ? step.action : step.command} has no review`,
    );
  }
  return flow;
}

/** Read one step's review. */
export function reviewStep(
  context: DeskFlowContext,
  step: DeskFlowStep,
): Promise<DeskReview> {
  return flowFor(step).review(context, step);
}

/** Apply one reviewed step with the binding its review captured. */
export function applyStep(
  context: DeskFlowContext,
  step: DeskFlowStep,
  expected: DeskExpected,
  progress: DeskApplyContext,
): Promise<DeskOutcome> {
  return flowFor(step).apply(context, step, expected, progress);
}
