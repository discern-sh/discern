/**
 * The vocabulary Desk flows share with the product state machine.
 *
 * A flow step names what is being reviewed or run, as data, so the state
 * machine can open, replace, and close the layers that show it. A prepared
 * review is what a flow read for that step: the words its sheet shows and
 * what choosing the sheet's confirm does. Running an effect yields an outcome
 * the state machine turns into a message, a result reader, or the next step.
 */

import type { EnginePlan } from "../../shared/result.ts";
import type { DeskCommand } from "../../shared/desk_vocabulary.ts";
import type { Out } from "../output.ts";
import type { DeskAction, DeskConsequenceMark } from "./model.ts";

/** Where a step is in a flow that asks more than one question. */
export type DeskFlowStage =
  /** The flow's own review: its plan, consequences, and command. */
  | "review"
  /** A queue entry asks for the effort grant first. */
  | "grant"
  /** Granting offers a separate next decision. */
  | "granted"
  /** A drop that would discard work asks for the branch name. */
  | "challenge"
  /** A launch whose provider takes no prompt shows the stored brief first. */
  | "brief";

/** What one review, form, or launch concerns: a task action or a command. */
export type DeskFlowStep =
  | {
    readonly kind: "action";
    readonly action: DeskAction;
    /** The task row's identity when the step began. */
    readonly taskId: string;
    readonly stage: DeskFlowStage;
    /** Values a form collected for this step, by field id. */
    readonly values?: Readonly<Record<string, string>>;
  }
  | {
    readonly kind: "command";
    readonly command: DeskCommand;
    /** The branch a branch-row command concerns, when it concerns one. */
    readonly ref?: string;
    readonly stage: DeskFlowStage;
    readonly values?: Readonly<Record<string, string>>;
  };

/** One line of a review body, with the mark it leads with. */
export interface DeskReviewLine {
  /** Absent for plain explanatory text. */
  readonly mark?: DeskConsequenceMark | "failure";
  readonly text: string;
}

/** A button beside a review's confirm that switches to another step. */
export interface DeskReviewAlternative {
  readonly id: string;
  readonly label: string;
  /** Active while focus is on the button row. */
  readonly key?: string;
  readonly step: DeskFlowStep;
}

/** Everything a review sheet shows. */
export interface DeskReviewContent {
  /** The question the sheet asks. */
  readonly title: string;
  readonly lines: readonly DeskReviewLine[];
  /** The plan the effect would follow, shown behind a disclosure. */
  readonly plan?: EnginePlan;
  /** The exact CLI equivalent, shown behind a disclosure. */
  readonly command?: string;
  /** A typed confirmation the destructive button waits for. */
  readonly challenge?: {
    readonly mustEqual: string;
  };
  readonly footnote?: string;
  readonly safeLabel: string;
  readonly confirmLabel: string;
  /** Present when confirming removes or discards work. */
  readonly destructive?: boolean;
  /** Present when confirm cannot run, with why. */
  readonly blocked?: string;
  readonly alternatives?: readonly DeskReviewAlternative[];
}

/** What a step's review read, and what confirming it does. A review
 * without a confirm only offers its safe choice and its alternatives. */
export interface DeskPrepared {
  readonly content: DeskReviewContent;
  readonly confirm?: DeskConfirm;
}

/** Confirming either runs the effect or asks the next question. */
export type DeskConfirm =
  | {
    readonly kind: "apply";
    /** Painted before the terminal is handed to the effect. */
    readonly handoff: string;
    readonly apply: DeskApply;
  }
  | { readonly kind: "review"; readonly step: DeskFlowStep };

/** An effect, run while the terminal belongs to it. */
export type DeskApply = (context: DeskApplyContext) => Promise<DeskOutcome>;

/** What an effect may read while it runs. */
export interface DeskApplyContext {
  readonly out: Out;
  /** The typed confirmation, when the review asked for one. */
  readonly challenge?: string;
}

/** One line of feedback after an effect or a child returns. */
export interface DeskOutcomeMessage {
  readonly tone: "success" | "warning" | "danger" | "muted";
  readonly text: string;
}

/** A retained result to read after an effect failed. */
export interface DeskOutcomeResult {
  readonly title: string;
  /** Markdown the result reader renders. */
  readonly markdown: string;
}

/** What an effect or a child left for the Desk to show. */
export interface DeskOutcome {
  /** The command that ran, for Session activity and the exit log. */
  readonly command: string;
  readonly ok: boolean;
  readonly message?: DeskOutcomeMessage;
  readonly result?: DeskOutcomeResult;
  /** A further question the effect raised. */
  readonly next?: DeskFlowStep;
  /** The checkout the effect created, to select once it is observed. */
  readonly select?: string;
  /** A child that owned the terminal: what to say once it returns. */
  readonly back?: DeskChildReturn;
}

/** A terminal owner that returned, and the task it worked in. */
export interface DeskChildReturn {
  /** What came back, as the message names it: "Claude Code", "the shell". */
  readonly label: string;
  readonly taskId?: string;
  /** The task's uncommitted file count before the child ran. */
  readonly changedBefore?: number;
}

/** A terminal owner the Desk hands the screen to without a review. */
export type DeskChild =
  | { readonly kind: "agent"; readonly taskId: string; readonly launch: string }
  | { readonly kind: "shell"; readonly taskId?: string }
  | { readonly kind: "editor"; readonly taskId?: string }
  | { readonly kind: "diff"; readonly taskId?: string }
  | { readonly kind: "manual" };

/** The sentence under a question: what stays unchanged until its button. */
export function untilChosen(nothing: string, button: string): string {
  return `Nothing ${nothing} until you choose ${button}.`;
}
