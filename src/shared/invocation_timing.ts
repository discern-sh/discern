/**
 * Where one invocation's own time went: internal diagnostic metadata.
 *
 * A step result already carries a configured command's duration. This module
 * records the rest. Every invocation counts its Git processes and their time:
 * a few dozen bytes in its logbook event, enough to split any past run into
 * commands, Git, and everything else. An invocation that sets the engine-timing
 * switch also records a window for each plan step and each configured command,
 * with the Git activity before and during it; the time no window covers, less
 * the Git time outside every window, is what discern itself spent in process.
 * Windows cost about 140 bytes each, so they are opt-in. The record only
 * measures: nothing reads it to decide anything, and no report presents it.
 *
 * Each invocation owns its record and runs its work inside it. The reporting
 * funnels find it through the async context, so invocations that overlap in
 * one process never mix. Activity outside every record is recorded nowhere.
 */

import { type Clock, SYSTEM_CLOCK } from "./clock.ts";
import type { EnvReader } from "./env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import { AsyncLocalStorage } from "./module_loading.ts";
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

/** One invocation's own record: run its work inside it, then drain it once. */
export interface InvocationTimingRecord {
  /** Run work whose Git processes, steps, and commands belong to this record. */
  run<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Close the record and return what it holds, or `undefined` when nothing was
   * recorded. Activity that finishes after this belongs to no record.
   */
  take(): InvocationTiming | undefined;
}

/** A record holds at most this many spans, so one event stays one short line. */
const SPAN_CAPACITY = 256;

interface OpenSpan {
  readonly startedMs: number;
  readonly gitCalls: number;
  readonly gitMs: number;
}

interface State {
  readonly clock: Clock;
  readonly windows: boolean;
  readonly originMs: number;
  gitCalls: number;
  gitMs: number;
  readonly open: Map<string, OpenSpan[]>;
  readonly spans: InvocationSpan[];
  dropped: number;
  closed: boolean;
}

/** The record the current async context reports to, when it has one. */
const ACTIVE = new AsyncLocalStorage<State>();

/** The live record of the current context, or nothing to report to. */
function activeRecord(): State | undefined {
  const record = ACTIVE.getStore();
  return record === undefined || record.closed ? undefined : record;
}

/**
 * Start one invocation's record now. Windows are recorded when `windows` is
 * set; the environment decides by default.
 */
export function beginInvocationTiming(
  clock: Clock = SYSTEM_CLOCK,
  windows: boolean = invocationWindowsRequested(),
): InvocationTimingRecord {
  const record: State = {
    clock,
    windows,
    originMs: clock.monotonicNow(),
    gitCalls: 0,
    gitMs: 0,
    open: new Map(),
    spans: [],
    dropped: 0,
    closed: false,
  };
  return {
    run: (work) => ACTIVE.run(record, work),
    take(): InvocationTiming | undefined {
      record.closed = true;
      if (record.gitCalls === 0 && record.spans.length === 0) return undefined;
      return {
        git_calls: record.gitCalls,
        git_ms: Math.round(record.gitMs),
        ...(record.windows ? { spans: record.spans } : {}),
        ...(record.dropped > 0 ? { dropped: record.dropped } : {}),
      };
    },
  };
}

/**
 * Open one Git process's window in the current invocation's record. The
 * spawning funnel calls the returned function when the process has exited. A
 * process that outlives its record belongs to no record.
 */
export function gitCallStarted(): () => void {
  const record = activeRecord();
  if (record === undefined) return () => {};
  const startedMs = record.clock.monotonicNow();
  return () => {
    if (record.closed) return;
    record.gitCalls += 1;
    record.gitMs += Math.max(0, record.clock.monotonicNow() - startedMs);
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
  if (record.closed) return;
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
 * Record one plan step's transition in the current invocation's record. A
 * start opens a window; any other state closes the most recent open window
 * with that label. A settlement with no recorded start names a step that took
 * no measurable time and is left out.
 */
export function noteStepTransition(label: string, to: PlanStepState): void {
  const record = activeRecord();
  if (record === undefined || !record.windows) return;
  if (to === "started") {
    const stack = record.open.get(label) ?? [];
    stack.push(openWindow(record));
    record.open.set(label, stack);
    return;
  }
  const opened = record.open.get(label)?.pop();
  if (opened !== undefined) closeWindow(record, "step", label, opened);
}

/**
 * Open one configured command's window in the current invocation's record, as
 * its process is spawned. The spawner calls the returned function when that
 * process has exited. A command that outlives its record belongs to no record.
 */
export function commandStarted(label: string): () => void {
  const record = activeRecord();
  if (record === undefined || !record.windows) return () => {};
  const opened = openWindow(record);
  return () => closeWindow(record, "command", label, opened);
}
