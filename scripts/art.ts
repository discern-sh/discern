/** Print or animate the complete discern terminal-art family for visual review. */

import {
  applyTerminalPlayback,
  planTerminalPlayback,
  type TerminalAnimationScene,
  type TerminalPlaybackPlan,
} from "../src/lib/terminal_playback.ts";
import { type TerminalSize, terminalSize } from "../src/lib/text.ts";
import { writeStderr, writeStdout } from "../src/engine/output.ts";
import {
  INTERRUPT_SIGNALS,
  reraiseInterrupt,
} from "../src/engine/process_signals.ts";
import { DISCERN_ART_VARIANTS } from "../src/shared/brand_art.ts";

const ART_USAGE = "Run `deno task art` or `deno task art --animate`.";

/** The observed terminal policy inputs consumed by the pure command planner. */
export interface ArtCommandEnvironment {
  readonly stdoutIsTerminal: boolean;
  readonly ci: string | undefined;
  readonly term: string | undefined;
  readonly terminalColumns: number;
  readonly terminalRows: number;
}

/** The validated command decision computed before any terminal output. */
export type ArtCommandPlan =
  | { readonly mode: "static"; readonly output: string }
  | { readonly mode: "animate"; readonly playback: TerminalPlaybackPlan }
  | { readonly mode: "error"; readonly message: string };

/** The complete output, timer, and cancellation boundary for the command. */
export interface ArtCommandPort {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly terminalSize: () => TerminalSize;
}

/** Render every registered variant in stable order with a compact name label. */
export function renderArtGallery(): string {
  return Object.entries(DISCERN_ART_VARIANTS)
    .map(([name, variant]) => `[${name}]\n${variant.render()}`)
    .join("\n\n");
}

/** Derive one labelled semantic animation scene from every registered variant. */
export function artAnimationScenes(): readonly TerminalAnimationScene[] {
  return Object.entries(DISCERN_ART_VARIANTS).map(([name, variant]) => {
    const animation = variant.animate();
    return Object.freeze({
      label: `[${name}]`,
      frames: animation.frames,
      frameMs: animation.frameMs,
      finalHoldMs: animation.finalHoldMs,
    });
  });
}

/** Interpret the conventional CI marker used by discern's static TTY policy. */
function ciRequestsStatic(value: string | undefined): boolean {
  const marker = value?.trim().toLowerCase();
  return marker !== undefined && marker !== "" && marker !== "false";
}

/**
 * Validate arguments and compute the complete static or animated output plan.
 * Animation falls back to the unchanged static gallery off a capable TTY.
 */
export function planArtCommand(
  args: readonly string[],
  environment: ArtCommandEnvironment,
): ArtCommandPlan {
  if (args.length > 0 && (args.length !== 1 || args[0] !== "--animate")) {
    return {
      mode: "error",
      message: `art: expected no arguments or \`--animate\`. Received ${
        args.map((arg) => JSON.stringify(arg)).join(" ")
      }. ${ART_USAGE}`,
    };
  }

  const gallery = `${renderArtGallery()}\n`;
  if (args.length === 0) {
    return { mode: "static", output: gallery };
  }

  const term = environment.term?.trim().toLowerCase();
  if (
    !environment.stdoutIsTerminal ||
    ciRequestsStatic(environment.ci) ||
    term === "dumb"
  ) {
    return { mode: "static", output: gallery };
  }

  const playback = planTerminalPlayback(artAnimationScenes(), {
    terminalColumns: environment.terminalColumns,
    terminalRows: environment.terminalRows,
    finalTranscript: renderArtGallery(),
  });
  return playback === null
    ? { mode: "static", output: gallery }
    : { mode: "animate", playback };
}

/** Apply a settled command plan through its single output/timer boundary. */
export async function executeArtCommand(
  plan: ArtCommandPlan,
  port: ArtCommandPort,
  signal: AbortSignal,
): Promise<number> {
  if (plan.mode === "error") {
    port.stderr(`${plan.message}\n`);
    return 1;
  }
  if (plan.mode === "static") {
    port.stdout(plan.output);
    return 0;
  }
  await applyTerminalPlayback(
    plan.playback,
    {
      write: port.stdout,
      wait: port.wait,
      terminalSize: port.terminalSize,
    },
    signal,
  );
  return 0;
}

/** Wait for one frame and reject promptly when playback is interrupted. */
function abortableWait(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new DOMException("Terminal playback was interrupted", "AbortError"),
      );
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new DOMException("Terminal playback was interrupted", "AbortError"),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Read one narrowly permitted environment value without making imports effectful. */
function readEnvironment(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Observe the live terminal inputs after the command's static code has loaded. */
function observeArtEnvironment(): ArtCommandEnvironment {
  const dimensions = terminalSize();
  return {
    stdoutIsTerminal: Deno.stdout.isTerminal(),
    ci: readEnvironment("CI"),
    term: readEnvironment("TERM"),
    terminalColumns: dimensions.columns,
    terminalRows: dimensions.rows,
  };
}

/** Re-throw an unknown execution failure through a stable Error boundary. */
function throwExecutionFailure(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }
  throw new Error("The terminal-art command failed", { cause: error });
}

/** Run an animated plan with catchable-signal cleanup and conventional exit status. */
async function executeWithSignals(
  plan: ArtCommandPlan,
  port: ArtCommandPort,
): Promise<number> {
  if (plan.mode !== "animate") {
    return await executeArtCommand(plan, port, new AbortController().signal);
  }

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

  let code = 1;
  let failure: unknown;
  let failed = false;
  try {
    code = await executeArtCommand(plan, port, controller.signal);
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
  return code;
}

/** Plan and run the maintainer gallery against the real terminal boundaries. */
async function main(): Promise<number> {
  const plan = planArtCommand(Deno.args, observeArtEnvironment());
  return await executeWithSignals(plan, {
    stdout: writeStdout,
    stderr: writeStderr,
    wait: abortableWait,
    terminalSize,
  });
}

if (import.meta.main) {
  Deno.exit(await main());
}
