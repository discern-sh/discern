/**
 * The vocabulary Desk flows share with the product state machine.
 *
 * A flow step names what is being reviewed or run, as data, so the state
 * machine can open, replace, and close the layers that show it. A review is
 * what a flow read for that step: the question, its sourced consequence
 * lines, the blockers that keep confirm disabled, the binding its apply is
 * held to, and the exact plan and command one key away. Applying a review
 * yields an outcome the state machine turns into a message, a result sheet,
 * or the next step. Everything here is data.
 */

import type { EnginePlan } from "../../shared/result.ts";
import type { DeskCommand } from "../../shared/desk_vocabulary.ts";
import type { SubmissionRevision } from "../../shared/result_schemas.ts";
import type { Out } from "../output.ts";
import type { PreparedStart } from "../worktree/lifecycle.ts";
import type { DropPlan } from "../worktree/plan.ts";
import type {
  DeskAction,
  DeskBindingFact,
  DeskConsequenceMark,
} from "./model.ts";
import type { DeskDiffCounts, DeskReviewSource } from "./review_facts.ts";
import type { DeskIntent, DeskScriptOwner } from "./desk_state.ts";

/**
 * Where a step is in a flow that asks more than one question: its own
 * review; the separate next decision after a grant; and the stored brief a
 * launch shows first when its provider takes no prompt.
 */
export const DESK_FLOW_STAGES = ["review", "granted", "brief"] as const;
export type DeskFlowStage = (typeof DESK_FLOW_STAGES)[number];

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

/** A review line's mark: a consequence, or what stopped a failed effect. */
export type DeskReviewMark = DeskConsequenceMark | "failure";

/** One line of a review body: its mark, its words, and what they rest on. */
export interface DeskReviewLine {
  readonly mark: DeskReviewMark;
  readonly text: string;
  readonly diff?: DeskDiffCounts;
  /** Lines indented beneath it, such as the paths that conflict. */
  readonly detail?: readonly string[];
  readonly source: DeskReviewSource;
}

/** The task a review concerns. */
export interface DeskReviewSubject {
  readonly id: string;
  readonly title: string;
  readonly branch: string;
  readonly path: string;
}

/**
 * What a lifecycle core compares at its own effect boundary, captured from
 * the preview the review showed.
 */
export type DeskCoreExpectation =
  | { readonly kind: "accept"; readonly revision?: SubmissionRevision }
  | { readonly kind: "submit"; readonly revision: SubmissionRevision }
  | { readonly kind: "drop"; readonly plan?: DropPlan }
  | {
    readonly kind: "start";
    readonly prepared: PreparedStart;
    /** The agent launch Create opens in the new checkout. */
    readonly launch?: string;
  }
  | { readonly kind: "rename"; readonly title: string }
  | {
    readonly kind: "script";
    readonly owner: DeskScriptOwner;
    readonly name: string;
    readonly args: readonly string[];
  }
  | { readonly kind: "brief"; readonly launch: string };

/**
 * The revision binding: the observed facts the registry's `binding` names,
 * as the review saw them, plus what the core compares itself. Applying
 * re-observes first and refuses when any observed fact moved.
 */
export interface DeskExpected {
  readonly facts: Readonly<Partial<Record<DeskBindingFact, string>>>;
  readonly core?: DeskCoreExpectation;
}

/** What a review keeps one key away. */
export interface DeskReviewDisclosures {
  /** The exact plan the effect follows, rendered by the shared renderer. */
  readonly plan?: EnginePlan;
  /** The exact CLI equivalent with its actual flags. */
  readonly command: string;
  /** The changes a landing lands, for the task the review concerns. */
  readonly changes?: {
    readonly taskId: string;
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
  };
  /** A finished effect's complete output, as Markdown. */
  readonly output?: string;
  /** A disclosure that opens with the sheet, such as an exception's command. */
  readonly open?: "command" | "output";
}

/** A button beside a review's confirm that does something else instead. */
export interface DeskReviewAlternative {
  readonly id: string;
  readonly label: string;
  /** Active while focus is on the button row. */
  readonly key?: string;
  /** What choosing it does; the sheet closes first. */
  readonly intent: DeskIntent;
}

/** Confirming either runs the effect or asks the next question. */
export type DeskConfirm =
  | {
    readonly kind: "apply";
    /**
     * What the effect is called while it runs: its progress sheet's title,
     * or the line painted before a launch takes the terminal.
     */
    readonly running: string;
  }
  | { readonly kind: "review"; readonly step: DeskFlowStep };

/** A queued task that lands after the reviewed one, in walk order. */
export interface DeskFollowingTask {
  readonly branch: string;
  readonly title: string;
}

/** Everything a review sheet shows, and what confirming it does. */
export interface DeskReview {
  /** The question the sheet asks. */
  readonly question: string;
  readonly subject?: DeskReviewSubject;
  /** Consequences first, each sourced, never dropped for space. */
  readonly lines: readonly DeskReviewLine[];
  /** Why confirm cannot run; it stays disabled while any remain. */
  readonly blockers: readonly string[];
  readonly expected: DeskExpected;
  readonly disclosures: DeskReviewDisclosures;
  readonly safeLabel: string;
  /** Absent when the sheet only offers its safe choice and alternatives. */
  readonly confirmLabel?: string;
  /** Confirming removes or discards work. */
  readonly destructive?: boolean;
  readonly alternatives: readonly DeskReviewAlternative[];
  /** A typed confirmation the destructive button waits for. */
  readonly challenge?: { readonly mustEqual: string };
  /** The sentence beside the buttons. */
  readonly footnote?: string;
  readonly confirm?: DeskConfirm;
  /** Queued tasks that land after it, which its progress names under Then. */
  readonly follows?: readonly DeskFollowingTask[];
}

/** What an effect may read while it runs. */
export interface DeskApplyContext {
  readonly out: Out;
  /** The typed confirmation, when the review asked for one. */
  readonly challenge?: string;
  /** The agent launch a form's second confirm opens once it has run. */
  readonly open?: string;
}

/** One line of feedback after an effect or a child returns. */
export interface DeskOutcomeMessage {
  readonly tone: "success" | "warning" | "danger" | "muted";
  readonly text: string;
}

/**
 * A failed effect's result sheet: what stopped, what did not change, and
 * what to do next, with the full output and the command one key away.
 */
export interface DeskResultSheet {
  readonly title: string;
  readonly lines: readonly DeskReviewLine[];
  /** The complete output, as Markdown. */
  readonly output?: string;
  readonly command: string;
  /** The task it concerns, whose next steps the sheet offers. */
  readonly taskId?: string;
}

/** What an effect or a child left for the Desk to show. */
export interface DeskOutcome {
  /** The command that ran, for Session activity and the exit log. */
  readonly command: string;
  readonly ok: boolean;
  readonly message?: DeskOutcomeMessage;
  readonly result?: DeskResultSheet;
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
