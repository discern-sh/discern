/**
 * What every Desk flow reads, and the pieces they share: the task a step
 * concerns, the registry offer it reviews, the plan a preview returned, the
 * re-observation every effect runs first against the review's binding, and
 * outcomes in the Desk's words.
 *
 * Each flow family module exposes one `DeskFlow` per action or command it
 * owns: `review` reads the lifecycle core's preview and projects the review;
 * `apply` re-observes, refuses when the binding moved, and runs the effect.
 */

import type { CliModelProvider } from "../../../shared/cli_reference_codegen.ts";
import type { DiscernConfig } from "../../../shared/config_schema.ts";
import type { DiscernResult, EnginePlan } from "../../../shared/result.ts";
import { commandEvidence } from "../../../shared/command_evidence.ts";
import { WorktreeGitError } from "../../worktree/lifecycle.ts";
import {
  buildDeskRows,
  DESK_ACTION_REGISTRY,
  type DeskAction,
  type DeskActionOffer,
  type DeskBindingFact,
  deskExceptionArgvs,
  deskObservation,
  type DeskRow,
  deskRowId,
} from "../model.ts";
import type { DeskRuntime } from "../desk.ts";
import type { DeskProductState } from "../desk_state.ts";
import { rowRef, taskTitleOf } from "../desk_transitions.ts";
import { trunkHead } from "../evidence.ts";
import {
  bindingChange,
  type DeskReviewRead,
  type DeskReviewTarget,
  resultSheet,
  reviewDrift,
  reviewFor,
} from "../review.ts";
import type {
  DeskApplyContext,
  DeskExpected,
  DeskFlowStep,
  DeskOutcome,
  DeskOutcomeMessage,
  DeskReview,
} from "../flow_types.ts";

/** Everything a flow reads: the project, its effects, and the observation. */
export interface DeskFlowContext {
  readonly root: string;
  readonly config: DiscernConfig;
  readonly runtime: DeskRuntime;
  readonly cliModel?: CliModelProvider;
  /** The product state when the step began: its rows and observation. */
  readonly state: DeskProductState;
}

/** One reviewed action or command: what its review read, and its effect. */
export interface DeskFlow {
  /** Read the lifecycle core's preview and project the review. */
  review(context: DeskFlowContext, step: DeskFlowStep): Promise<DeskReview>;
  /** Re-observe, refuse when the binding moved, and run the effect. */
  apply(
    context: DeskFlowContext,
    step: DeskFlowStep,
    expected: DeskExpected,
    progress: DeskApplyContext,
  ): Promise<DeskOutcome>;
}

/** The task row a step concerns, or a refusal naming why it is gone. */
export function stepRow(
  context: DeskFlowContext,
  step: DeskFlowStep,
): DeskRow {
  const ref = step.kind === "action"
    ? rowRef(context.state, step.taskId)
    : undefined;
  if (ref?.kind !== "task") {
    throw new WorktreeGitError(
      "The selected task is no longer listed. Nothing changed.",
    );
  }
  return ref.row;
}

/** The registry offer one action makes for this row. */
export function offerFor(row: DeskRow, action: DeskAction): DeskActionOffer {
  const offer = row.decision.actions.find((candidate) =>
    candidate.action === action
  );
  if (offer === undefined) {
    throw new TypeError(`Desk decision is missing the ${action} action`);
  }
  if (offer.availability === "disabled") {
    throw new WorktreeGitError(offer.reason);
  }
  return offer;
}

/** The task row a step concerns and the registry offer it reviews. */
export function stepOffer(
  context: DeskFlowContext,
  step: DeskFlowStep,
  action: DeskAction,
): { readonly row: DeskRow; readonly offer: DeskActionOffer } {
  const row = stepRow(context, step);
  return { row, offer: offerFor(row, action) };
}

/** A preview's plan, or its own refusal. */
export function resultPlan<T>(
  result: DiscernResult<T>,
): EnginePlan | undefined {
  if (!result.ok) {
    throw new WorktreeGitError(
      result.message ?? `${result.verb} could not produce a plan.`,
    );
  }
  return result.plan;
}

/** A review read from a core's dry-run result: its plan, and what it is called while it runs. */
export function previewRead<T>(
  result: DiscernResult<T>,
  running: string,
): DeskReviewRead {
  const plan = resultPlan(result);
  return { ...(plan === undefined ? {} : { plan }), running };
}

/** The live CLI model the gate's flows need to run checks. */
export function liveCliModel(context: DeskFlowContext): CliModelProvider {
  if (context.cliModel === undefined) {
    throw new Error("Running checks from the desk needs the live CLI model.");
  }
  return context.cliModel;
}

/** The review target for one task's offer, with the trunk it was read at. */
export function actionTarget(
  context: DeskFlowContext,
  row: DeskRow,
  offer: DeskActionOffer,
): DeskReviewTarget {
  const head = trunkHead(context.state.data);
  return {
    kind: "action",
    row,
    offer,
    ...(head === undefined ? {} : { trunkHead: head }),
  };
}

/** Review one task's offer from what its flow read. */
export async function reviewOffer(
  context: DeskFlowContext,
  step: DeskFlowStep,
  action: DeskAction,
  read: (
    row: DeskRow,
    offer: DeskActionOffer,
  ) => DeskReviewRead | Promise<DeskReviewRead>,
): Promise<DeskReview> {
  const { row, offer } = stepOffer(context, step, action);
  return reviewFor(actionTarget(context, row, offer), await read(row, offer));
}

/** The task as a fresh survey sees it, with the trunk's head. */
async function observeTask(
  context: DeskFlowContext,
  taskId: string,
): Promise<{ readonly row?: DeskRow; readonly trunkHead?: string }> {
  const observed = await context.runtime.status(context.root);
  const data = observed.data;
  if (!observed.ok || data === undefined) {
    throw new WorktreeGitError(
      `${
        observed.message ?? "The status survey failed"
      }. Nothing ran; review it again once the task can be read.`,
    );
  }
  const row = buildDeskRows(
    data.fleet ?? [],
    new Map(),
    new Map(),
    deskObservation(data, {
      trunk: context.config.repository.trunk,
      nowMs: context.runtime.now(),
      exceptionArgvs: await deskExceptionArgvs(data),
    }),
  ).find((candidate) => deskRowId(candidate) === taskId);
  const head = trunkHead(data);
  return {
    ...(row === undefined ? {} : { row }),
    ...(head === undefined ? {} : { trunkHead: head }),
  };
}

/**
 * Re-observe the task an effect concerns and hold it to the review's
 * binding: nothing runs when it is gone, when a discern verb it cannot
 * overlap is running there, or when an observed binding fact moved. A moved
 * fact asks for the same review again.
 */
export async function rebound(
  context: DeskFlowContext,
  step: DeskFlowStep,
  expected: DeskExpected,
  action: DeskAction,
): Promise<DeskOutcome | undefined> {
  const row = stepRow(context, step);
  const command = commandEvidence(offerFor(row, action).command.argv);
  const seen = await observeTask(context, deskRowId(row));
  if (seen.row === undefined) {
    return {
      command,
      ok: false,
      message: {
        tone: "warning",
        text: `${row.task.name} is gone; nothing ran`,
      },
    };
  }
  const running = seen.row.entry.running;
  if (
    running !== undefined &&
    !DESK_ACTION_REGISTRY[action].availableWhileRunning
  ) {
    return {
      command,
      ok: false,
      message: {
        tone: "warning",
        text:
          `${running.verb} is running in ${row.task.name}; nothing ran. Review it again once it finishes`,
      },
    };
  }
  const moved = reviewDrift(expected, {
    row: seen.row,
    ...(seen.trunkHead === undefined ? {} : { trunkHead: seen.trunkHead }),
  });
  return moved === undefined ? undefined : changedSince(command, step, moved);
}

/** An effect that refused because `moved` since its review: review it again. */
export function changedSince(
  command: string,
  step: DeskFlowStep,
  moved: string,
): DeskOutcome {
  return {
    command,
    ok: false,
    message: {
      tone: "warning",
      text: `Changed since you reviewed it: ${moved}; nothing ran`,
    },
    next: step,
  };
}

/**
 * Hold one binding fact the apply reads again itself to its review: the
 * refusal when the fact moved, or nothing when it holds.
 */
export function recheck(
  context: DeskFlowContext,
  step: DeskFlowStep,
  expected: DeskExpected,
  command: string,
  fact: DeskBindingFact,
  now: string,
): DeskOutcome | undefined {
  const reviewed = expected.facts[fact];
  return reviewed === undefined || reviewed === now ? undefined : changedSince(
    command,
    step,
    bindingChange(fact, context.config.repository.trunk),
  );
}

/** A successful effect's outcome. */
export function succeeded(command: string, text: string): DeskOutcome {
  return { command, ok: true, message: { tone: "success", text } };
}

/** A failed effect's outcome, with its result sheet. */
export function failedWith(
  context: DeskFlowContext,
  step: DeskFlowStep,
  action: DeskAction,
  result: DiscernResult,
  command: string,
  message?: DeskOutcomeMessage,
): DeskOutcome {
  const ref = step.kind === "action"
    ? rowRef(context.state, step.taskId)
    : undefined;
  const sheet = resultSheet(
    {
      action,
      title: ref?.kind === "task" ? ref.row.task.name : "This task",
      trunk: context.config.repository.trunk,
      ...(step.kind === "action" ? { taskId: step.taskId } : {}),
      titleOf: (branch) => taskTitleOf(context.state, branch),
    },
    result,
    command,
  );
  return {
    command,
    ok: false,
    message: message ?? { tone: sheet.tone, text: sheet.title },
    result: sheet,
  };
}

/** The exact command an offer echoes. */
export function offerCommand(offer: DeskActionOffer): string {
  return commandEvidence(offer.command.argv);
}
