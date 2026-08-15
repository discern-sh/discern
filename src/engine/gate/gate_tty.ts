/**
 * Gate terminal presentation. Static result tables stay pure; live runs hand
 * lifecycle facts and child text to the package-owned activity-log bracket.
 */

import {
  type ActivityLogController,
  type SpinnerScheduler,
  withActivityLog,
} from "discern-design-system/cli/interactive";
import type {
  TerminalContext,
  TerminalSize,
  TerminalViewportObservation,
} from "../../lib/terminal.ts";
import { terminalLine } from "../../lib/terminal.ts";
import { createTerminalIO } from "../../lib/terminal_painter.ts";
import type { StepResult } from "../../shared/result.ts";
import type { GateStandard } from "../../shared/result_schemas.ts";
import type { JobRunObserver } from "../jobs/runner.ts";
import type {
  Job,
  JobOutputEvent,
  JobOutputObserver,
  JobResult,
} from "../jobs/types.ts";
import type { JobGroup } from "./plan.ts";
import {
  completedGateJobs,
  type GateJobPresentationStatus,
  type GateLiveDashboardKind,
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

/** Live Gate producer consumed by the job scheduler and child-output path. */
export interface GateTtyProgress extends JobRunObserver, JobOutputObserver {
  replaceGroups(groups: readonly JobGroup[]): void;
  /** Collapse the transient tail to the stable job summary and restore the cursor. */
  complete(steps: readonly StepResult[]): Promise<void>;
  /** Release an incomplete frame after an unexpected product-layer failure. */
  abandon(): Promise<void>;
  /** Whether terminal presentation faulted; the Gate result remains authoritative. */
  writeFailed(): boolean;
}

/** Injectable activity details retained for deterministic package-boundary tests. */
export interface GateTtyProgressOptions extends GateTtyOptions {
  scheduler?: SpinnerScheduler;
  intervalMs?: number;
  tailRows?: number;
  /** Gate and standalone test share mechanics without sharing product nouns. */
  kind?: GateLiveDashboardKind;
}

interface DeferredLifetime {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

/** Create a caller-controlled lifetime around the package's async bracket. */
function deferredLifetime(): DeferredLifetime {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (): void => resolvePromise?.(),
    reject: (error): void => rejectPromise?.(error),
  };
}

/** Read the live viewport through the command-owned observer. */
function liveViewport(
  options: GateTtyProgressOptions,
): {
  readonly size: () => TerminalSize;
  readonly close: () => void;
} {
  let observation: TerminalViewportObservation | undefined;
  let current = options.terminal.size;
  try {
    observation = options.terminal.observeViewport();
  } catch {
    observation = undefined;
  }
  return {
    size: (): TerminalSize => {
      try {
        current = observation?.sample() ?? current;
      } catch {
        observation = undefined;
      }
      return current;
    },
    close: (): void => {
      try {
        observation?.close();
      } catch {
        // Presentation cleanup cannot change the Gate result.
      }
      observation = undefined;
    },
  };
}

/** Stable one-line status for a settled Gate job. */
function settledJobFact(result: JobResult): {
  readonly text: string;
  readonly tone: "success" | "warning" | "failure";
} {
  const label = terminalLine(result.label);
  if (result.cancelled === true) {
    return { text: `${label} cancelled`, tone: "warning" };
  }
  return result.code === 0
    ? { text: `${label} passed`, tone: "success" }
    : { text: `${label} failed`, tone: "failure" };
}

/** Adapt scheduler facts and child text to one package producer. */
function gateActivityProducer(
  log: ActivityLogController,
  initialGroups: readonly JobGroup[],
  options: GateTtyProgressOptions,
  lifetime: DeferredLifetime,
  bracket: () => Promise<void>,
  presentationFailed: () => boolean,
  failPresentation: () => void,
  setInterruptHandler: (handler: () => void) => void,
): GateTtyProgress {
  let visible = new Set<string>();
  let closed = false;
  const rail = options.terminal.capabilities.unicode ? "│" : "|";
  const replaceGroups = (groups: readonly JobGroup[]): void => {
    visible = new Set(
      groups.flatMap((group) => group.jobs.map((job) => job.label)),
    );
  };
  replaceGroups(initialGroups);

  const produce = (effect: () => void): void => {
    if (closed || presentationFailed()) return;
    try {
      effect();
    } catch {
      failPresentation();
    }
  };
  const endLifetime = (error?: Error): void => {
    if (closed) return;
    closed = true;
    if (error === undefined) lifetime.resolve();
    else lifetime.reject(error);
  };
  const close = async (error?: Error): Promise<void> => {
    endLifetime(error);
    try {
      await bracket();
    } catch {
      failPresentation();
    }
  };
  setInterruptHandler(() => {
    if (closed || presentationFailed()) return;
    try {
      log.pin("Interrupted", "warning");
      log.finish({ mode: "summary" });
    } catch {
      failPresentation();
    } finally {
      // The Gate runner owns child cancellation and signal re-delivery. End the
      // package bracket now so cursor restoration wins that race.
      endLifetime();
    }
  });

  return {
    replaceGroups,
    started: (job: Job): void => {
      if (!visible.has(job.label)) return;
      produce(() => log.pin(`${terminalLine(job.label)} started`));
    },
    settled: (result: JobResult): void => {
      if (!visible.has(result.label)) return;
      const fact = settledJobFact(result);
      produce(() => log.pin(fact.text, fact.tone));
    },
    output: (event: JobOutputEvent): void => {
      if (!visible.has(event.label)) return;
      const prefix = `${terminalLine(event.label)} ${rail}`;
      produce(() => {
        if (event.kind === "line") {
          log.append(`${prefix} ${event.text}`);
        } else {
          log.updatePartial(
            event.text === "" ? "" : `${prefix} ${event.text}`,
          );
        }
      });
    },
    complete: async (_steps): Promise<void> => {
      produce(() => log.finish({ mode: "summary" }));
      await close();
    },
    abandon: async (): Promise<void> => {
      await close(new Error("Gate activity abandoned"));
    },
    writeFailed: (): boolean => presentationFailed(),
  };
}

/**
 * Open the package activity-log bracket before Gate jobs start. The returned
 * producer closes it on completion, leaving stable job facts in scrollback and
 * discarding the transient bounded tail.
 */
export async function createGateTtyProgress(
  write: (value: string) => void,
  groups: readonly JobGroup[],
  options: GateTtyProgressOptions,
): Promise<GateTtyProgress> {
  const viewport = liveViewport(options);
  let presentationFailed = false;
  const safeWrite = (value: string): void => {
    if (presentationFailed) return;
    try {
      write(value);
    } catch {
      presentationFailed = true;
    }
  };
  const io = createTerminalIO({
    write: safeWrite,
    size: viewport.size,
    capabilities: () => {
      const size = viewport.size();
      return options.terminal.presenter.with({ width: size.columns })
        .capabilities;
    },
  });
  const lifetime = deferredLifetime();
  let interrupted = false;
  let interruptFrame = (): void => {
    interrupted = true;
  };
  let resolveReady: ((progress: GateTtyProgress) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const ready = new Promise<GateTtyProgress>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const bracket = withActivityLog({
    label: options.kind === "test" ? "Test" : "Gate",
    io,
    onInterrupt: (): void => {
      // The Gate's process-level interrupt tracker owns child cancellation and
      // re-delivery. End this package bracket so it restores before that signal
      // is re-raised after the detached children have been reaped.
      interrupted = true;
      interruptFrame();
    },
    ...(options.scheduler === undefined
      ? {}
      : { scheduler: options.scheduler }),
    ...(options.intervalMs === undefined
      ? {}
      : { intervalMs: options.intervalMs }),
    ...(options.tailRows === undefined ? {} : { tailRows: options.tailRows }),
  }, async (log) => {
    resolveReady?.(
      gateActivityProducer(
        log,
        groups,
        options,
        lifetime,
        () => bracket,
        () => presentationFailed,
        () => {
          presentationFailed = true;
        },
        (handler) => {
          interruptFrame = handler;
          if (interrupted) interruptFrame();
        },
      ),
    );
    await lifetime.promise;
  }).catch((error: unknown) => {
    presentationFailed = true;
    const normalized = error instanceof Error
      ? error
      : new Error(String(error));
    rejectReady?.(normalized);
  }).finally(viewport.close);
  try {
    return await ready;
  } catch {
    viewport.close();
    return {
      replaceGroups: (): void => {},
      started: (): void => {},
      settled: (): void => {},
      output: (): void => {},
      complete: async (): Promise<void> => {},
      abandon: async (): Promise<void> => {},
      writeFailed: (): boolean => true,
    };
  }
}

/** Render one package Result summary inside the same explicit viewport. */
export function renderGateTtyStatus(
  message: string,
  status: GateJobPresentationStatus,
  options: GateTtyOptions,
): string {
  return renderGateStatus(message, status, options);
}
