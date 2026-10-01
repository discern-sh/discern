/**
 * What every Desk flow reads, and the pieces they share: the task a step
 * concerns, the registry offer it reviews, the plan a preview returned, the
 * revalidation every effect runs first, and outcomes in the Desk's words.
 */

import type { CliModelProvider } from "../../../shared/cli_reference_codegen.ts";
import type { DiscernConfig } from "../../../shared/config_schema.ts";
import type { DiscernResult, EnginePlan } from "../../../shared/result.ts";
import { commandEvidence } from "../../../shared/command_evidence.ts";
import { renderResultReading } from "../../../shared/emit.ts";
import { resultPresenterForVerb } from "../../../shared/result_contracts.ts";
import { WorktreeGitError } from "../../worktree/lifecycle.ts";
import {
  DESK_ACTION_REGISTRY,
  type DeskAction,
  type DeskActionOffer,
  type DeskRow,
} from "../model.ts";
import type { DeskRuntime } from "../desk.ts";
import type { DeskProductState } from "../desk_state.ts";
import { rowRef } from "../desk_transitions.ts";
import type {
  DeskApplyContext,
  DeskFlowStep,
  DeskOutcome,
  DeskOutcomeMessage,
  DeskPrepared,
  DeskReviewContent,
  DeskReviewLine,
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

/** The task row a step concerns, or a refusal naming why it is gone. */
export function stepRow(
  context: DeskFlowContext,
  step: Extract<DeskFlowStep, { readonly kind: "action" }>,
): DeskRow {
  const ref = rowRef(context.state, step.taskId);
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

/**
 * Re-observe before an effect: the task must still be the one reviewed, at
 * its path and on its branch, and nothing it cannot overlap may be running.
 */
export async function verifyTask(
  context: DeskFlowContext,
  row: DeskRow,
  action: DeskAction,
): Promise<void> {
  const observed = await context.runtime.status(context.root);
  const current = observed.data?.fleet?.find((entry) =>
    entry.path === row.entry.path
  );
  if (
    !observed.ok || current === undefined ||
    current.branch !== row.entry.branch || current.id !== row.entry.id
  ) {
    throw new WorktreeGitError(
      "The selected task changed since you reviewed it; nothing ran. Review it again.",
    );
  }
  if (
    current.running !== undefined &&
    !DESK_ACTION_REGISTRY[action].availableWhileRunning
  ) {
    throw new WorktreeGitError(
      `${current.running.verb} is running in this task. Wait for it to finish, then review the action again.`,
    );
  }
}

/** A review of one registry offer: its consequences, the plan's context, its command. */
export function offerContent(
  offer: DeskActionOffer,
  plan: EnginePlan | undefined,
  extra: {
    readonly title?: string;
    readonly lines?: readonly DeskReviewLine[];
    readonly command?: readonly string[];
  } = {},
): DeskReviewContent {
  const policy = offer.confirmation;
  return {
    title: extra.title ?? offer.reviewTitle,
    lines: [
      ...offer.consequence.map((line) => ({
        mark: line.mark,
        text: line.text,
      })),
      ...(extra.lines ?? []),
      ...(plan?.details ?? []).map((detail) => ({ text: detail })),
    ],
    ...(plan === undefined ? {} : { plan }),
    command: commandEvidence(extra.command ?? offer.command.argv),
    safeLabel: policy.kind === "none" ? "Close" : policy.noLabel,
    confirmLabel: policy.kind === "none" ? "Open" : policy.yesLabel,
    ...(offer.action === "drop" ? { destructive: true } : {}),
  };
}

/** A successful effect's outcome. */
export function succeeded(command: string, text: string): DeskOutcome {
  return { command, ok: true, message: { tone: "success", text } };
}

/** A failed effect's outcome, with the retained result to read. */
export function failedWith(
  command: string,
  title: string,
  result: DiscernResult,
  message?: DeskOutcomeMessage,
): DeskOutcome {
  return {
    command,
    ok: false,
    message: message ?? { tone: "danger", text: title },
    result: {
      title,
      markdown: renderResultReading(
        result,
        resultPresenterForVerb(result.verb),
        resultPresenterForVerb,
      ),
    },
  };
}

/** The exact command an offer echoes. */
export function offerCommand(offer: DeskActionOffer): string {
  return commandEvidence(offer.command.argv);
}

/** The task row a step concerns and the registry offer it reviews. */
export function stepOffer(
  context: DeskFlowContext,
  step: Extract<DeskFlowStep, { readonly kind: "action" }>,
  action: DeskAction,
): { readonly row: DeskRow; readonly offer: DeskActionOffer } {
  const row = stepRow(context, step);
  return { row, offer: offerFor(row, action) };
}

/** One reviewed task action: its preview, and the effect its confirm runs. */
export interface ReviewedAction {
  /** The lifecycle core's own preview plan. */
  readonly plan: EnginePlan | undefined;
  /** What the handoff line says the effect is doing. */
  readonly doing: string;
  /** Review lines, title or command beyond the registry offer's. */
  readonly extra?: Parameters<typeof offerContent>[2];
  /**
   * The effect, after the task is revalidated: its outcome, or the sentence
   * a success says.
   */
  readonly run: (
    command: string,
    applied: DeskApplyContext,
  ) => Promise<DeskOutcome | string>;
}

/**
 * Review one registry offer, and on confirm revalidate the task and run its
 * effect with the terminal.
 */
export function reviewedAction(
  context: DeskFlowContext,
  row: DeskRow,
  offer: DeskActionOffer,
  action: ReviewedAction,
): DeskPrepared {
  const argv = action.extra?.command;
  const command = argv === undefined
    ? offerCommand(offer)
    : commandEvidence(argv);
  return {
    content: offerContent(offer, action.plan, action.extra),
    confirm: {
      kind: "apply",
      handoff: `${action.doing} · output continues below`,
      apply: async (applied) => {
        await verifyTask(context, row, offer.action);
        const result = await action.run(command, applied);
        return typeof result === "string" ? succeeded(command, result) : result;
      },
    },
  };
}
