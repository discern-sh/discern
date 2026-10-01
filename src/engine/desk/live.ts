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
} from "discern-design-system/cli/interactive";
import { stripAnsi } from "../../shared/color_env.ts";
import type { DeskEffectSession } from "./execution.ts";
import { progressActivity, progressAfter } from "./operations.ts";
import {
  isInteractionCancelled,
  type TerminalApplicationOptions,
} from "../../lib/terminal_interaction.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
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
import { DESK_LIST_ID, rowRef, withoutOperation } from "./desk_transitions.ts";
import {
  DESK_KEYMAP,
  DESK_VI_KEYS,
  deskTicks,
  deskView,
} from "./inbox_view.ts";
import {
  branchEvidenceSubject,
  cachedEvidence,
  type DeskEvidence,
  type DeskEvidenceReader,
  type DeskEvidenceSubject,
  evidenceComplete,
  evidenceKey,
  readSelectedEvidence,
  taskEvidenceSubject,
} from "./evidence.ts";
import type { DeskFlowStep, DeskOutcome, DeskReview } from "./flow_types.ts";
import type { DeskManual } from "./manual.ts";
import { failureSheet } from "./review.ts";

/** How long the selection must stay put before the slot reads its evidence. */
export const DESK_SELECTION_SETTLE_MS = 150;

/** Running times count on once a second between surveys. */
const DESK_TICK_MS = 1_000;

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
  }>;
  readonly tip: (data: StatusData) => Promise<string | undefined>;
  /** Read the manual, which the session does once as it starts. */
  readonly manual: () => Promise<DeskManual>;
  readonly evidence: DeskEvidenceReader;
  readonly flows: DeskFlows;
  readonly persist: (
    preferences: DeskPreferences,
  ) => Promise<DeskPreferencesWriteResult>;
  readonly now: () => number;
  readonly scheduler: Scheduler;
}

/** Whether cached evidence needs no new read. */
function complete(evidence: DeskEvidence | undefined): boolean {
  return evidence !== undefined && evidenceComplete(evidence);
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

/** Build the package options for one Desk session. */
export function liveDesk(
  deps: LiveDeskDependencies,
): TerminalApplicationOptions<DeskIntent> {
  const scheduler = deps.scheduler;
  let state = initialDeskProduct({
    trunk: deps.trunk,
    preferences: deps.preferences,
  });
  let context: TerminalApplicationContext<DeskIntent> | undefined;
  let alive = true;
  /** A child or the manual has the screen: surveys, ticks and reads wait. */
  let foreground = false;
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
  let tipRequested = false;
  let selected: string | undefined;
  let slotGeneration = 0;
  let slotBusy = false;
  const ui = (): DeskUi =>
    context === undefined
      ? { zoomed: false, fields: {} }
      : deskUi(context.state);
  const env = () => ({
    now: deps.now(),
    root: deps.root,
    version: deps.version,
    launches,
  });
  const fail = (error: unknown): void => context?.fail(error);
  /**
   * Work the session started and has not seen settle. Each read and effect
   * reports into the session when it finishes; a failure fails the session,
   * and nothing reports after the session ends.
   */
  const pending = new Set<Promise<void>>();
  const own = (work: Promise<unknown>): void => {
    const owned: Promise<void> = work.then(() => {}, fail).finally(() => {
      pending.delete(owned);
    });
    pending.add(owned);
  };

  /** Keep running times current while any is visible and surveys succeed. */
  const tick = (): void => {
    if (!alive || foreground || tickTimer !== undefined || !deskTicks(state)) {
      return;
    }
    tickTimer = scheduler.scheduleTimeout(() => {
      tickTimer = undefined;
      publish();
    }, DESK_TICK_MS);
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
        case "persist":
          own(
            deps.persist(effect.preferences).then((result) => {
              if (result.status !== "saved") {
                dispatch({ kind: "preferences-failed", reason: result.reason });
              }
            }),
          );
          break;
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
      deps.observe().then(async ({ data, hints }) => {
        if (
          data.fleet === undefined ||
          (data.git === null && data.fleet.length === 0)
        ) {
          throw new Error(
            "Fleet observation unavailable; Git state is unknown.",
          );
        }
        return { data, hints, exceptionArgvs: await deskExceptionArgvs(data) };
      }).then(
        ({ data, hints, exceptionArgvs }) => {
          dispatch({
            kind: "observed",
            generation,
            now: deps.now(),
            data,
            hints,
            exceptionArgvs,
          });
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

  /** The session's tip is presentation only: it never keeps the Desk closed. */
  const presentTip = async (data: StatusData): Promise<void> => {
    await bestEffort("desk-tip-presentation", async () => {
      const tip = await deps.tip(data);
      if (tip !== undefined) dispatch({ kind: "tip", tip });
    });
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
    const key = evidenceKey(subject);
    const generation = ++slotGeneration;
    slotBusy = true;
    const read = subject;
    const task = row;
    own(
      Promise.all([
        !complete(cachedEvidence(state.evidence, key))
          ? readSelectedEvidence(
            read,
            deps.evidence,
            new AbortController().signal,
          )
          : undefined,
        task === undefined ? undefined : deps.flows.capabilities(state, task),
      ]).then(([evidence, capabilities]) => {
        if (!alive || generation !== slotGeneration) return;
        if (evidence !== undefined) {
          dispatch({ kind: "evidence", key, evidence });
        }
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
    });
  };

  /**
   * The manual in place of the inbox. The inbox keeps its selection, layers
   * and scroll underneath; while the manual is open the Desk's surveys,
   * ticks and evidence reads wait, and it picks them up once it closes.
   */
  const openManual = (): TerminalApplicationCommand => {
    if (manual === undefined) {
      throw new TypeError("The manual opens only once it has been read.");
    }
    foreground = true;
    return manual.open(state.preferences.mouse === true, () => {
      foreground = false;
      publish();
      settle();
    });
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
      own(
        deps.manual().then(
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
    onDismiss: (target, _via, live) => {
      context = live;
      dispatch({ kind: "dismissed", target });
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
