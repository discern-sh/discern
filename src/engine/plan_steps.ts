/**
 * Plan steps as their executors run them.
 *
 * A plan names its steps before anything runs (`EnginePlan`), and an
 * executor records how each turned out (`StepResult`). Between the two, a
 * live view of the plan needs to know which step is running and which have
 * settled. Executors report that here, as `step` completion facts named by
 * the plan's own labels: `stepStarted` when a step begins, and
 * `recordSteps` when a step's result is recorded, which also reports how it
 * settled. Nothing here changes what runs or what the result says.
 *
 * An operation that runs several plans — a landing that walks the queue
 * after its own — names whose plan a step belongs to with `withStepSubject`,
 * so a view of the first plan can tell the follower's steps apart.
 */

import { SYSTEM_CLOCK } from "../shared/clock.ts";
import { AsyncLocalStorage } from "../shared/module_loading.ts";
import {
  PLAN_STEP_STATE_BY_OUTCOME,
  type PlanStepState,
  type StepResult,
} from "../shared/result.ts";
import { emitCompletionStep } from "./completion/events.ts";

const subjects = new AsyncLocalStorage<string>();

/** Run `work` with every step it reports belonging to `subject`'s plan. */
export async function withStepSubject<T>(
  subject: string,
  work: () => Promise<T>,
): Promise<T> {
  return await subjects.run(subject, work);
}

/** Report one step's transition, stamped now. */
export function reportStep(label: string, state: PlanStepState): void {
  const subject = subjects.getStore();
  emitCompletionStep({
    label,
    state,
    at: SYSTEM_CLOCK.wallNow(),
    ...(subject === undefined ? {} : { subject }),
  });
}

/** Report that the step the plan labels `label` began. */
export function stepStarted(label: string): void {
  reportStep(label, "started");
}

/** Report how one recorded step settled. */
export function stepSettled(result: StepResult): void {
  reportStep(result.step.label, PLAN_STEP_STATE_BY_OUTCOME[result.outcome]);
}

/** Record settled steps onto an executor's results and report each. */
export function recordSteps(
  steps: StepResult[],
  ...settled: readonly StepResult[]
): void {
  for (const result of settled) {
    steps.push(result);
    stepSettled(result);
  }
}
