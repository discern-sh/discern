/**
 * The Desk's product state machine.
 *
 * `deskProduct(state, event)` is pure and owns only product state: the
 * latest observation, the layers that exist with their product subjects,
 * pending reads, messages, preferences, and this session's activity. The
 * package owns everything that moves on screen (selection, focus, scroll,
 * folds, zoom, field editing, message timing); events carry the read-only
 * snapshot of it they need, and nothing here stores it. Effects describe the
 * work the live controller performs: surveys, reads, operations that run
 * beside the screen, and terminal handoffs.
 */

import type { TerminalApplicationDismissTarget } from "discern-design-system/cli/interactive";
import {
  liveTailLimit,
  liveTailOutput,
  liveTailOutputLines,
  type StreamedOutput,
  streamedOutputIsBlank,
} from "../../lib/live_tail.ts";
import {
  DEFAULT_TERMINAL_COLUMNS,
  DEFAULT_TERMINAL_ROWS,
} from "../../lib/terminal.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import type { EnginePlan } from "../../shared/result.ts";
import type { DeskAction, DeskCommand } from "../../shared/desk_vocabulary.ts";
import {
  type DeskCapabilities,
  type DeskRow,
  deskRowId,
  withDeskCapabilities,
} from "./model.ts";
import type { DeskPreferences } from "./preferences.ts";
import type { DeskProjectScriptInventory } from "../project_scripts.ts";
import type { DeskChangesEvidence } from "./contracts.ts";
import type {
  DeskChild,
  DeskChildReturn,
  DeskFlowStep,
  DeskLeftTask,
  DeskOutcome,
  DeskResultSheet,
  DeskReview,
} from "./flow_types.ts";
import type { DeskOperationProgress } from "./operations.ts";
import {
  type DeskEvidenceCache,
  type DeskEvidenceRead,
  type DeskEvidenceSubject,
  emptyEvidenceCache,
  rememberEvidence,
} from "./evidence.ts";
import { intentTransition } from "./desk_intent.ts";
import {
  closeLayer,
  departureMessage,
  departures,
  deskMessageId,
  type DeskMessageTopic,
  formValuesKey,
  heldForOperations,
  layerId,
  observedRows,
  open,
  refresh,
  resurvey,
  rowTitle,
  taskOperation,
  toast,
  updateLayer,
  withLanded,
  withRows,
} from "./desk_transitions.ts";
import { FLEET_ROW_GROUP_TITLES } from "../status/row_states.ts";
import { compactDuration } from "../output.ts";
import { DESK_GLYPHS, MESSAGE_MARKS } from "./glyphs.ts";
import type { DeskTip } from "./tips.ts";
import {
  FLEET_OWNER_GROUPS,
  FLEET_ROW_GROUPS,
} from "../../shared/fleet_row_vocabulary.ts";

/**
 * Survey cadence: one at a time, this long after the last finished. An
 * operation's end starts a superseding survey at once instead.
 */
export const DESK_REFRESH_MS = 5_000;

/** Consecutive failed surveys before the Desk says it is offline. */
export const DESK_OFFLINE_FAILURES = 2;

/** An asynchronous read and what it produced. */
export type DeskLoad<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: string };

/**
 * The manual, read once as the session starts so it opens at once: still
 * reading, ready to open in place of the inbox, or why it can't.
 */
export type DeskManualStatus =
  | { readonly state: "loading" }
  | { readonly state: "ready" }
  | { readonly state: "failed"; readonly error: string };

/** A rendered reading a reader shows once its read finishes. */
export interface DeskMarkdownReading {
  readonly markdown: string;
}

/** A finished read, tagged with the kind of reader it fills. */
export type DeskReadResult =
  | { readonly kind: "changes"; readonly load: DeskLoad<DeskChangesEvidence> }
  | {
    readonly kind: "markdown";
    readonly load: DeskLoad<DeskMarkdownReading>;
  };

/** What a reader layer shows. */
export type DeskReaderSubject =
  | { readonly kind: "keys" }
  | { readonly kind: "tip" }
  | { readonly kind: "landing" }
  | { readonly kind: "main" }
  | { readonly kind: "activity" }
  | { readonly kind: "recovery"; readonly taskId: string }
  | {
    readonly kind: "changes";
    readonly taskId: string;
    readonly load: DeskLoad<DeskChangesEvidence>;
  }
  | {
    readonly kind: "branch";
    readonly branch: string;
    readonly load: DeskLoad<DeskMarkdownReading>;
  }
  | {
    readonly kind: "landed";
    readonly ref: string;
    readonly load: DeskLoad<DeskMarkdownReading>;
  }
  | {
    readonly kind: "notice";
    readonly title: string;
    readonly lines: readonly string[];
  }
  /** What a running operation has written so far. */
  | { readonly kind: "output"; readonly operationId: string }
  /** What a page opened beside the screen left, once it has opened. */
  | {
    readonly kind: "opened";
    readonly title: string;
    /** What the reader says until the page has opened. */
    readonly running: string;
    readonly load: DeskLoad<DeskMarkdownReading>;
  };

/** Whose Project Scripts a picker lists. */
export type DeskScriptOwner =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "main" };

/** One layer that exists, bottom to top, with the product subject it shows. */
export type DeskLayer =
  /** Every action for a task row or a parked branch row. */
  | { readonly kind: "actions"; readonly rowId: string }
  | { readonly kind: "palette" }
  | { readonly kind: "agents"; readonly taskId: string }
  | {
    readonly kind: "scripts";
    readonly owner: DeskScriptOwner;
    readonly load: DeskLoad<DeskProjectScriptInventory>;
  }
  | { readonly kind: "reader"; readonly reader: DeskReaderSubject }
  | {
    readonly kind: "review";
    readonly step: DeskFlowStep;
    readonly load: DeskLoad<DeskReview>;
    /**
     * The read this opening waits for. A read that finishes for an earlier
     * opening under the same id, such as the same action on another task,
     * is set aside.
     */
    readonly read?: number;
  }
  | {
    readonly kind: "form";
    readonly step: DeskFlowStep;
    /** The field values the package last reported, by field id. */
    readonly values: Readonly<Record<string, string>>;
    /** The review of the values it was read for, which confirm applies. */
    readonly load: DeskLoad<DeskReview>;
    /** The values `load` was read for, as `formValuesKey` spells them. */
    readonly readFor?: string;
    /** The read it waits for: the latest one its values started. */
    readonly read?: number;
  }
  /** A failed effect's result sheet. */
  | { readonly kind: "result"; readonly sheet: DeskResultSheet }
  /** A running operation's progress: the reviewed plan, worked through. */
  | { readonly kind: "progress"; readonly operationId: string }
  /** Quitting while operations run asks first. */
  | { readonly kind: "quit" };

/** One line on the message row. */
export interface DeskMessage {
  /**
   * Unique per message, so a dismissal names exactly one; it leads with the
   * message's topic ({@linkcode deskMessageId}).
   */
  readonly id: string;
  /** What the message is about. */
  readonly topic: DeskMessageTopic;
  /** The tone of the message's mark; its words read in neutral text. */
  readonly tone: "success" | "warning" | "danger" | "muted" | "accent";
  readonly text: string;
  /** What it found, after the lead and in ink: a return's result. */
  readonly detail?: string;
  /** A faint word before the text, such as the tip's `Tip`. */
  readonly lead?: string;
  /** A leading glyph such as `!` or `←`. */
  readonly mark?: { readonly unicode: string; readonly ascii: string };
  /** A key hint at the far right, such as `r Retry`. */
  readonly key?: { readonly key: string; readonly label: string };
  /** Persistent warnings stay until their cause clears or Escape. */
  readonly persistent?: boolean;
  /**
   * The tasks an operation's outcome concerns, such as a landing and the
   * queued tasks that landed with it: while this message shows, a move
   * their rows make because of that outcome says nothing more.
   */
  readonly tasks?: readonly string[];
}

/** One effect or child this session ran, for Session activity and exit. */
export interface DeskActivity {
  readonly at: number;
  readonly command: string;
  readonly ok: boolean;
  readonly summary?: string;
  /** How it ended, when it ran beside the screen: its outcome in a word. */
  readonly ended?: "done" | "failed" | "stopped";
  /** The last lines it wrote, when it ran beside the screen. */
  readonly output?: StreamedOutput;
}

/** How one activity ended, in the words Session activity and the exit list use. */
export type DeskActivityEnding = "done" | "didn't complete" | "stopped";

/** How one activity ended. */
export function activityEnding(entry: DeskActivity): DeskActivityEnding {
  if (entry.ended === "stopped") return "stopped";
  return (entry.ended ?? (entry.ok ? "done" : "failed")) === "done"
    ? "done"
    : "didn't complete";
}

/** How many of its last written lines Session activity shows for an entry. */
export const DESK_ACTIVITY_SUMMARY_LINES = 3;

/**
 * The code units one streamed line keeps in Session activity, which lays out
 * every row it keeps: no more than fits the summary's rows at the width
 * discern assumes for a terminal it cannot measure. A Desk view is built
 * without the viewport's size; the package still lays the text out at the
 * real width.
 */
export const DESK_ACTIVITY_LINE_LIMIT = liveTailLimit(
  "fit",
  DEFAULT_TERMINAL_COLUMNS,
  DESK_ACTIVITY_SUMMARY_LINES,
);

/** The last lines an activity wrote, blank lines left out. */
export function activityOutputSummary(entry: DeskActivity): readonly string[] {
  return entry.output === undefined ? [] : liveTailOutputLines(
    entry.output,
    DESK_ACTIVITY_SUMMARY_LINES,
    DESK_ACTIVITY_LINE_LIMIT,
    "…",
  );
}

/**
 * One Desk-owned effect running beside the screen: the reviewed step it
 * applies, what it is called, the plan and command it follows, and its
 * progress so far.
 */
export interface DeskOperation {
  /** The package command that runs it. */
  readonly id: string;
  readonly step: DeskFlowStep;
  /** The review it applies, whose binding its effect is held to. */
  readonly review: DeskReview;
  readonly challenge?: string;
  /** The task row it concerns, when it concerns one. */
  readonly taskId?: string;
  /** The verb status names the running task by, as its command records it. */
  readonly verb: string;
  /** Its progress sheet's title, such as "Landing Manual concision". */
  readonly title: string;
  readonly command: string;
  readonly plan?: EnginePlan;
  /** Wall time it started, for its row's running time. */
  readonly startedAt: number;
  readonly progress: DeskOperationProgress;
  /** The last lines it wrote. */
  readonly output: StreamedOutput;
  /** The owner asked it to stop. */
  readonly stopping?: boolean;
}

/** A row that left the inbox, and why, for the message that names it. */
export interface DeskDeparture {
  readonly title: string;
  readonly reason: "landed" | "parked" | "resumed" | "removed";
  /**
   * The operation that took it out already said so, in its message or its
   * result sheet, so its departure says nothing more.
   */
  readonly announced?: boolean;
}

/** The survey's progress: one at a time, with a single queued follow-up. */
export interface DeskSurvey {
  readonly generation: number;
  readonly inFlight: boolean;
  readonly followUp: boolean;
  readonly failures: number;
  /** When the adopted observation was read. */
  readonly observedAt?: number;
  readonly error?: string;
}

/** A child that returned, waiting for the next observation to say what it changed. */
export type DeskPendingReturn = DeskChildReturn;

/** Everything the Desk itself knows. */
export interface DeskProductState {
  readonly trunk: string;
  readonly survey: DeskSurvey;
  readonly data?: StatusData;
  /** Status's own hints for the fleet, verbatim. */
  readonly hints: readonly string[];
  readonly rows: readonly DeskRow[];
  readonly exceptionArgvs: ReadonlyMap<string, readonly string[]>;
  /** Agent and script discovery per task, from the selected-item slot. */
  readonly capabilities: ReadonlyMap<string, DeskCapabilities>;
  readonly evidence: DeskEvidenceCache;
  readonly layers: readonly DeskLayer[];
  readonly message?: DeskMessage;
  /** A persistent warning shown when no message is. */
  readonly warning?: DeskMessage;
  /** The owner closed the offline warning; it returns after a success. */
  readonly offlineDismissed?: boolean;
  readonly preferences: DeskPreferences;
  readonly tip?: DeskTip;
  readonly activity: readonly DeskActivity[];
  readonly departed: ReadonlyMap<string, DeskDeparture>;
  /**
   * Tasks a finished operation took out of the inbox, kept out of the list
   * until the next survey reads the fleet as it left it.
   */
  readonly gone: ReadonlySet<string>;
  readonly pendingReturn?: DeskPendingReturn;
  /** A checkout an effect created, selected once a survey lists it. */
  readonly pendingSelect?: string;
  /** Effects running beside the screen, by id. */
  readonly operations: ReadonlyMap<string, DeskOperation>;
  readonly manual: DeskManualStatus;
  /** Counts messages and operations so every id is new. */
  readonly serial: number;
}

/** What the package reports about the screen when an input arrives. */
export interface DeskUi {
  /** The selected list item, when an item holds the selection. */
  readonly selected?: string;
  /** The selected group row, when a group holds the selection. */
  readonly selectedGroup?: string;
  readonly topLayerId?: string;
  readonly zoomed: boolean;
  /** Field values by layer, then field. */
  readonly fields: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** What a key, row, menu item, button, or reader key asks the Desk to do. */
export type DeskIntent =
  /** A base-layer key, resolved against the selected row's key map. */
  | { readonly kind: "key"; readonly key: string }
  /** A row's next step, or the Needs you route to it. */
  | { readonly kind: "next"; readonly id: string }
  | {
    readonly kind: "action";
    readonly action: DeskAction;
    readonly id: string;
    /**
     * Offer every choice the action has rather than the one remembered: the
     * actions menu's Open agent shows the launch picker.
     */
    readonly choose?: boolean;
  }
  | {
    readonly kind: "command";
    readonly command: DeskCommand;
    readonly ref?: string;
  }
  /** Go to a row from the palette. */
  | { readonly kind: "select"; readonly id: string }
  /** A sheet's or form's confirm button; `open` also opens an agent. */
  | {
    readonly kind: "confirm";
    readonly layer: string;
    readonly open?: string;
  }
  /** Read a review again after its subject changed. */
  | { readonly kind: "review-again"; readonly layer: string }
  /** A sheet's alternative button. */
  | {
    readonly kind: "alternative";
    readonly layer: string;
    readonly id: string;
  }
  /** An agent picker row. */
  | {
    readonly kind: "launch";
    readonly taskId: string;
    readonly launch: string;
  }
  /** A script picker row. */
  | { readonly kind: "script"; readonly name: string }
  /** A reader's own key that lends the terminal to a child. */
  | { readonly kind: "child"; readonly child: DeskChild }
  /** Reopen the progress of an operation running for a task. */
  | { readonly kind: "progress"; readonly operationId: string }
  /** Stop the operation the open progress sheet shows. */
  | { readonly kind: "stop" }
  /** Read what the operation the open progress sheet shows has written. */
  | { readonly kind: "output" }
  /** Leave although operations run: each stops through its journal. */
  | { readonly kind: "quit-anyway" };

/** How the package moved the selected item when a view changed. */
export type DeskSelectionMove =
  | { readonly kind: "regrouped"; readonly from: string; readonly to: string }
  | { readonly kind: "removed"; readonly replacement?: string };

/** One input to the state machine. */
export type DeskEvent =
  | { readonly kind: "refresh" }
  | {
    readonly kind: "observed";
    readonly generation: number;
    readonly now: number;
    readonly data: StatusData;
    readonly hints: readonly string[];
    readonly exceptionArgvs: ReadonlyMap<string, readonly string[]>;
  }
  | {
    readonly kind: "observation-failed";
    readonly generation: number;
    readonly now: number;
    readonly error: string;
  }
  | {
    readonly kind: "capabilities";
    readonly taskId: string;
    readonly capabilities: DeskCapabilities;
    readonly now: number;
  }
  | {
    readonly kind: "evidence";
    /** The item the slot read for, whose parts the read keeps or reuses. */
    readonly subject: DeskEvidenceSubject;
    /** The parts it read; the rest it found kept. */
    readonly read: DeskEvidenceRead;
  }
  | { readonly kind: "tip"; readonly tip: DeskTip }
  | {
    readonly kind: "intent";
    readonly intent: DeskIntent;
    readonly ui: DeskUi;
    /** Wall time, for what the Desk records. */
    readonly now: number;
    /** The application's clock, which progress sheets count on. */
    readonly clock: number;
  }
  | {
    readonly kind: "dismissed";
    readonly target: TerminalApplicationDismissTarget;
  }
  /**
   * The package left a layer out of the screen because it broke one of its
   * view rules; `reason` says which. The session carries on without it.
   */
  | {
    readonly kind: "refused";
    readonly layer: string;
    readonly reason: string;
  }
  | {
    readonly kind: "selection-moved";
    readonly itemId: string;
    readonly move: DeskSelectionMove;
  }
  | {
    readonly kind: "field";
    readonly layerId: string;
    readonly fieldId: string;
    readonly value: string;
  }
  | {
    readonly kind: "prepared";
    readonly layerId: string;
    /** The read it answers, as its prepare effect numbered it. */
    readonly read: number;
    readonly result: DeskLoad<DeskReview>;
    /** A form's values the review was read for. */
    readonly readFor?: string;
  }
  | {
    readonly kind: "read";
    readonly layerId: string;
    readonly result: DeskReadResult;
  }
  | {
    readonly kind: "scripts";
    readonly result: DeskLoad<DeskProjectScriptInventory>;
  }
  | {
    readonly kind: "returned";
    readonly outcome: DeskOutcome;
    readonly now: number;
  }
  /** An operation running beside the screen reported progress. */
  | {
    readonly kind: "operation-progress";
    readonly operationId: string;
    readonly progress: DeskOperationProgress;
    readonly output: StreamedOutput;
  }
  /** An operation running beside the screen ended. */
  | {
    readonly kind: "operation-settled";
    readonly operationId: string;
    /** Whether it ran to its end or was stopped on the way. */
    readonly ended: "ran" | "stopped";
    readonly outcome: DeskOutcome;
    readonly output: StreamedOutput;
    readonly now: number;
    /** The list item selected as it ended. */
    readonly selected?: string;
  }
  | { readonly kind: "preferences-failed"; readonly reason: string }
  /** A page opened beside the screen, and what it left for its reader. */
  | {
    readonly kind: "opened";
    readonly layerId: string;
    readonly outcome: DeskOutcome;
    readonly now: number;
  }
  /** The session's read of the manual finished. */
  | {
    readonly kind: "manual-read";
    readonly result: Exclude<DeskManualStatus, { readonly state: "loading" }>;
  };

/** Work the live controller performs for a transition. */
export type DeskEffect =
  | { readonly kind: "survey"; readonly generation: number }
  | { readonly kind: "schedule-survey"; readonly afterMs: number }
  | {
    readonly kind: "prepare";
    readonly layerId: string;
    /** This read's number; only the layer waiting for it takes its result. */
    readonly read: number;
    readonly step: DeskFlowStep;
    /** Wait this long for more typing first; a newer prepare replaces it. */
    readonly debounceMs?: number;
    /** A form's values, as `formValuesKey` spells them. */
    readonly readFor?: string;
  }
  | {
    readonly kind: "read";
    readonly layerId: string;
    readonly reader: DeskReaderSubject;
  }
  | { readonly kind: "load-scripts"; readonly owner: DeskScriptOwner }
  | {
    readonly kind: "apply";
    readonly step: DeskFlowStep;
    readonly review: DeskReview;
    readonly challenge?: string;
    readonly open?: string;
  }
  /** Run one operation beside the screen. */
  | { readonly kind: "operate"; readonly operationId: string }
  /** Open a reviewed page beside the screen; its reader shows the outcome. */
  | {
    readonly kind: "open";
    /** The package command that opens it, new for every opening. */
    readonly commandId: string;
    readonly layerId: string;
    readonly step: DeskFlowStep;
    readonly review: DeskReview;
  }
  /** Stop one running operation through its signal. */
  | { readonly kind: "abort"; readonly operationId: string }
  | { readonly kind: "child"; readonly child: DeskChild }
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "persist"; readonly preferences: DeskPreferences }
  /** Open the manual in place of the inbox, on the same screen. */
  | { readonly kind: "manual" }
  | { readonly kind: "exit" };

/** The effect kinds the package runs as a command. */
const TERMINAL_EFFECT_KINDS = [
  "apply",
  "child",
  "exit",
  "manual",
  "open",
  "operate",
] as const;

/**
 * The effects the package runs as a command: a handoff of the terminal, an
 * operation or a page opened beside the screen, the manual on the same
 * screen, or the end of the session.
 */
export type DeskTerminalEffect = Extract<
  DeskEffect,
  { readonly kind: (typeof TERMINAL_EFFECT_KINDS)[number] }
>;

/** Whether an effect must be returned to the package as a command. */
export function isTerminalEffect(
  effect: DeskEffect,
): effect is DeskTerminalEffect {
  return TERMINAL_EFFECT_KINDS.some((kind) => kind === effect.kind);
}

/** One transition's result. */
export interface DeskTransition {
  readonly state: DeskProductState;
  readonly effects: readonly DeskEffect[];
}

/** The state before the first survey. */
export function initialDeskProduct(options: {
  readonly trunk: string;
  readonly preferences: DeskPreferences;
}): DeskProductState {
  return {
    trunk: options.trunk,
    survey: { generation: 0, inFlight: false, followUp: false, failures: 0 },
    hints: [],
    rows: [],
    exceptionArgvs: new Map(),
    capabilities: new Map(),
    evidence: emptyEvidenceCache(),
    layers: [],
    preferences: options.preferences,
    activity: [],
    departed: new Map(),
    gone: new Set(),
    operations: new Map(),
    manual: { state: "loading" },
    serial: 0,
  };
}

/** The next survey after one finishes: the queued follow-up, or the cadence. */
function afterSurvey(transition: DeskTransition): DeskTransition {
  if (transition.state.survey.followUp) {
    const next = refresh({
      ...transition.state,
      survey: { ...transition.state.survey, inFlight: false },
    });
    return {
      state: next.state,
      effects: [...transition.effects, ...next.effects],
    };
  }
  return {
    state: transition.state,
    effects: [...transition.effects, {
      kind: "schedule-survey",
      afterMs: DESK_REFRESH_MS,
    }],
  };
}

/** Adopt one completed survey. */
function observed(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "observed" }>,
): DeskTransition {
  if (event.generation !== state.survey.generation) {
    return { state, effects: [] };
  }
  const data = heldForOperations(state, event.data);
  // The survey reads the fleet as finished operations left it.
  const fresh = { ...state, gone: new Set<string>() };
  const rows = observedRows(fresh, data, event.exceptionArgvs, event.now);
  // Layers stay as the owner left them: a layer whose subject left the inbox
  // says so until the owner closes it.
  let next: DeskProductState = {
    ...fresh,
    data,
    hints: event.hints,
    rows,
    exceptionArgvs: event.exceptionArgvs,
    departed: departures(state, data, rows),
    survey: {
      ...state.survey,
      inFlight: false,
      failures: 0,
      observedAt: event.now,
    },
  };
  const { warning: _cleared, offlineDismissed: _reset, ...withoutWarning } =
    next;
  next = withoutWarning;
  const effects: DeskEffect[] = [];
  if (state.pendingSelect !== undefined) {
    const created = rows.find((row) => row.entry.path === state.pendingSelect);
    if (created !== undefined) {
      const { pendingSelect: _done, ...rest } = next;
      next = rest;
      effects.push({ kind: "select", id: deskRowId(created) });
    }
  }
  if (state.pendingReturn !== undefined) {
    const { pendingReturn: _done, ...rest } = next;
    next = returnMessage(rest, state.pendingReturn);
  }
  return afterSurvey({ state: next, effects });
}

/** Name what a child changed in its task, once the survey after it lands. */
function returnMessage(
  state: DeskProductState,
  pending: DeskPendingReturn,
): DeskProductState {
  const row = state.rows.find((candidate) =>
    deskRowId(candidate) === pending.taskId
  );
  if (row === undefined) return state;
  const changed = row.entry.changed_files;
  const delta = changed === undefined || pending.changedBefore === undefined
    ? 0
    : changed - pending.changedBefore;
  const count = Math.abs(delta);
  return toast(state, "accent", `Back from ${pending.label}`, {
    mark: DESK_GLYPHS.back,
    topic: "return",
    detail: `${rowTitle(row)}: ${
      delta === 0
        ? "no new changes"
        : `${count} ${delta > 0 ? "more" : "fewer"} file${
          count === 1 ? "" : "s"
        } changed`
    }`,
  });
}

/**
 * How old the screen's data is once refreshing fails, to the second: a
 * failing refresh is never "just now", even at the start of an outage.
 */
export function offlineAge(ms: number): string {
  return `${compactDuration(Math.max(1_000, ms))} ago`;
}

/** A failed survey: Retrying after one, Offline after two. */
function observationFailed(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "observation-failed" }>,
): DeskTransition {
  if (event.generation !== state.survey.generation) {
    return { state, effects: [] };
  }
  const failures = state.survey.failures + 1;
  let next: DeskProductState = {
    ...state,
    survey: {
      ...state.survey,
      inFlight: false,
      failures,
      error: event.error,
    },
  };
  if (failures >= DESK_OFFLINE_FAILURES && state.offlineDismissed !== true) {
    const serial = state.warning === undefined ? next.serial + 1 : next.serial;
    next = {
      ...next,
      serial,
      warning: {
        id: state.warning?.id ?? deskMessageId("offline", serial),
        topic: "offline",
        tone: "warning",
        text: state.survey.observedAt === undefined
          ? "Couldn't read tasks"
          : `Couldn't refresh · showing what was seen ${
            offlineAge(event.now - state.survey.observedAt)
          }`,
        mark: DESK_GLYPHS.attention,
        key: { key: "r", label: "Retry" },
        persistent: true,
      },
    };
  }
  return afterSurvey({ state: next, effects: [] });
}

/** Discovery for one task arrived: rebuild its row's offers. */
function capabilitiesRead(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "capabilities" }>,
): DeskTransition {
  const capabilities = new Map(state.capabilities);
  capabilities.set(event.taskId, event.capabilities);
  return {
    state: {
      ...state,
      capabilities,
      rows: state.rows.map((row) =>
        deskRowId(row) === event.taskId
          ? withDeskCapabilities(row, event.capabilities, event.now)
          : row
      ),
    },
    effects: [],
  };
}

/** The package closed a message or a layer; the next view must omit it. */
function dismissed(
  state: DeskProductState,
  target: TerminalApplicationDismissTarget,
): DeskTransition {
  if ("message" in target) {
    if (state.message?.id === target.message) {
      const { message: _gone, ...rest } = state;
      return { state: rest, effects: [] };
    }
    if (state.warning?.id === target.message) {
      const { warning: _gone, ...rest } = state;
      return { state: { ...rest, offlineDismissed: true }, effects: [] };
    }
    return { state, effects: [] };
  }
  return {
    state: closeLayer(state, target.layer),
    effects: [],
  };
}

/** The package moved the selection: say so once, quietly. */
function selectionMoved(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "selection-moved" }>,
): DeskTransition {
  // A row this session's own operation moves already has its message.
  if (
    taskOperation(state, event.itemId) !== undefined ||
    state.message?.tasks?.includes(event.itemId) === true
  ) return { state, effects: [] };
  if (event.move.kind === "removed") {
    const departure = state.departed.get(event.itemId);
    return {
      state: departure === undefined || departure.announced === true
        ? state
        : toast(state, "muted", departureMessage(departure, state.trunk)),
      effects: [],
    };
  }
  const row = state.rows.find((candidate) =>
    deskRowId(candidate) === event.itemId
  );
  if (row === undefined) return { state, effects: [] };
  return {
    state: toast(
      state,
      "muted",
      `${rowTitle(row)} moved to ${
        groupTitleOf(event.move.to)
      }: ${row.decision.label.toLowerCase()}`,
    ),
    effects: [],
  };
}

/** A group's title as messages name it. */
function groupTitleOf(group: string): string {
  const known = FLEET_ROW_GROUPS.find((candidate) => candidate === group);
  return known === undefined ? group : FLEET_ROW_GROUP_TITLES[known];
}

/** How long a form waits for more typing before it reads its preview. */
export const DESK_FORM_PREVIEW_MS = 300;

/**
 * A form field changed: keep its value, and read the form's preview again
 * once typing pauses. Confirm waits for the preview of these exact values.
 */
function fieldChanged(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "field" }>,
): DeskTransition {
  const layer = state.layers.find((candidate) =>
    layerId(candidate) === event.layerId
  );
  if (layer?.kind !== "form") return { state, effects: [] };
  const values = { ...layer.values, [event.fieldId]: event.value };
  const readFor = formValuesKey(values);
  const read = state.serial + 1;
  return {
    state: updateLayer(
      { ...state, serial: read },
      event.layerId,
      () => ({ ...layer, values, load: { state: "loading" }, read }),
    ),
    effects: [{
      kind: "prepare",
      layerId: event.layerId,
      read,
      step: { ...layer.step, values: { ...layer.step.values, ...values } },
      debounceMs: DESK_FORM_PREVIEW_MS,
      readFor,
    }],
  };
}

/**
 * A review's read finished: show what it read, or why it couldn't. Only the
 * opening that started the read takes it, so a late read for one task never
 * fills another task's sheet under the same id; a form keeps only the read
 * of its current values.
 */
function prepared(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "prepared" }>,
): DeskTransition {
  return {
    state: updateLayer(state, event.layerId, (layer) => {
      if (
        (layer.kind !== "review" && layer.kind !== "form") ||
        layer.read !== event.read
      ) return layer;
      if (layer.kind === "review") return { ...layer, load: event.result };
      if ((event.readFor ?? "") !== formValuesKey(layer.values)) return layer;
      return {
        ...layer,
        load: event.result,
        ...(event.readFor === undefined ? {} : { readFor: event.readFor }),
      };
    }),
    effects: [],
  };
}

/** A reader's read finished. */
function readerRead(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "read" }>,
): DeskTransition {
  const { result } = event;
  return {
    state: updateLayer(state, event.layerId, (layer) => {
      if (layer.kind !== "reader") return layer;
      const reader = layer.reader;
      if (reader.kind === "changes" && result.kind === "changes") {
        return { ...layer, reader: { ...reader, load: result.load } };
      }
      if (
        (reader.kind === "branch" || reader.kind === "landed") &&
        result.kind === "markdown"
      ) {
        return { ...layer, reader: { ...reader, load: result.load } };
      }
      return layer;
    }),
    effects: [],
  };
}

/** A script inventory arrived for the open picker. */
function scriptsRead(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "scripts" }>,
): DeskTransition {
  return {
    state: {
      ...state,
      layers: state.layers.map((layer) =>
        layer.kind === "scripts" ? { ...layer, load: event.result } : layer
      ),
    },
    effects: [],
  };
}

/**
 * The session's preferences once an outcome says which agent it opened: the
 * effect already saved it, and later toggles must not write it away.
 */
function remembering(
  state: DeskProductState,
  outcome: DeskOutcome,
): DeskProductState {
  return outcome.lastAgent === undefined ? state : {
    ...state,
    preferences: { ...state.preferences, last_agent: outcome.lastAgent },
  };
}

/** An effect or child returned the terminal: show what it left. */
function returned(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "returned" }>,
): DeskTransition {
  const { outcome } = event;
  let next: DeskProductState = {
    ...remembering(state, outcome),
    activity: [...state.activity, {
      at: event.now,
      command: outcome.command,
      ok: outcome.ok,
      ...(outcome.message === undefined
        ? {}
        : { summary: outcome.message.text }),
    }],
  };
  // A result sheet is the failure's message; a toast would only repeat it.
  if (outcome.message !== undefined && outcome.result === undefined) {
    next = toast(next, outcome.message.tone, outcome.message.text, {
      mark: MESSAGE_MARKS[outcome.message.tone],
    });
  } else if (outcome.back !== undefined) {
    next = toast(next, "accent", `Back from ${outcome.back.label}`, {
      mark: DESK_GLYPHS.back,
      topic: "return",
    });
  }
  if (outcome.back !== undefined) {
    next = { ...next, pendingReturn: outcome.back };
  }
  if (outcome.select !== undefined) {
    next = { ...next, pendingSelect: outcome.select };
  }
  const effects: DeskEffect[] = [];
  if (outcome.result !== undefined) {
    const opened = open(next, { kind: "result", sheet: outcome.result });
    next = opened.state;
    effects.push(...opened.effects);
  } else if (outcome.next !== undefined) {
    const opened = open(next, {
      kind: "review",
      step: outcome.next,
      load: { state: "loading" },
    });
    next = opened.state;
    effects.push(...opened.effects);
  }
  const survey = refresh(next);
  return { state: survey.state, effects: [...effects, ...survey.effects] };
}

/**
 * A page opened beside the screen: the session records the command, and
 * the reader its confirm opened shows what it left. A survey follows, since
 * opening a page can clear a reminder status reports.
 */
function pageOpened(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "opened" }>,
): DeskTransition {
  const { outcome } = event;
  const next: DeskProductState = updateLayer(
    {
      ...state,
      activity: [...state.activity, {
        at: event.now,
        command: outcome.command,
        ok: outcome.ok,
        ...(outcome.message === undefined
          ? {}
          : { summary: outcome.message.text }),
      }],
    },
    event.layerId,
    (layer) =>
      layer.kind === "reader" && layer.reader.kind === "opened"
        ? {
          ...layer,
          reader: {
            ...layer.reader,
            load: outcome.reading === undefined
              ? {
                state: "failed",
                error: outcome.message?.text ?? "It didn't complete",
              }
              : { state: "ready", value: { markdown: outcome.reading } },
          },
        }
        : layer,
  );
  return refresh(next);
}

/** The lines an operation's output keeps for its reader and activity. */
export const DESK_OUTPUT_LINES = 400;

/**
 * The code units one streamed line keeps in the output reader and a result's
 * Full output, which scroll to every row they keep: no more than fits one
 * screen at the size discern assumes for a terminal it cannot measure, since
 * a Desk view is built without the viewport's size.
 */
export const DESK_OUTPUT_LINE_LIMIT = liveTailLimit(
  "fit",
  DEFAULT_TERMINAL_COLUMNS,
  DEFAULT_TERMINAL_ROWS,
);

/** What an operation wrote, as a view shows it: each line bounded. */
export function shownOutput(output: StreamedOutput): string {
  return liveTailOutput(output, DESK_OUTPUT_LINE_LIMIT, "…");
}

/** A running operation reported progress. */
function operationProgressed(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "operation-progress" }>,
): DeskTransition {
  const operation = state.operations.get(event.operationId);
  if (operation === undefined) return { state, effects: [] };
  const operations = new Map(state.operations);
  operations.set(operation.id, {
    ...operation,
    progress: event.progress,
    output: event.output,
  });
  return { state: { ...state, operations }, effects: [] };
}

/** Whether the open progress sheet shows this operation. */
function showsProgress(state: DeskProductState, operationId: string): boolean {
  return state.layers.some((layer) =>
    layer.kind === "progress" && layer.operationId === operationId
  );
}

/** A failure's full output: what the operation wrote, then its result. */
function fullOutput(
  written: StreamedOutput,
  result: string | undefined,
): string {
  const captured = streamedOutputIsBlank(written)
    ? undefined
    : `\`\`\`text\n${shownOutput(written).trimEnd()}\n\`\`\``;
  return [captured, result].filter((part) => part !== undefined).join(
    "\n\n",
  );
}

/**
 * An operation ended. A failure turns its progress sheet into a result
 * sheet when the sheet is open, and leaves a message when it is hidden; a
 * success closes the sheet with its message; a stop says where the journal
 * picks up. The row's own state follows from the next survey.
 */
function operationSettled(
  state: DeskProductState,
  event: Extract<DeskEvent, { readonly kind: "operation-settled" }>,
): DeskTransition {
  const operation = state.operations.get(event.operationId);
  if (operation === undefined) return { state, effects: [] };
  const { outcome } = event;
  const shown = showsProgress(state, operation.id);
  const operations = new Map(state.operations);
  operations.delete(operation.id);
  const ended = event.ended === "stopped"
    ? "stopped" as const
    : outcome.ok
    ? "done" as const
    : "failed" as const;
  // The rows keep what the last survey saw until the next one reads the
  // fleet as the operation left it: a reading taken mid-change is never
  // shown as where the task now stands.
  let next: DeskProductState = withRows({
    ...remembering(state, outcome),
    operations,
    activity: [...state.activity, {
      at: event.now,
      command: outcome.command,
      ok: outcome.ok && ended !== "stopped",
      ended,
      ...(outcome.message === undefined
        ? {}
        : { summary: outcome.message.text }),
      ...(streamedOutputIsBlank(event.output) ? {} : { output: event.output }),
    }],
  });
  if (shown) next = closeLayer(next, "progress");
  const effects: DeskEffect[] = [];
  // What it reports it took out of the inbox, even when it went on to stop.
  const left = ended === "stopped" ? [] : outcome.left ?? [];
  const tasks = [
    ...(operation.taskId === undefined ? [] : [operation.taskId]),
    ...left.map((task) => task.taskId),
  ];
  const about = tasks.length === 0 ? {} : { tasks: [...new Set(tasks)] };
  // What it took out of the inbox leaves the list at once, so no offer
  // stays on a landed task and the selection moves once.
  next = leaving(next, left, event.now);
  // A landing that took the selected task out hands the selection to the
  // first task that needs the owner, not to whichever row followed it.
  if (
    left.some((task) =>
      task.reason === "landed" && task.taskId === event.selected
    )
  ) {
    const first = FLEET_OWNER_GROUPS.flatMap((group) =>
      next.rows.filter((row) =>
        row.decision.group === group
      )
    )[0];
    if (first !== undefined) {
      effects.push({ kind: "select", id: deskRowId(first) });
    }
  }
  if (ended === "stopped") {
    next = toast(
      next,
      "warning",
      `Stopped: ${operation.title} · its journal records where it stopped`,
      { mark: DESK_GLYPHS.attention, ...about },
    );
  } else if (outcome.result !== undefined) {
    const sheet: DeskResultSheet = {
      ...outcome.result,
      output: fullOutput(event.output, outcome.result.output),
    };
    if (shown || next.layers.length === 0) {
      const opened = open(next, { kind: "result", sheet });
      next = opened.state;
      effects.push(...opened.effects);
    } else {
      next = toast(next, sheet.tone, sheet.title, {
        mark: MESSAGE_MARKS[sheet.tone],
        ...about,
      });
    }
  } else {
    if (outcome.message !== undefined) {
      next = toast(next, outcome.message.tone, outcome.message.text, {
        mark: MESSAGE_MARKS[outcome.message.tone],
        ...about,
      });
    }
    if (outcome.next !== undefined && (shown || next.layers.length === 0)) {
      const opened = open(next, {
        kind: "review",
        step: outcome.next,
        load: { state: "loading" },
      });
      next = opened.state;
      effects.push(...opened.effects);
    }
  }
  if (outcome.select !== undefined) {
    next = { ...next, pendingSelect: outcome.select };
  }
  const survey = resurvey(next);
  return { state: survey.state, effects: [...effects, ...survey.effects] };
}

/**
 * Take the tasks a finished operation reports gone out of the list until
 * the next survey, remembering why for the sheets and menus that name them.
 */
function leaving(
  state: DeskProductState,
  left: readonly DeskLeftTask[],
  now: number,
): DeskProductState {
  if (left.length === 0) return state;
  const departed = new Map(state.departed);
  const gone = new Set(state.gone);
  for (const task of left) {
    departed.set(task.taskId, {
      title: task.title,
      reason: task.reason,
      announced: true,
    });
    gone.add(task.taskId);
  }
  return withRows({
    ...state,
    departed,
    gone,
    ...(state.data === undefined
      ? {}
      : { data: withLanded(state.data, state.rows, left, now) }),
  });
}

/** Advance the product state by one event. */
export function deskProduct(
  state: DeskProductState,
  event: DeskEvent,
): DeskTransition {
  switch (event.kind) {
    case "refresh":
      return refresh(state);
    case "observed":
      return observed(state, event);
    case "observation-failed":
      return observationFailed(state, event);
    case "capabilities":
      return capabilitiesRead(state, event);
    case "evidence":
      return {
        state: {
          ...state,
          evidence: rememberEvidence(state.evidence, event.subject, event.read),
        },
        effects: [],
      };
    case "tip":
      return {
        state: toast({ ...state, tip: event.tip }, "muted", event.tip.brief, {
          topic: "tip",
          lead: event.tip.lead,
        }),
        effects: [],
      };
    case "intent":
      return intentTransition(state, event.intent, event.ui, {
        now: event.now,
        clock: event.clock,
      });
    case "dismissed":
      return dismissed(state, event.target);
    case "refused":
      return {
        state: toast(
          closeLayer(state, event.layer),
          "warning",
          `Couldn't show that, and nothing ran: ${event.reason}`,
        ),
        effects: [],
      };
    case "selection-moved":
      return selectionMoved(state, event);
    case "field":
      return fieldChanged(state, event);
    case "prepared":
      return prepared(state, event);
    case "read":
      return readerRead(state, event);
    case "scripts":
      return scriptsRead(state, event);
    case "returned":
      return returned(state, event);
    case "operation-progress":
      return operationProgressed(state, event);
    case "operation-settled":
      return operationSettled(state, event);
    case "preferences-failed":
      return {
        state: toast(
          state,
          "warning",
          `Desk preferences were not saved: ${event.reason}`,
        ),
        effects: [],
      };
    case "opened":
      return pageOpened(state, event);
    case "manual-read":
      return { state: { ...state, manual: event.result }, effects: [] };
  }
}

export { DESK_LIST_ID, layerId } from "./desk_transitions.ts";
