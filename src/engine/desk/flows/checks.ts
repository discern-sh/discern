/** Run checks: reviewed in session from the gate's own plan, run with the terminal. */

import type { DeskFlowStep, DeskPrepared } from "../flow_types.ts";
import {
  type DeskFlowContext,
  failedWith,
  resultPlan,
  reviewedAction,
  stepOffer,
} from "./context.ts";

type ActionStep = Extract<DeskFlowStep, { readonly kind: "action" }>;

/** Run checks: the gate's own dry-run plan, then the gate. */
export async function prepareDone(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "done");
  const cliModel = context.cliModel;
  if (cliModel === undefined) {
    throw new Error("Running checks from the desk needs the live CLI model.");
  }
  const preview = await context.runtime.donePlan(row.entry.path, cliModel);
  return reviewedAction(context, row, offer, {
    plan: resultPlan(preview),
    doing: `Running checks on ${row.task.name}`,
    run: async (command) => {
      const result = await context.runtime.done(row.entry.path, cliModel);
      return result.ok
        ? `Checks passed on ${row.task.name} · Proof recorded`
        : failedWith(command, `Checks failed on ${row.task.name}`, result);
    },
  });
}
