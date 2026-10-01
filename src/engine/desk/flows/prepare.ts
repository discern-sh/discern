/** The review each flow step reads, by its action or command and stage. */

import type { DeskFlowStep, DeskPrepared } from "../flow_types.ts";
import type { DeskFlowContext } from "./context.ts";
import { prepareDone } from "./checks.ts";
import { isPlainAction, preparePlain } from "./plain.ts";
import {
  prepareAccept,
  prepareGrant,
  prepareGranted,
  prepareSubmit,
  prepareSubmitGrant,
} from "./landing.ts";
import { prepareDrop, prepareRename } from "./checkout.ts";
import { prepareStart } from "./start.ts";
import { prepareBrief, prepareUpdates } from "./children.ts";

/** Read one step's review. A step without one is a caller error. */
export async function prepareStep(
  context: DeskFlowContext,
  step: DeskFlowStep,
): Promise<DeskPrepared> {
  if (step.kind === "command") {
    switch (step.command) {
      case "updates":
        return prepareUpdates(context);
      case "new_task":
      case "resume":
        return await prepareStart(context, step);
      default:
        throw new TypeError(`${step.command} has no review`);
    }
  }
  if (isPlainAction(step.action)) {
    return await preparePlain(context, step, step.action);
  }
  switch (step.action) {
    case "done":
      return await prepareDone(context, step);
    case "accept":
      return await prepareAccept(context, step);
    case "submit":
      return step.stage === "grant"
        ? await prepareSubmitGrant(context, step)
        : await prepareSubmit(context, step);
    case "grant":
      return step.stage === "granted"
        ? prepareGranted(context, step)
        : await prepareGrant(context, step);
    case "drop":
      return await prepareDrop(context, step);
    case "rename":
      return await prepareRename(context, step);
    case "follow_up":
      return await prepareStart(context, step);
    case "agent":
      return prepareBrief(context, step);
    default:
      throw new TypeError(`${step.action} has no review`);
  }
}
