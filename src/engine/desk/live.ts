/**
 * The live Desk: scheduling, observation, and the handshake with the
 * package's application runtime.
 *
 * Every package callback maps onto one product event and returns the next
 * view synchronously, so a key typed after one that opened a layer already
 * lands on it. This module keeps only what time and effects need: one survey
 * at a time with generation checks (an operation's end supersedes one in
 * flight with a fresh survey), the refresh cadence, the selected-item
 * slot that reads tier-two evidence once the selection settles, the clock
 * that keeps running times current, the operations that run beside the
 * screen as package background commands, the manual opened in place of the
 * inbox, and the terminal handoffs launches need. Selection, focus, scroll,
 * folds and field editing stay the package's.
 */

import { bestEffort } from "../../shared/best_effort.ts";
import type { Scheduler, TimeoutHandle } from "../../shared/scheduler.ts";
import type {
  ApplicationEpilogueLine,
  TerminalApplicationCommand,
  TerminalApplicationCommandOutcome,
  TerminalApplicationContext,
  TerminalApplicationState,
  TerminalApplicationViewIssue,
} from "discern-design-system/cli/interactive";
import { stripAnsi } from "../../shared/color_env.ts";
import type { DeskEffectSession } from "./execution.ts";
import type { DeskTip } from "./tips.ts";
import { progressActivity, progressAfter } from "./operations.ts";
import {
  isInteractionCancelled,
  type TerminalApplicationOptions,
} from "../../lib/terminal_interaction.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import type { ReleaseCheckHistory } from "../../shared/release_check.ts";
import type { DeskProjectScriptInventory } from "../project_scripts.ts";
import {
  type DeskAgentLaunch,
  type DeskCapabilities,
  deskExceptionArgvs,
  type DeskRow,
  deskRowId,
} from "./model.ts";
import type {
  DeskPreferences,
  DeskPreferencesWriteResult,
} from "./preferences.ts";
import {
  activityEnding,
  type DeskEffect,
  type DeskEvent,
  type DeskIntent,
  type DeskOperation,
  deskProduct,
  type DeskProductState,
  type DeskReaderSubject,
  type DeskReadResult,
  type DeskScriptOwner,
  type DeskTerminalEffect,
  type DeskUi,
  initialDeskProduct,
  isTerminalEffect,
  outputTail,
} from "./desk_state.ts";
import {
  DESK_LIST_ID,
  rowRef,
  sessionRead,
  withoutOperation,
} from "./desk_transitions.ts";
import {
  DESK_KEYMAP,
  DESK_VI_KEYS,
  deskTickDelay,
  deskView,
} from "./inbox_view.ts";
import {
  branchEvidenceSubject,
  type DeskEvidenceReader,
  type DeskEvidenceSubject,
  evidenceToRead,
  readSelectedEvidence,
  taskEvidenceSubject,
} from "./evidence.ts";
import type { DeskFlowStep, DeskOutcome, DeskReview } from "./flow_types.ts";
import { DESK_MANUAL_READING, type DeskManual } from "./manual.ts";
import { failureSheet } from "./review.ts";

/** A wait that ended because SIGINT arrived first. */
const INTERRUPTED = Symbol("interrupted");

/**
 * What Ctrl+C runs on the Desk's screen: the action its key map binds, so a
 * Ctrl+C heard while the terminal is handed over means the same.
 */
const DESK_INTERRUPT: DeskIntent = (() => {
  const binding = DESK_KEYMAP.find((candidate) => candidate.key === "ctrl-c");
  if (binding === undefined) {
    throw new TypeError("The Desk's key map binds no Ctrl+C.");
  }
  return binding.action;
})();

/** How long the selection must stay put before the slot reads its evidence. */
export const DESK_SELECTION_SETTLE_MS = 150;

/** The reads and effects flows perform for the live Desk. */
export interface DeskFlows {
  review(state: DeskProductState, step: DeskFlowStep): Promise<DeskReview>;
  read(
    state: DeskProductState,
    reader: DeskReaderSubject,
  ): Promise<DeskReadResult>;
  scripts(
    state: DeskProductState,
    owner: DeskScriptOwner,
  ): Promise<DeskProjectScriptInventory>;
  capabilities(
    state: DeskProductState,
    row: DeskRow,
  ): Promise<DeskCapabilities>;
  /** The line painted before an effect takes the terminal. */
  handoff(state: DeskProductState, effect: DeskHandoff): string;
  /** Run one effect or child with the terminal. */
  run(state: DeskProductState, effect: DeskHandoff): Promise<DeskOutcome>;
  /** Run one operation beside the screen, reporting into its session. */
  operate(
    state: DeskProductState,
    operation: DeskOperation,
    session: DeskEffectSession,
  ): Promise<DeskOutcome>;
  /** Open one reviewed page beside the screen; `signal` ends it with the session. */
  open(
    state: DeskProductState,
    step: DeskFlowStep,
    review: DeskReview,
    signal: AbortSignal,
  ): Promise<DeskOutcome>;
}

/** An effect that takes the terminal from the screen. */
export type DeskHandoff = Extract<
  DeskTerminalEffect,
  { readonly kind: "apply" | "child" | "exit" }
>;

/** Everything the live Desk depends on; nothing here reads the host. */
export interface LiveDeskDependencies {
  readonly trunk: string;
  readonly root: string;
  readonly version: string;
  readonly preferences: DeskPreferences;
  /** Agent launches the main checkout's configuration offers a new task. */
  readonly launches: () => Promise<readonly DeskAgentLaunch[]>;
  readonly observe: () => Promise<{
    readonly data: StatusData;
    readonly hints: readonly string[];
    /** When this clone last opened the release page, read beside status. */
    readonly releaseCheck?: ReleaseCheckHistory;
  }>;
  readonly tip: (data: StatusData) => Promise<DeskTip | undefined>;
  /** Read the manual, which the session does once as it starts. */
  readonly manual: () => Promise<DeskManual>;
  /**
   * Hear SIGINT while the Desk waits with the terminal handed over and no
   * child of its own hears it; returns the stop.
   */
  readonly interrupts: (heard: () => void) => () => void;
  readonly evidence: DeskEvidenceReader;
  readonly flows: DeskFlows;
  readonly persist: (
    preferences: DeskPreferences,
  ) => Promise<DeskPreferencesWriteResult>;
  readonly now: () => number;
  readonly scheduler: Scheduler;
}

/** The package's read-only state, as the product state machine reads it. */
export function deskUi(state: TerminalApplicationState): DeskUi {
  const list = state.lists[DESK_LIST_ID];
  return {
    ...(list?.selectedId === undefined ? {} : { selected: list.selectedId }),
    ...(list?.selectedGroupId === undefined
      ? {}
      : { selectedGroup: list.selectedGroupId }),
    ...(state.topLayerId === undefined ? {} : { topLayerId: state.topLayerId }),
    zoomed: list?.zoomed ?? false,
    fields: state.fields,
  };
}

/** The outcome of an effect that threw: refused, cancelled, or failed. */
export function failedOutcome(error: unknown, command: string): DeskOutcome {
  if (isInteractionCancelled(error)) {
    return {
      command,
      ok: false,
      message: { tone: "muted", text: "Cancelled; nothing more ran" },
    };
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= 120 && !text.includes("\n")
    ? { command, ok: false, message: { tone: "danger", text } }
    : {
      command,
      ok: false,
      message: { tone: "danger", text: "It didn't complete" },
      result: failureSheet("It didn't complete", text, command),
    };
}

/**
 * The lines printed on the terminal's own screen when the Desk exits: each
 * command this session ran, in full so it can be copied, and how it ended.
 * Operations still running stop as the Desk leaves.
 */
export function deskEpilogue(
  state: DeskProductState,
): ApplicationEpilogueLine[] {
  const line = (command: string, ended: string): ApplicationEpilogueLine => [
    { text: "discern desk ran: " },
    { text: command, role: "code" },
    { text: ` · ${ended}` },
  ];
  return [
    ...state.activity.map((entry) =>
      line(entry.command, activityEnding(entry))
    ),
    ...[...state.operations.values()].map((operation) =>
      line(operation.command, "stopped")
    ),
  ];
}

/**
 * What a refused layer broke, as its message says: the first rule the
 * package names, without the layer's index in the view.
 */
export function refusalReason(
  issues: readonly TerminalApplicationViewIssue[],
): string {
  const [issue] = issues;
  if (issue === undefined) return "it broke a view rule";
  return `${issue.path.replace(/^layers\[\d+\]\.?/u, "")} ${issue.message}`
    .trim();
}

/** One Desk session's package options, and what its caller waits for. */
export type LiveDesk = TerminalApplicationOptions<DeskIntent> & {
  /** Settles once every preference write the session asked for has. */
  readonly saved: () => Promise<void>;
};

/** Build the package options for one Desk session. */
export function liveDesk(deps: LiveDeskDependencies): LiveDesk {
  const scheduler = deps.scheduler;
  let state = initialDeskProduct({
    trunk: deps.trunk,
    preferences: deps.preferences,
  });
  let context: TerminalApplicationContext<DeskIntent> | undefined;
  let alive = true;
  /** A child or the manual has the screen: surveys, ticks and reads wait. */
  let foreground = false;
  /** The session's one read of the manual, and the manual once it is read. */
  let reading: Promise<DeskManual> | undefined;
  let manual: DeskManual | undefined;
  let launches: readonly DeskAgentLaunch[] = [];
  let surveyTimer: TimeoutHandle | undefined;
  let settleTimer: TimeoutHandle | undefined;
  let tickTimer: TimeoutHandle | undefined;
  /** A form's pending preview read, by layer, while typing settles. */
  const previewTimers = new Map<string, TimeoutHandle>();
  /**
   * What each operation running beside the screen has reported, kept here
   * between the package's coalesced reports, and what each left once its
   * work returned, until the package says how its command settled.
   */
  const running = new Map<
    string,
    { progress: DeskOperation["progress"]; output: string }
  >();
  const finished = new Map<string, DeskOutcome>();
  /**
   * The rules the view the package last refused layers from broke; each
   * refused layer's dismissal follows in the same pass and says so.
   */
  let refusal: readonly TerminalApplicationViewIssue[] = [];
  let tipRequested = false;
  /** Tasks whose first discovery is under way. */
  const discovering = new Set<string>();
  let selected: string | undefined;
  let slotGeneration = 0;
  let slotBusy = false;
  const ui = (): DeskUi =>
    context === undefined
      ? { zoomed: false, fields: {} }
      : deskUi(context.state);
  const env = () => ({
    now: deps.now(),
    ...(context === undefined ? {} : { clock: context.now() }),
    root: deps.root,
    version: deps.version,
    launches,
  });
  const fail = (error: unknown): void => context?.fail(error);
  /**
   * Work the session started and has not seen settle. Each read and effect
   * reports into the session when it finishes; a failure fails the session.
   * A read that outlives the session reports nothing; the preference writes
   * the session's caller must not overtake are awaited through `saved`.
   */
  const pending = new Set<Promise<void>>();
  const own = (work: Promise<unknown>): void => {
    const owned: Promise<void> = work.then(() => {}, fail).finally(() => {
      pending.delete(owned);
    });
    pending.add(owned);
  };
  /**
   * The preference writes, one after another, so a later toggle never loses
   * to an earlier one; the session's caller waits for the last before it
   * writes what the session leaves behind.
   */
  let preferencesSaved: Promise<void> = Promise.resolve();

  /** Keep running times current while any is visible and surveys succeed. */
  const tick = (): void => {
    if (!alive || foreground || tickTimer !== undefined) return;
    const delay = deskTickDelay(state, ui(), env());
    if (delay === undefined) return;
    tickTimer = scheduler.scheduleTimeout(() => {
      tickTimer = undefined;
      publish();
    }, delay);
  };

  const publish = (): void => {
    if (!alive || context === undefined) return;
    context.update(deskView(state, ui(), env()));
    tick();
  };

  const cancel = (): void => {
    for (
      const handle of [
        surveyTimer,
        settleTimer,
        tickTimer,
        ...previewTimers.values(),
      ]
    ) {
      if (handle !== undefined) scheduler.cancelTimeout(handle);
    }
    surveyTimer = undefined;
    settleTimer = undefined;
    tickTimer = undefined;
    previewTimers.clear();
  };

  /** Read one review for a layer, now or once typing settles. */
  const prepare = (
    effect: Extract<DeskEffect, { readonly kind: "prepare" }>,
  ): void => {
    const pending = previewTimers.get(effect.layerId);
    if (pending !== undefined) scheduler.cancelTimeout(pending);
    previewTimers.delete(effect.layerId);
    const read = (): void =>
      own(
        deps.flows.review(state, effect.step).then(
          (review) =>
            dispatch({
              kind: "prepared",
              layerId: effect.layerId,
              read: effect.read,
              result: { state: "ready", value: review },
              ...(effect.readFor === undefined
                ? {}
                : { readFor: effect.readFor }),
            }),
          (error) =>
            dispatch({
              kind: "prepared",
              layerId: effect.layerId,
              read: effect.read,
              result: failure(error),
              ...(effect.readFor === undefined
                ? {}
                : { readFor: effect.readFor }),
            }),
        ),
      );
    if (effect.debounceMs === undefined) {
      read();
      return;
    }
    previewTimers.set(
      effect.layerId,
      scheduler.scheduleTimeout(() => {
        previewTimers.delete(effect.layerId);
        if (alive) read();
      }, effect.debounceMs),
    );
  };

  /** A failed read, as the event that reports it. */
  const failure = (error: unknown): { state: "failed"; error: string } => ({
    state: "failed",
    error: error instanceof Error ? error.message : String(error),
  });

  /** Apply one event and run what it asks for; a terminal effect is returned. */
  const dispatch = (event: DeskEvent): DeskTerminalEffect | undefined => {
    if (!alive) return undefined;
    const transition = deskProduct(state, event);
    state = transition.state;
    publish();
    return perform(transition.effects);
  };

  const perform = (
    effects: readonly DeskEffect[],
  ): DeskTerminalEffect | undefined => {
    let terminal: DeskTerminalEffect | undefined;
    for (const effect of effects) {
      if (isTerminalEffect(effect)) {
        terminal = effect;
        continue;
      }
      switch (effect.kind) {
        case "survey":
          survey(effect.generation);
          break;
        case "schedule-survey":
          scheduleSurvey(effect.afterMs);
          break;
        case "prepare":
          prepare(effect);
          break;
        case "read":
          own(
            deps.flows.read(state, effect.reader).then((result) =>
              dispatch({ kind: "read", layerId: effect.layerId, result })
            ),
          );
          break;
        case "load-scripts":
          own(
            deps.flows.scripts(state, effect.owner).then(
              (inventory) =>
                dispatch({
                  kind: "scripts",
                  result: { state: "ready", value: inventory },
                }),
              (error) => dispatch({ kind: "scripts", result: failure(error) }),
            ),
          );
          break;
        case "select":
          context?.select(DESK_LIST_ID, effect.id, { reveal: true });
          break;
        case "abort":
          context?.abort(effect.operationId);
          break;
        case "persist": {
          const preferences = effect.preferences;
          preferencesSaved = preferencesSaved.then(async () => {
            const result = await deps.persist(preferences);
            if (result.status !== "saved") {
              dispatch({ kind: "preferences-failed", reason: result.reason });
            }
          }).catch(fail);
          own(preferencesSaved);
          break;
        }
      }
    }
    return terminal;
  };

  const scheduleSurvey = (afterMs: number): void => {
    if (!alive) return;
    if (surveyTimer !== undefined) scheduler.cancelTimeout(surveyTimer);
    surveyTimer = scheduler.scheduleTimeout(() => {
      surveyTimer = undefined;
      if (foreground) scheduleSurvey(afterMs);
      else dispatch({ kind: "refresh" });
    }, afterMs);
  };

  const survey = (generation: number): void => {
    own(
      deps.observe().then(async ({ data, hints, releaseCheck }) => {
        if (
          data.fleet === undefined ||
          (data.git === null && data.fleet.length === 0)
        ) {
          throw new Error(
            "Fleet observation unavailable; Git state is unknown.",
          );
        }
        return {
          data,
          hints,
          releaseCheck,
          exceptionArgvs: await deskExceptionArgvs(data),
        };
      }).then(
        ({ data, hints, releaseCheck, exceptionArgvs }) => {
          dispatch({
            kind: "observed",
            generation,
            now: deps.now(),
            data,
            hints,
            exceptionArgvs,
            ...(releaseCheck === undefined ? {} : { releaseCheck }),
          });
          discover();
          settle();
          if (!tipRequested) {
            tipRequested = true;
            own(presentTip(data));
          }
        },
        (error) =>
          dispatch({
            kind: "observation-failed",
            generation,
            now: deps.now(),
            error: error instanceof Error ? error.message : String(error),
          }),
      ),
    );
  };

  /**
   * The session's tip is presentation only: it never keeps the Desk closed,
   * and one that can't be chosen leaves the session with none.
   */
  const presentTip = async (data: StatusData): Promise<void> => {
    let tip: DeskTip | undefined;
    await bestEffort("desk-tip-presentation", async () => {
      tip = await deps.tip(data);
    });
    dispatch(tip === undefined ? { kind: "tip" } : { kind: "tip", tip });
  };

  /**
   * Agent and script discovery for every listed task not yet discovered,
   * once each, so a next step that opens an agent is honest before its row
   * was ever selected. The selection reads its own again as it settles.
   */
  const discover = (): void => {
    if (!alive || foreground) return;
    for (const row of state.rows) {
      const taskId = deskRowId(row);
      if (state.capabilities.has(taskId) || discovering.has(taskId)) continue;
      discovering.add(taskId);
      own(
        deps.flows.capabilities(state, row).then((capabilities) => {
          dispatch({
            kind: "capabilities",
            taskId,
            capabilities,
            now: deps.now(),
          });
        }).finally(() => discovering.delete(taskId)),
      );
    }
  };

  /** Read the settled selection's capabilities and evidence. */
  const settle = (): void => {
    if (!alive) return;
    if (settleTimer !== undefined) scheduler.cancelTimeout(settleTimer);
    settleTimer = scheduler.scheduleTimeout(() => {
      settleTimer = undefined;
      readSlot();
    }, DESK_SELECTION_SETTLE_MS);
  };

  const readSlot = (): void => {
    if (!alive || foreground || selected === undefined) return;
    if (slotBusy) {
      slotGeneration++;
      return;
    }
    const ref = rowRef(state, selected);
    let subject: DeskEvidenceSubject | undefined;
    let row: DeskRow | undefined;
    if (ref?.kind === "task") {
      row = ref.row;
      subject = taskEvidenceSubject(ref.row, state.data, state.trunk);
    } else if (ref?.kind === "parked") {
      subject = branchEvidenceSubject(
        ref.branch,
        deps.root,
        state.data,
        state.trunk,
      );
    }
    if (subject === undefined) return;
    const parts = evidenceToRead(state.evidence, subject);
    const generation = ++slotGeneration;
    slotBusy = true;
    const read = subject;
    const task = row;
    own(
      Promise.all([
        parts.length === 0 ? {} : readSelectedEvidence(
          read,
          deps.evidence,
          new AbortController().signal,
          parts,
        ),
        task === undefined ? undefined : deps.flows.capabilities(state, task),
      ]).then(([evidence, capabilities]) => {
        if (!alive || generation !== slotGeneration) return;
        // Even a read of nothing keeps the item's kept parts the newest.
        dispatch({ kind: "evidence", subject: read, read: evidence });
        if (capabilities !== undefined && task !== undefined) {
          dispatch({
            kind: "capabilities",
            taskId: deskRowId(task),
            capabilities,
            now: deps.now(),
          });
        }
      }).finally(() => {
        slotBusy = false;
        if (alive && generation !== slotGeneration) readSlot();
      }),
    );
  };

  /**
   * The package background command that runs one operation beside the
   * screen. Its output and completion facts fold into its progress here,
   * and each fold reports, which the package coalesces and delivers
   * between inputs.
   */
  const operate = (operationId: string): TerminalApplicationCommand => {
    const operation = state.operations.get(operationId);
    const snapshot = withoutOperation(state, operationId);
    return {
      kind: "background",
      id: operationId,
      run: async (report, signal) => {
        if (operation === undefined) return;
        const live = { progress: operation.progress, output: "" };
        running.set(operationId, live);
        const now = (): number => context?.now() ?? 0;
        const reported = (): void => report(progressActivity(live.progress));
        let outcome: DeskOutcome;
        try {
          outcome = await deps.flows.operate(snapshot, operation, {
            signal,
            output: (_stream, text) => {
              live.output = outputTail(`${live.output}${stripAnsi(text)}`);
              reported();
            },
            observe: (fact) => {
              live.progress = progressAfter(live.progress, fact, now());
              reported();
            },
          });
        } catch (error) {
          outcome = failedOutcome(error, operation.command);
        }
        finished.set(operationId, outcome);
      },
    };
  };

  /** How a settled operation's command ended, as the Desk records it. */
  const settled = (
    operationId: string,
    outcome: TerminalApplicationCommandOutcome,
  ): void => {
    const operation = state.operations.get(operationId);
    const output = running.get(operationId)?.output ?? "";
    const left = finished.get(operationId);
    running.delete(operationId);
    finished.delete(operationId);
    if (operation === undefined) return;
    const command = left?.command ?? operation.command;
    dispatch({
      kind: "operation-settled",
      operationId,
      ended: outcome.status === "aborted" ? "stopped" : "ran",
      outcome: outcome.status === "aborted"
        ? { command, ok: false }
        : outcome.status === "failed"
        ? failedOutcome(outcome.error, command)
        : left ?? { command, ok: false },
      output,
      now: deps.now(),
      ...(ui().selected === undefined ? {} : { selected: ui().selected }),
    });
  };

  /**
   * The manual in place of the inbox. The inbox keeps its selection, layers
   * and scroll underneath; while the manual is open the Desk's surveys,
   * ticks and evidence reads wait, and it picks them up once it closes.
   * Before the session's read of it has finished, the Desk hands over the
   * terminal at once, saying so, and opens the manual in place of the inbox
   * as soon as it is read; a read that fails says so back on the Desk.
   * While it waits the Desk hears SIGINT itself, so a Ctrl+C there reaches
   * it as Ctrl+C on the inbox does: it quits, or asks first while
   * operations run beside the screen.
   */
  const openManual = (): TerminalApplicationCommand => {
    const mouse = state.preferences.mouse === true;
    const opened = (read: DeskManual): TerminalApplicationCommand => {
      foreground = true;
      return read.open(mouse, () => {
        foreground = false;
        publish();
        settle();
      });
    };
    if (manual !== undefined) return opened(manual);
    const read = reading;
    if (read === undefined) {
      throw new TypeError("The manual opens only once its read has started.");
    }
    return {
      kind: "foreground",
      handoff: [{ text: DESK_MANUAL_READING }],
      run: async () => {
        foreground = true;
        let waited: DeskManual | typeof INTERRUPTED | undefined;
        try {
          waited = await untilInterrupted(read);
        } catch (error) {
          // The session's own read reports why the manual can't open.
          if (sessionRead(state, "manual") !== "failed") throw error;
        } finally {
          foreground = false;
        }
        if (waited !== undefined && waited !== INTERRUPTED) {
          return opened(waited);
        }
        // Back on the Desk, a Ctrl+C means what it means there; a manual
        // that couldn't be read says why, as choosing it now would.
        const terminal = dispatch({
          kind: "intent",
          intent: waited === INTERRUPTED
            ? DESK_INTERRUPT
            : { kind: "command", command: "manual" },
          ui: ui(),
          now: deps.now(),
          clock: context?.now() ?? 0,
        });
        publish();
        settle();
        return terminal === undefined ? undefined : command(terminal);
      },
    };
  };

  /**
   * Wait for `work` while the Desk has handed over the terminal and no child
   * of its own hears SIGINT: one that arrives ends the wait instead of the
   * process.
   */
  const untilInterrupted = async <T>(
    work: Promise<T>,
  ): Promise<T | typeof INTERRUPTED> => {
    let stop = (): void => {};
    const heard = new Promise<typeof INTERRUPTED>((resolve) => {
      stop = deps.interrupts(() => resolve(INTERRUPTED));
    });
    try {
      return await Promise.race([work, heard]);
    } finally {
      stop();
    }
  };

  /**
   * The background command that opens one reviewed page beside the screen
   * and fills its reader with what that left. It reports no progress: the
   * reader says what is happening until it has opened.
   */
  const openPage = (
    effect: Extract<DeskTerminalEffect, { readonly kind: "open" }>,
  ): TerminalApplicationCommand => {
    const snapshot = state;
    return {
      kind: "background",
      id: effect.commandId,
      run: async (_report, signal) => {
        let outcome: DeskOutcome;
        try {
          outcome = await deps.flows.open(
            snapshot,
            effect.step,
            effect.review,
            signal,
          );
        } catch (error) {
          outcome = failedOutcome(error, effect.review.disclosures.command);
        }
        dispatch({
          kind: "opened",
          layerId: effect.layerId,
          outcome,
          now: deps.now(),
        });
      },
    };
  };

  /** The package command that runs an effect, hands over the terminal, or exits. */
  const command = (
    effect: DeskTerminalEffect,
  ): TerminalApplicationCommand => {
    if (effect.kind === "exit") {
      return { kind: "exit", epilogue: deskEpilogue(state) };
    }
    if (effect.kind === "operate") return operate(effect.operationId);
    if (effect.kind === "manual") return openManual();
    if (effect.kind === "open") return openPage(effect);
    const snapshot = state;
    const handoff = deps.flows.handoff(snapshot, effect);
    return {
      kind: "foreground",
      handoff: [{ text: handoff }],
      run: async () => {
        foreground = true;
        cancel();
        let outcome: DeskOutcome;
        try {
          outcome = await deps.flows.run(snapshot, effect);
        } catch (error) {
          outcome = failedOutcome(error, handoff);
        } finally {
          foreground = false;
        }
        dispatch({ kind: "returned", outcome, now: deps.now() });
        settle();
      },
    };
  };

  return {
    saved: () => preferencesSaved,
    view: deskView(state, { zoomed: false, fields: {} }, env()),
    keymap: [...DESK_KEYMAP],
    viKeys: DESK_VI_KEYS,
    start: (live) => {
      context = live;
      own(
        deps.launches().then((found) => {
          launches = found;
          publish();
        }),
      );
      reading = deps.manual();
      own(
        reading.then(
          (read) => {
            manual = read;
            dispatch({ kind: "manual-read", result: { state: "ready" } });
          },
          (error) =>
            dispatch({
              kind: "manual-read",
              result: {
                state: "failed",
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        ),
      );
      dispatch({ kind: "refresh" });
      return () => {
        alive = false;
        slotGeneration++;
        cancel();
      };
    },
    onAction: (intent, live) => {
      context = live;
      const terminal = dispatch({
        kind: "intent",
        intent,
        ui: deskUi(live.state),
        now: deps.now(),
        clock: live.now(),
      });
      return terminal === undefined ? undefined : command(terminal);
    },
    onSelectionChange: (listId, itemId, live) => {
      context = live;
      if (listId !== DESK_LIST_ID) return;
      selected = itemId;
      publish();
      settle();
    },
    onSelectionMoved: (listId, itemId, move, live) => {
      context = live;
      if (listId !== DESK_LIST_ID) return;
      dispatch({ kind: "selection-moved", itemId, move });
    },
    onDismiss: (target, via, live) => {
      context = live;
      dispatch(
        via === "refused" && "layer" in target
          ? {
            kind: "refused",
            layer: target.layer,
            reason: refusalReason(refusal),
          }
          : { kind: "dismissed", target },
      );
    },
    // A layer built from an unusual observation that breaks a view rule is
    // left out instead of ending the session and what runs beside it.
    onViewRejected: (issues, live) => {
      context = live;
      refusal = issues;
    },
    onField: (layerId, fieldId, value, live) => {
      context = live;
      dispatch({ kind: "field", layerId, fieldId, value });
    },
    onReport: (operationId, _activity, live) => {
      context = live;
      const current = running.get(operationId);
      if (current === undefined) return;
      dispatch({
        kind: "operation-progress",
        operationId,
        progress: current.progress,
        output: current.output,
      });
    },
    onCommandSettled: (operationId, outcome, live) => {
      context = live;
      settled(operationId, outcome);
    },
  };
}
