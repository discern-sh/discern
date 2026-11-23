/**
 * Where one invocation's own time went: internal diagnostic metadata.
 *
 * A step result already carries the duration of a configured command. This
 * accumulator records the rest of an invocation. Every invocation counts its
 * Git processes and their time, which costs a few dozen bytes in its logbook
 * event and splits any past run into commands, Git, and everything else. An
 * invocation that sets the engine-timing switch also records a window for each
 * plan step and each configured command, with the Git activity before and
 * during it; the time no window covers, less the Git time outside every
 * window, is what discern itself spent in process. Windows cost about 140
 * bytes each, so they are recorded only when asked for. The record measures
 * only; nothing reads it to decide anything, and no report presents it.
 *
 * The accumulator is process-local, like the checkpoint and merge activity
 * mailboxes: the recorder resets it when an invocation begins and drains it
 * when that invocation finishes.
 */

import { type Clock, SYSTEM_CLOCK } from "./clock.ts";
import type { EnvReader } from "./env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import type { PlanStepState } from "./result.ts";

/** Exact value of the engine-timing switch that asks for windows. */
const WINDOWS_REQUESTED_VALUE = "1";

/** Whether the environment asks this invocation to record its windows. */
export function invocationWindowsRequested(env: EnvReader = Deno.env): boolean {
  return env.get(DISCERN_ENVIRONMENT_VARIABLES.engineTiming) ===
    WINDOWS_REQUESTED_VALUE;
}

/**
 * One wall-clock window inside an invocation, with the Git activity around it.
 * A `step` window is a plan step, from its start to its settlement. A
 * `command` window is one configured command's process, such as a job or a
 * standard's measurement.
 */
export type InvocationSpan = {
  kind: "step" | "command";
  /** The plan's label for the step, or the command's label. */
  label: string;
  /** Milliseconds from the invocation's start to the window's start. */
  start_ms: number;
  /** The window's wall-clock length in milliseconds. */
  ms: number;
  /** Git processes that had finished when the window opened. */
  git_calls_before: number;
  /** Their summed wall-clock milliseconds. */
  git_ms_before: number;
  /** Git processes that finished while the window was open. */
  git_calls: number;
  /** Their summed wall-clock milliseconds. Windows that overlap share them. */
  git_ms: number;
};

/** One invocation's drained timing record. */
export type InvocationTiming = {
  /** Every Git process the invocation ran. */
  git_calls: number;
  /** Their summed wall-clock milliseconds. */
  git_ms: number;
  /** Every closed window, in closing order; present only when asked for. */
  spans?: InvocationSpan[];
  /** Closed windows left out once the record was full. */
  dropped?: number;
};

/** A record holds at most this many spans, so one event stays one short line. */
const SPAN_CAPACITY = 256;

interface OpenSpan {
  readonly startedMs: number;
  readonly gitCalls: number;
  readonly gitMs: number;
}

interface State {
  clock: Clock;
  windows: boolean;
  originMs: number;
  gitCalls: number;
  gitMs: number;
  open: Map<string, OpenSpan[]>;
  spans: InvocationSpan[];
  dropped: number;
}

/** A fresh, empty record whose offsets start now. */
function emptyState(clock: Clock, windows: boolean): State {
  return {
    clock,
    windows,
    originMs: clock.monotonicNow(),
    gitCalls: 0,
    gitMs: 0,
    open: new Map(),
    spans: [],
    dropped: 0,
  };
}

let state = emptyState(SYSTEM_CLOCK, false);

/**
 * Discard anything recorded so far and start a new invocation's record now.
 * Windows are recorded when `windows` is set; the environment decides by
 * default.
 */
export function beginInvocationTiming(
  clock: Clock = SYSTEM_CLOCK,
  windows: boolean = invocationWindowsRequested(),
): void {
  state = emptyState(clock, windows);
}

/**
 * Open one Git process's window. The spawning funnel calls the returned
 * function when the process has exited. A process that outlives the record it
 * started under belongs to no record.
 */
export function gitCallStarted(): () => void {
  const opened = state;
  const startedMs = opened.clock.monotonicNow();
  return () => {
    if (state !== opened) return;
    opened.gitCalls += 1;
    opened.gitMs += Math.max(0, opened.clock.monotonicNow() - startedMs);
  };
}

/** Snapshot the instant a window opens. */
function openWindow(record: State): OpenSpan {
  return {
    startedMs: record.clock.monotonicNow(),
    gitCalls: record.gitCalls,
    gitMs: record.gitMs,
  };
}

/** Close a window into its record, or count it as dropped when the record is full. */
function closeWindow(
  record: State,
  kind: InvocationSpan["kind"],
  label: string,
  opened: OpenSpan,
): void {
  if (record.spans.length >= SPAN_CAPACITY) {
    record.dropped += 1;
    return;
  }
  record.spans.push({
    kind,
    label,
    start_ms: Math.round(opened.startedMs - record.originMs),
    ms: Math.round(record.clock.monotonicNow() - opened.startedMs),
    git_calls_before: opened.gitCalls,
    git_ms_before: Math.round(opened.gitMs),
    git_calls: record.gitCalls - opened.gitCalls,
    git_ms: Math.round(record.gitMs - opened.gitMs),
  });
}

/**
 * Record one plan step's transition. A start opens a window; any other state
 * closes the most recent open window with that label. A settlement with no
 * recorded start names a step that took no measurable time and is left out.
 */
export function noteStepTransition(label: string, to: PlanStepState): void {
  if (!state.windows) return;
  if (to === "started") {
    const stack = state.open.get(label) ?? [];
    stack.push(openWindow(state));
    state.open.set(label, stack);
    return;
  }
  const opened = state.open.get(label)?.pop();
  if (opened !== undefined) closeWindow(state, "step", label, opened);
}

/**
 * Open one configured command's window as its process is spawned. The spawner
 * calls the returned function when that process has exited. A command that
 * outlives the record it started under belongs to no record.
 */
export function commandStarted(label: string): () => void {
  const record = state;
  if (!record.windows) return () => {};
  const opened = openWindow(record);
  return () => {
    if (state === record) closeWindow(record, "command", label, opened);
  };
}

/** Drain the current record, or `undefined` when nothing was recorded. */
export function takeInvocationTiming(): InvocationTiming | undefined {
  const drained = state;
  state = emptyState(drained.clock, false);
  if (drained.gitCalls === 0 && drained.spans.length === 0) return undefined;
  return {
    git_calls: drained.gitCalls,
    git_ms: Math.round(drained.gitMs),
    ...(drained.windows ? { spans: drained.spans } : {}),
    ...(drained.dropped > 0 ? { dropped: drained.dropped } : {}),
  };
}
