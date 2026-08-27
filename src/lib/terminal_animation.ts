/**
 * The live-terminal side of the animation family. `terminal_playback.ts` owns
 * the pure planning and composition; this module owns the process boundaries —
 * observing the ambient animation-policy inputs, deciding whether motion is
 * allowed at all, and running a planned playback with interrupt-safe cleanup.
 */

import {
  applyTerminalPlayback,
  type TerminalPlaybackPlan,
  type TerminalPlaybackPort,
} from "./terminal_playback.ts";
import type { TerminalCapabilities } from "discern-design-system/cli";
import {
  type TerminalContext,
  terminalContext,
  terminalSize,
} from "./terminal.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../shared/scheduler.ts";
import {
  INTERRUPT_SIGNALS,
  reraiseInterrupt,
} from "../engine/process_signals.ts";

/** The observed terminal policy inputs consumed by pure animation planners. */
export interface TerminalAnimationEnvironment {
  readonly stdoutIsTerminal: boolean;
  readonly ci: string | undefined;
  readonly terminalColumns: number;
  readonly terminalRows: number;
  readonly capabilities: TerminalCapabilities;
}

/** Interpret the conventional CI marker used by discern's static TTY policy. */
function ciRequestsStatic(value: string | undefined): boolean {
  const marker = value?.trim().toLowerCase();
  return marker !== undefined && marker !== "" && marker !== "false";
}

/** Whether this environment may animate at all; size limits stay the planner's. */
export function terminalAnimationAllowed(
  environment: TerminalAnimationEnvironment,
): boolean {
  return environment.stdoutIsTerminal &&
    !ciRequestsStatic(environment.ci) &&
    environment.capabilities.ansiControl !== false;
}

/** Project one shared process context into the animation planner's pure facts. */
export function terminalAnimationEnvironment(
  terminal: TerminalContext,
): TerminalAnimationEnvironment {
  return {
    stdoutIsTerminal: terminal.stdoutIsTerminal,
    ci: terminal.environment.CI,
    terminalColumns: terminal.size.columns,
    terminalRows: terminal.size.rows,
    capabilities: terminal.capabilities,
  };
}

/** Observe the process once through Discern's sole terminal adapter. */
export function observeTerminalAnimationEnvironment(): TerminalAnimationEnvironment {
  return terminalAnimationEnvironment(terminalContext());
}

/** Wait for one frame and reject promptly when playback is interrupted. */
export function abortableWait(
  milliseconds: number,
  signal: AbortSignal,
  scheduler: Scheduler = SYSTEM_SCHEDULER,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new DOMException("Terminal playback was interrupted", "AbortError"),
      );
      return;
    }
    const onAbort = (): void => {
      scheduler.cancelTimeout(timer);
      reject(
        new DOMException("Terminal playback was interrupted", "AbortError"),
      );
    };
    const timer = scheduler.scheduleTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The real-terminal playback port, assembled from a caller-owned writer. */
export function terminalPlaybackPort(
  write: (value: string) => void,
  scheduler: Scheduler = SYSTEM_SCHEDULER,
): TerminalPlaybackPort {
  const capabilities = terminalContext().capabilities;
  return {
    write,
    wait: (milliseconds, signal) =>
      abortableWait(milliseconds, signal, scheduler),
    terminalSize,
    terminalCapabilities: () => capabilities,
  };
}

/** Re-throw an unknown execution failure through a stable Error boundary. */
function throwExecutionFailure(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }
  throw new Error("The terminal-art command failed", { cause: error });
}

/**
 * Run one planned playback against the live process: interrupt signals abort
 * mid-frame, the executor's cursor cleanup still runs, and the interrupt is
 * re-raised afterwards so the exit status stays conventional.
 */
export async function runTerminalPlayback(
  plan: TerminalPlaybackPlan,
  port: TerminalPlaybackPort,
): Promise<void> {
  const controller = new AbortController();
  const handlers = new Map<Deno.Signal, () => void>();
  let interruptedBy: Deno.Signal | null = null;
  for (const signal of INTERRUPT_SIGNALS) {
    const handler = (): void => {
      interruptedBy ??= signal;
      controller.abort();
    };
    Deno.addSignalListener(signal, handler);
    handlers.set(signal, handler);
  }

  let failure: unknown;
  let failed = false;
  try {
    await applyTerminalPlayback(plan, port, controller.signal);
  } catch (error) {
    if (interruptedBy === null) {
      failed = true;
      failure = error;
    }
  } finally {
    for (const [signal, handler] of handlers) {
      Deno.removeSignalListener(signal, handler);
    }
  }

  if (interruptedBy !== null) {
    reraiseInterrupt(interruptedBy);
  }
  if (failed) {
    throwExecutionFailure(failure);
  }
}
