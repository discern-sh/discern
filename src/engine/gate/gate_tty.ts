/**
 * Effectful TTY controller around the Gate's pure package-backed presentation.
 * Scheduler events, cursor replacement, and viewport updates stay here. Typed
 * Gate facts cross into `presentation.ts`; that module performs no observation.
 */

import { DISCERN_TRIANGLE_SPINNER_ORDER } from "discern-design-system/cli";
import type { TerminalContext, TerminalSize } from "../../lib/terminal.ts";
import { createInlineFramePainter } from "../../lib/terminal_painter.ts";
import type { StepResult } from "../../shared/result.ts";
import type { GateStandard } from "../../shared/result_schemas.ts";
import type { JobRunObserver } from "../jobs/runner.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import type { JobGroup } from "./plan.ts";
import {
  completedGateJobs,
  type GateJobPresentationStatus,
  liveGateJobs,
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
): string {
  const jobs = renderGateJobs(completedGateJobs(steps), options);
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
): string {
  return renderGateJobs(
    liveGateJobs(groups, running, results, startedAtMs, timeMs),
    { ...options, phase },
  );
}

/** Whether the package painter accepts the initial Gate frame for replacement. */
export function gateTtyProgressCanRepaint(
  groups: readonly JobGroup[],
  options: GateTtyOptions,
): boolean {
  const painter = createInlineFramePainter({
    write: () => {},
    size: () => options.terminal.size,
    capabilities: () => ({
      ...options.terminal.capabilities,
      columns: options.width,
    }),
  });
  return painter.replace(
    `${
      renderGateTtyProgressTable(
        groups,
        new Set(),
        new Map(),
        options,
      )
    }\n`,
  ).status !== "refused";
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
  /** Update an explicitly observed viewport before the next repaint. */
  resize(size: TerminalSize): void;
  complete(
    steps: readonly StepResult[],
    standards?: readonly GateStandard[],
  ): void;
  /** Whether completion successfully left one final Gate frame visible. */
  renderedFinal(): boolean;
}

/** Controller-only options. Pure view functions never receive the scheduler. */
export interface GateTtyProgressOptions extends GateTtyOptions {
  scheduler?: GateProgressScheduler;
  intervalMs?: number;
  initialPhase?: number;
  /** Effectful time source; pure views receive only its numeric reading. */
  clock?: () => number;
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
  const intervalMs = progressInterval(options.intervalMs);
  let groups: readonly JobGroup[] | undefined;
  let visible = new Set<string>();
  let redrawQueued = false;
  let completed = false;
  let repainting = true;
  let paintFailed = false;
  let finalRendered = false;
  let phase = options.initialPhase ?? 0;
  let viewport: TerminalSize = {
    columns: options.width,
    rows: options.terminal.size.rows,
  };
  let stopRepeating: (() => void) | undefined;
  const painter = createInlineFramePainter({
    write,
    size: () => viewport,
    capabilities: () => ({
      ...options.terminal.capabilities,
      columns: viewport.columns,
    }),
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

  const abandonPaint = (): void => {
    paintFailed = true;
    repainting = false;
    stopTicker();
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

  const replace = (table: string, final = false): void => {
    if (paintFailed) return;
    if (!repainting) {
      if (final) {
        finalRendered = attemptWrite(() => write(`${table}\n`));
      }
      return;
    }
    if (
      painter.currentFrame === "" && !attemptWrite(() => write("\n"))
    ) return;
    let result: ReturnType<typeof painter.replace>;
    try {
      result = painter.replace(`${table}\n`);
    } catch {
      abandonPaint();
      return;
    }
    if (result.status !== "refused") {
      if (final) finalRendered = true;
      return;
    }
    if (
      painter.currentFrame !== "" &&
      !attemptWrite(() => painter.clear())
    ) return;
    repainting = false;
    stopTicker();
    if (final) {
      finalRendered = attemptWrite(() => write(`${table}\n`));
    }
  };

  const redraw = (): void => {
    if (groups === undefined || completed || paintFailed || !repainting) return;
    replace(
      renderGateTtyProgressTable(
        groups,
        running,
        results,
        frameOptions(),
        phase,
        startedAtMs,
        clock(),
      ),
    );
  };

  const queueRedraw = (): void => {
    if (redrawQueued || completed || paintFailed || !repainting) return;
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
    if (completed || paintFailed || !repainting || running.size === 0) {
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

  return {
    start: (next): void => {
      setGroups(next);
      try {
        redraw();
      } catch {
        abandonPaint();
      }
    },
    replaceGroups: (next): void => {
      if (completed) return;
      setGroups(next);
      try {
        redraw();
      } catch {
        abandonPaint();
      }
    },
    resize: (next): void => {
      if (
        !Number.isFinite(next.columns) || next.columns < 1 ||
        !Number.isFinite(next.rows) || next.rows < 1
      ) return;
      viewport = {
        columns: Math.floor(next.columns),
        rows: Math.floor(next.rows),
      };
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
      syncTicker();
      queueRedraw();
    },
    settled: (result: JobResult): void => {
      if (!visible.has(result.label) || completed) return;
      running.delete(result.label);
      startedAtMs.delete(result.label);
      results.set(result.label, result);
      syncTicker();
      queueRedraw();
    },
    complete: (steps, standards = []): void => {
      completed = true;
      stopTicker();
      if (paintFailed) return;
      try {
        replace(renderGateTtyTable(steps, frameOptions(), standards), true);
      } catch {
        abandonPaint();
      }
    },
    renderedFinal: (): boolean => finalRendered,
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
