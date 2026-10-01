/**
 * The live Desk: scheduling, observation, and the handshake with the
 * package's application runtime.
 *
 * Every package callback maps onto one product event and returns the next
 * view synchronously, so a key typed after one that opened a layer already
 * lands on it. This module keeps only what time and effects need: one survey
 * at a time with generation checks, the refresh cadence, the selected-item
 * slot that reads tier-two evidence once the selection settles, the clock
 * that keeps running times current, and the terminal handoffs effects need.
 * Selection, focus, scroll, folds and field editing stay the package's.
 */

import { bestEffort } from "../../shared/best_effort.ts";
import type { Scheduler, TimeoutHandle } from "../../shared/scheduler.ts";
import type {
  TerminalApplicationCommand,
  TerminalApplicationContext,
  TerminalApplicationState,
} from "discern-design-system/cli/interactive";
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
  type DeskEffect,
  type DeskEvent,
  type DeskIntent,
  deskProduct,
  type DeskProductState,
  type DeskReaderSubject,
  type DeskReadResult,
  type DeskScriptOwner,
  type DeskTerminalEffect,
  type DeskUi,
  initialDeskProduct,
  isTerminalEffect,
} from "./desk_state.ts";
import { DESK_LIST_ID, rowRef } from "./desk_transitions.ts";
import { deskKeymap, deskTicks, deskView } from "./inbox_view.ts";
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
import type { DeskFlowStep, DeskOutcome, DeskPrepared } from "./flow_types.ts";

/** How long the selection must stay put before the slot reads its evidence. */
export const DESK_SELECTION_SETTLE_MS = 150;

/** Running times count on once a second between surveys. */
const DESK_TICK_MS = 1_000;

/** The reads and effects flows perform for the live Desk. */
export interface DeskFlows {
  prepare(state: DeskProductState, step: DeskFlowStep): Promise<DeskPrepared>;
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
  handoff(state: DeskProductState, effect: DeskTerminalEffect): string;
  /** Run one effect or child with the terminal. */
  run(
    state: DeskProductState,
    effect: DeskTerminalEffect,
  ): Promise<DeskOutcome>;
}

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
      result: { title: "It didn't complete", markdown: text },
    };
}

/** The scrollback lines printed when the Desk exits: what this session ran. */
export function deskEpilogue(state: DeskProductState): string[] {
  return state.activity.map((entry) =>
    `discern desk ran: ${entry.command} · ${
      entry.ok ? "done" : "didn't complete"
    }`
  );
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
  let foreground = false;
  let launches: readonly DeskAgentLaunch[] = [];
  let surveyTimer: TimeoutHandle | undefined;
  let settleTimer: TimeoutHandle | undefined;
  let tickTimer: TimeoutHandle | undefined;
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
    for (const handle of [surveyTimer, settleTimer, tickTimer]) {
      if (handle !== undefined) scheduler.cancelTimeout(handle);
    }
    surveyTimer = undefined;
    settleTimer = undefined;
    tickTimer = undefined;
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
          own(
            deps.flows.prepare(state, effect.step).then(
              (prepared) =>
                dispatch({
                  kind: "prepared",
                  layerId: effect.layerId,
                  result: { state: "ready", value: prepared },
                }),
              (error) =>
                dispatch({
                  kind: "prepared",
                  layerId: effect.layerId,
                  result: failure(error),
                }),
            ),
          );
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

  /** The package command that hands the terminal to an effect, or exits. */
  const command = (
    effect: DeskTerminalEffect,
  ): TerminalApplicationCommand => {
    if (effect.kind === "exit") {
      return { kind: "exit", epilogue: deskEpilogue(state) };
    }
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
    keymap: deskKeymap(),
    viKeys: true,
    start: (live) => {
      context = live;
      own(
        deps.launches().then((found) => {
          launches = found;
          publish();
        }),
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
  };
}
