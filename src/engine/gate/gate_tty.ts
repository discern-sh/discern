/**
 * Effectful TTY controller around the Gate's pure package-backed presentation.
 * Scheduler events, cursor replacement, and viewport updates stay here. Typed
 * Gate facts cross into `presentation.ts`; that module performs no observation.
 */

import { DISCERN_TRIANGLE_SPINNER_ORDER } from "discern-design-system/cli";
import type {
  TerminalContext,
  TerminalSize,
  TerminalViewportObservation,
} from "../../lib/terminal.ts";
import { createInlineFramePainter } from "../../lib/terminal_painter.ts";
import type { StepResult } from "../../shared/result.ts";
import type { GateStandard } from "../../shared/result_schemas.ts";
import type { JobRunObserver } from "../jobs/runner.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import type { JobGroup } from "./plan.ts";
import {
  completedGateJobs,
  type GateJobPresentationStatus,
  gateLiveDashboard,
  type GateLiveDashboardKind,
  liveGateJobs,
  renderGateCompactDashboard,
  renderGateJobs,
  renderGateStandards,
  renderGateStatus,
} from "./presentation.ts";

/** Explicit package presentation facts for one Gate frame. */
export interface GateTtyOptions {
  /** Full terminal width in visible columns. */
  width: number;
  /** The already-resolved process-to-package boundary. */
  terminal: TerminalContext;
}

/** Render completed envelope steps and optional Standard readings. */
export function renderGateTtyTable(
  steps: readonly StepResult[],
  options: GateTtyOptions,
  standards: readonly GateStandard[] = [],
  kind: GateLiveDashboardKind = "gate",
): string {
  const jobs = renderGateJobs(completedGateJobs(steps), options, kind);
  const standardFrame = renderGateStandards(standards, options);
  return standardFrame === "" ? jobs : `${jobs}\n\n${standardFrame}`;
}

/** Render the current live workflow from scheduler facts and an injected phase. */
export function renderGateTtyProgressTable(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  options: GateTtyOptions,
  phase = 0,
  startedAtMs: ReadonlyMap<string, number> = new Map(),
  timeMs = 0,
  runStartedAtMs = 0,
  kind: GateLiveDashboardKind = "gate",
): string {
  return renderGateJobs(
    liveGateJobs(groups, running, results, startedAtMs, timeMs),
    { ...options, phase },
    kind,
    Math.max(0, Math.floor((timeMs - runStartedAtMs) / 1000)),
  );
}

/** Render the small live candidate from the same scheduler and clock facts. */
export function renderGateTtyCompactProgress(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  options: GateTtyOptions,
  startedAtMs: ReadonlyMap<string, number> = new Map(),
  timeMs = 0,
  runStartedAtMs = 0,
  kind: GateLiveDashboardKind = "gate",
): string {
  return renderGateCompactDashboard(
    gateLiveDashboard(
      liveGateJobs(groups, running, results, startedAtMs, timeMs),
      kind,
      Math.max(0, Math.floor((timeMs - runStartedAtMs) / 1000)),
    ),
    options,
  );
}

/** The ordered, public presentation policy for one live scheduler snapshot. */
export type GateTtyProgressMode = "full" | "compact" | "continuous";

interface GateTtyFrameCandidates {
  readonly full: string;
  readonly compact: string;
}

/** Render newline-bearing candidates before consulting painter authority. */
function progressFrameCandidates(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  options: GateTtyOptions,
  phase: number,
  startedAtMs: ReadonlyMap<string, number>,
  timeMs: number,
  runStartedAtMs: number,
  kind: GateLiveDashboardKind,
): GateTtyFrameCandidates {
  return {
    full: `${
      renderGateTtyProgressTable(
        groups,
        running,
        results,
        options,
        phase,
        startedAtMs,
        timeMs,
        runStartedAtMs,
        kind,
      )
    }\n`,
    compact: `${
      renderGateTtyCompactProgress(
        groups,
        running,
        results,
        options,
        startedAtMs,
        timeMs,
        runStartedAtMs,
        kind,
      )
    }\n`,
  };
}

/** Select full, then compact, then continuous through package refusal alone. */
export function gateTtyProgressMode(
  groups: readonly JobGroup[],
  options: GateTtyOptions,
  kind: GateLiveDashboardKind = "gate",
): GateTtyProgressMode {
  const frames = progressFrameCandidates(
    groups,
    new Set(),
    new Map(),
    options,
    0,
    new Map(),
    0,
    0,
    kind,
  );
  for (const mode of ["full", "compact"] as const) {
    const painter = createInlineFramePainter({
      write: () => {},
      size: () => options.terminal.size,
      capabilities: () =>
        options.terminal.presenter.with({ width: options.width }).capabilities,
    });
    if (painter.replace(frames[mode]).status !== "refused") return mode;
  }
  return "continuous";
}

/** Whether the package painter accepts the initial Gate frame for replacement. */
export function gateTtyProgressCanRepaint(
  groups: readonly JobGroup[],
  options: GateTtyOptions,
): boolean {
  return gateTtyProgressMode(groups, options) !== "continuous";
}

/** Injectable repeating scheduler for deterministic activity-frame tests. */
export interface GateProgressScheduler {
  repeat(callback: () => void, intervalMs: number): () => void;
}

const systemProgressScheduler: GateProgressScheduler = {
  repeat(callback, intervalMs): () => void {
    const timer = setInterval(callback, intervalMs);
    return () => clearInterval(timer);
  },
};

/** The effectful controller that keeps one live workflow in place on a TTY. */
export interface GateTtyProgress extends JobRunObserver {
  start(groups: readonly JobGroup[]): void;
  replaceGroups(groups: readonly JobGroup[]): void;
  complete(
    steps: readonly StepResult[],
  ): void;
  /** Current presentation mode; continuous is a one-way safety latch. */
  mode(): GateTtyProgressMode;
  /** Whether completion safely left the live region before the final detail. */
  renderedFinal(): boolean;
  /** Whether the live writer faulted and all further presentation must stop. */
  writeFailed(): boolean;
}

/** Controller-only options. Pure view functions never receive the scheduler. */
export interface GateTtyProgressOptions extends GateTtyOptions {
  scheduler?: GateProgressScheduler;
  intervalMs?: number;
  initialPhase?: number;
  /** Effectful time source; pure views receive only its numeric reading. */
  clock?: () => number;
  /** Gate and standalone test share mechanics without sharing product nouns. */
  kind?: GateLiveDashboardKind;
}

/** Validate and default the package activity-frame interval. */
function progressInterval(intervalMs: number | undefined): number {
  const interval = intervalMs ?? 80;
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new TypeError(
      `Gate progress interval must be a positive safe integer; received ${interval}`,
    );
  }
  return interval;
}

/**
 * Create one in-place package workflow. ANSI SGR follows the supplied terminal
 * context. Cursor movement remains active without colour because it owns layout.
 */
export function createGateTtyProgress(
  write: (value: string) => void,
  options: GateTtyProgressOptions,
): GateTtyProgress {
  const running = new Set<string>();
  const results = new Map<string, JobResult>();
  const startedAtMs = new Map<string, number>();
  const scheduler = options.scheduler ?? systemProgressScheduler;
  const clock = options.clock ?? Date.now;
  const kind = options.kind ?? "gate";
  const intervalMs = progressInterval(options.intervalMs);
  let groups: readonly JobGroup[] | undefined;
  let visible = new Set<string>();
  let redrawQueued = false;
  let completed = false;
  let currentMode: GateTtyProgressMode = "full";
  let paintFailed = false;
  let finalRendered = false;
  let phase = options.initialPhase ?? 0;
  let runStartedAtMs = 0;
  let viewport: TerminalSize = {
    columns: options.width,
    rows: options.terminal.size.rows,
  };
  let stopRepeating: (() => void) | undefined;
  let observation: TerminalViewportObservation | undefined;
  let lastContinuousFrame: string | undefined;
  const painter = createInlineFramePainter({
    write,
    size: () => viewport,
    capabilities: () =>
      options.terminal.presenter.with({ width: viewport.columns }).capabilities,
  });

  const frameOptions = (): GateTtyOptions => ({
    width: viewport.columns,
    terminal: options.terminal,
  });

  const stopTicker = (): void => {
    try {
      stopRepeating?.();
    } catch {
      // Presentation cleanup cannot change the Gate's scheduler result.
    }
    stopRepeating = undefined;
  };

  const closeObservation = (): void => {
    try {
      observation?.close();
    } catch {
      // Observation cleanup is presentation-only and must stay best effort.
    }
    observation = undefined;
  };

  const abandonPaint = (): void => {
    paintFailed = true;
    currentMode = "continuous";
    stopTicker();
    closeObservation();
  };

  const attemptWrite = (effect: () => void): boolean => {
    if (paintFailed) return false;
    try {
      effect();
      return true;
    } catch {
      // Once a write fails, the physical cursor position is unknowable. Never
      // issue a compensating erase or let presentation mask the Gate result.
      abandonPaint();
      return false;
    }
  };

  const sampleViewport = (): void => {
    if (observation === undefined) return;
    try {
      const next = observation.sample();
      if (
        !Number.isFinite(next.columns) || next.columns < 1 ||
        !Number.isFinite(next.rows) || next.rows < 1
      ) return;
      viewport = {
        columns: Math.floor(next.columns),
        rows: Math.floor(next.rows),
      };
    } catch {
      // An injected or platform reader that disappears leaves the last viewport.
      closeObservation();
    }
  };

  const frames = (): GateTtyFrameCandidates | undefined => {
    if (groups === undefined) return undefined;
    const timeMs = clock();
    return progressFrameCandidates(
      groups,
      running,
      results,
      frameOptions(),
      phase,
      startedAtMs,
      timeMs,
      runStartedAtMs,
      kind,
    );
  };

  const appendContinuousFrame = (frame: string): boolean => {
    if (frame === lastContinuousFrame) return true;
    const written = attemptWrite(() => write(frame));
    if (written) lastContinuousFrame = frame;
    return written;
  };

  const enterContinuous = (frame: string): boolean => {
    currentMode = "continuous";
    stopTicker();
    closeObservation();
    // A refusal is write-free. Append below the last physical frame without a
    // clear or cursor guess, even when a shrink made that frame unsafe.
    return appendContinuousFrame(frame);
  };

  const replaceLive = (): void => {
    if (paintFailed || currentMode === "continuous") return;
    const candidates = frames();
    if (candidates === undefined) return;
    if (
      painter.currentFrame === "" && !attemptWrite(() => write("\n"))
    ) return;
    for (const mode of ["full", "compact"] as const) {
      let result: ReturnType<typeof painter.replace>;
      try {
        result = painter.replace(candidates[mode]);
      } catch {
        abandonPaint();
        return;
      }
      if (result.status !== "refused") {
        currentMode = mode;
        return;
      }
      if (
        result.reason === "current-frame-exceeds-viewport" ||
        result.reason === "ansi-control-unavailable"
      ) {
        enterContinuous(candidates.compact);
        return;
      }
    }
    enterContinuous(candidates.compact);
  };

  const redraw = (): void => {
    if (
      groups === undefined || completed || paintFailed ||
      currentMode === "continuous"
    ) return;
    sampleViewport();
    replaceLive();
  };

  const queueRedraw = (): void => {
    if (
      redrawQueued || completed || paintFailed || currentMode === "continuous"
    ) return;
    redrawQueued = true;
    queueMicrotask(() => {
      redrawQueued = false;
      try {
        redraw();
      } catch {
        abandonPaint();
      }
    });
  };

  const syncTicker = (): void => {
    if (completed || paintFailed || currentMode === "continuous") {
      stopTicker();
      return;
    }
    if (stopRepeating !== undefined) return;
    stopRepeating = scheduler.repeat(() => {
      phase = (phase + 1) % DISCERN_TRIANGLE_SPINNER_ORDER.length;
      queueRedraw();
    }, intervalMs);
  };

  const setGroups = (next: readonly JobGroup[]): void => {
    groups = next;
    visible = new Set(
      next.flatMap((group) => group.jobs.map((job) => job.label)),
    );
  };

  const appendContinuousUpdate = (): void => {
    if (paintFailed || currentMode !== "continuous") return;
    const update = frames()?.compact;
    if (update !== undefined) appendContinuousFrame(update);
  };

  return {
    start: (next): void => {
      setGroups(next);
      runStartedAtMs = clock();
      try {
        observation = options.terminal.observeViewport();
      } catch {
        observation = undefined;
      }
      try {
        redraw();
        syncTicker();
      } catch {
        abandonPaint();
      }
    },
    replaceGroups: (next): void => {
      if (completed) return;
      setGroups(next);
      if (currentMode === "continuous") {
        appendContinuousUpdate();
        return;
      }
      try {
        redraw();
      } catch {
        abandonPaint();
      }
    },
    started: (job: Job): void => {
      if (!visible.has(job.label) || completed) return;
      running.add(job.label);
      startedAtMs.set(job.label, clock());
      if (currentMode === "continuous") {
        appendContinuousUpdate();
        return;
      }
      syncTicker();
      queueRedraw();
    },
    settled: (result: JobResult): void => {
      if (!visible.has(result.label) || completed) return;
      running.delete(result.label);
      startedAtMs.delete(result.label);
      results.set(result.label, result);
      if (currentMode === "continuous") {
        appendContinuousUpdate();
        return;
      }
      syncTicker();
      queueRedraw();
    },
    complete: (steps): void => {
      completed = true;
      stopTicker();
      closeObservation();
      if (paintFailed) return;
      const finalFrame = `${
        renderGateCompactDashboard(
          gateLiveDashboard(
            completedGateJobs(steps),
            kind,
            Math.max(0, Math.floor((clock() - runStartedAtMs) / 1000)),
          ),
          frameOptions(),
        )
      }\n`;
      if (currentMode === "continuous") {
        finalRendered = appendContinuousFrame(finalFrame);
        return;
      }
      try {
        const result = painter.replace(finalFrame);
        if (result.status === "refused") {
          finalRendered = enterContinuous(finalFrame);
          return;
        }
        finalRendered = attemptWrite(() => painter.finish());
      } catch {
        abandonPaint();
      }
    },
    mode: (): GateTtyProgressMode => currentMode,
    renderedFinal: (): boolean => finalRendered,
    writeFailed: (): boolean => paintFailed,
  };
}

/** Render one package Result summary inside the same explicit viewport. */
export function renderGateTtyStatus(
  message: string,
  status: GateJobPresentationStatus,
  options: GateTtyOptions,
): string {
  return renderGateStatus(message, status, options);
}

/** The terminal widths available to a gate verb's static and live projections. */
export interface GateTtyPresentation {
  ttyWidth?: number;
  liveWidth?: number;
}

/** Resolve the common TTY, CI, and `--plain` effect boundary once. */
export function gateTtyPresentation(
  json: boolean,
  plain: boolean,
  terminal: TerminalContext,
): GateTtyPresentation {
  if (json || !terminal.stdoutIsTerminal) return {};
  const width = terminal.size.columns;
  return {
    ttyWidth: width,
    ...(plain || terminal.ciRequestsStaticOutput ||
        terminal.capabilities.ansiControl === false
      ? {}
      : { liveWidth: width }),
  };
}
