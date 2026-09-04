/**
 * A generic plan/apply boundary for short, in-place terminal animations.
 * Semantic frames enter without ANSI; the planner validates and composes them,
 * and the executor alone owns cursor state, redraws, and waits.
 */

import type { TerminalCapabilities } from "discern-design-system/cli";
import { displayWidth, type TerminalSize } from "./text.ts";
import { bestEffortSync } from "../shared/best_effort.ts";
import { terminalCapabilitiesAtWidth } from "./terminal.ts";
import {
  createInlineFramePainter,
  type InlineFramePainter,
} from "./terminal_painter.ts";

const MAX_FRAME_MS = 1_000;
const MAX_FINAL_HOLD_MS = 5_000;

/** One labelled semantic animation before terminal cursor controls are applied. */
export interface TerminalAnimationScene {
  readonly label: string;
  readonly frames: readonly string[];
  readonly frameMs: number;
  readonly finalHoldMs: number;
}

/** One scene after its label has been composed into each redraw viewport. */
export interface PlannedTerminalAnimationScene {
  readonly viewports: readonly string[];
  readonly frameMs: number;
  readonly finalHoldMs: number;
}

/** The complete set of terminal writes and timing decisions for one playback. */
export interface TerminalPlaybackPlan {
  readonly scenes: readonly PlannedTerminalAnimationScene[];
  readonly finalTranscript: string;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** The only effect boundary the terminal-animation executor can use. */
export interface TerminalPlaybackPort {
  readonly write: (value: string) => void;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly terminalSize: () => TerminalSize;
  /** Explicit control facts; omission preserves the capable test seam. */
  readonly terminalCapabilities?: () => TerminalCapabilities;
}

/** A captured cleanup failure that preserves thrown values of any type. */
interface CapturedFailure {
  readonly error: unknown;
}

/** Reject control bytes, final newlines, and whitespace that would corrupt redraws. */
function assertSemanticText(text: string, label: string): void {
  if (text === "") {
    throw new TypeError(`${label} must not be empty`);
  }
  if (text.endsWith("\n")) {
    throw new TypeError(`${label} must not own a final newline`);
  }
  for (const character of text) {
    if (character !== "\n" && /[\p{Cc}\p{Cf}]/u.test(character)) {
      throw new TypeError(
        `${label} contains terminal control ${JSON.stringify(character)}`,
      );
    }
  }
  for (const line of text.split("\n")) {
    if (/\s$/u.test(line)) {
      throw new TypeError(
        `${label} has trailing whitespace in ${JSON.stringify(line)}`,
      );
    }
  }
}

/** Validate one bounded integer duration before any terminal effect occurs. */
function assertDuration(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} to ${maximum}; received ${value}`,
    );
  }
}

/** Count the rows occupied by one composed terminal viewport. */
function viewportHeight(viewport: string): number {
  return viewport.split("\n").length;
}

/** Measure the widest display row without treating Unicode bytes as columns. */
function viewportWidth(viewport: string): number {
  return Math.max(...viewport.split("\n").map(displayWidth));
}

/**
 * Validate and compose every scene before the first cursor write. Returns null
 * when the terminal cannot leave the required wrap and scroll margins.
 */
export function planTerminalPlayback(
  scenes: readonly TerminalAnimationScene[],
  options: {
    readonly terminalColumns: number;
    readonly terminalRows: number;
    readonly finalTranscript: string;
  },
): TerminalPlaybackPlan | null {
  if (scenes.length === 0) {
    throw new TypeError("terminal playback needs at least one scene");
  }
  assertSemanticText(options.finalTranscript, "final transcript");

  const planned: PlannedTerminalAnimationScene[] = [];
  let maxWidth = 0;
  let maxHeight = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    assertSemanticText(scene.label, `scene ${sceneIndex + 1} label`);
    if (scene.label.includes("\n")) {
      throw new TypeError(`scene ${sceneIndex + 1} label must occupy one row`);
    }
    if (scene.frames.length === 0) {
      throw new TypeError(`scene ${sceneIndex + 1} needs at least one frame`);
    }
    assertDuration(
      scene.frameMs,
      `scene ${sceneIndex + 1} frameMs`,
      1,
      MAX_FRAME_MS,
    );
    assertDuration(
      scene.finalHoldMs,
      `scene ${sceneIndex + 1} finalHoldMs`,
      0,
      MAX_FINAL_HOLD_MS,
    );

    const viewports = scene.frames.map((frame, frameIndex) => {
      assertSemanticText(
        frame,
        `scene ${sceneIndex + 1} frame ${frameIndex + 1}`,
      );
      const viewport = `${scene.label}\n${frame}`;
      maxWidth = Math.max(maxWidth, viewportWidth(viewport));
      maxHeight = Math.max(maxHeight, viewportHeight(viewport));
      return viewport;
    });
    planned.push(Object.freeze({
      viewports: Object.freeze(viewports),
      frameMs: scene.frameMs,
      finalHoldMs: scene.finalHoldMs,
    }));
  }

  if (
    !hasPlaybackRoom(
      {
        columns: options.terminalColumns,
        rows: options.terminalRows,
      },
      maxWidth,
      maxHeight,
    )
  ) {
    return null;
  }

  return Object.freeze({
    scenes: Object.freeze(planned),
    finalTranscript: options.finalTranscript,
    maxWidth,
    maxHeight,
  });
}

/** Require one spare column and row so wrapping or scrolling cannot skew redraws. */
function hasPlaybackRoom(
  size: TerminalSize,
  maxWidth: number,
  maxHeight: number,
): boolean {
  return Number.isInteger(size.columns) && size.columns > maxWidth &&
    Number.isInteger(size.rows) && size.rows > maxHeight;
}

/** Turn an aborted signal into a stable Error even when its reason is absent. */
function abortFailure(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Terminal playback was interrupted", "AbortError");
}

/** Throw a captured non-Error value through a stable Error boundary. */
function throwCaptured(failure: CapturedFailure): never {
  if (failure.error instanceof Error) {
    throw failure.error;
  }
  throw new Error("Terminal playback failed", { cause: failure.error });
}

/** Re-check live dimensions immediately before cursor-up redraws. */
function playbackStillFits(
  plan: TerminalPlaybackPlan,
  port: TerminalPlaybackPort,
): boolean {
  try {
    return hasPlaybackRoom(
      port.terminalSize(),
      plan.maxWidth,
      plan.maxHeight,
    );
  } catch {
    // discern-best-effort: terminal-playback-fit-fallback
    return false;
  }
}

/** Print the stable transcript below the current package-owned inline frame. */
function settleBelowViewport(
  plan: TerminalPlaybackPlan,
  port: TerminalPlaybackPort,
  painter: InlineFramePainter,
  paint: (effect: () => void) => void,
): void {
  paint(() => painter.finish());
  port.write(`${plan.finalTranscript}\n`);
}

/**
 * Apply a validated playback plan sequentially, then replace its live viewport
 * with the final static transcript. The player first reserves a fresh row and
 * never changes persistent cursor modes, so an uncatchable signal cannot leave
 * the terminal altered. A resize settles below the live viewport rather than
 * trusting stale row counts; abort and write failures clear only while the
 * measured viewport still fits.
 */
export async function applyTerminalPlayback(
  plan: TerminalPlaybackPlan,
  port: TerminalPlaybackPort,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw abortFailure(signal);
  }

  const painter = createInlineFramePainter({
    write: port.write,
    size: port.terminalSize,
    capabilities: () => {
      const size = port.terminalSize();
      const capabilities = port.terminalCapabilities?.() ?? {
        ansiControl: true,
        colorDepth: "none" as const,
        columns: size.columns,
        unicode: true,
      };
      return terminalCapabilitiesAtWidth(capabilities, size.columns);
    },
  });
  let failure: CapturedFailure | undefined;
  let painterWriteFailed = false;
  let settled = false;
  const paint = <T>(effect: () => T): T => {
    try {
      return effect();
    } catch (error) {
      // The package emits a replacement prefix and frame as one write. Once a
      // write fails, its physical cursor position is unknowable; never attempt
      // a second cursor-up cleanup that could move above the reserved region.
      painterWriteFailed = true;
      throw error;
    }
  };
  try {
    port.write("\n");
    scenes: for (const scene of plan.scenes) {
      for (const [frameIndex, viewport] of scene.viewports.entries()) {
        if (signal.aborted) {
          throw abortFailure(signal);
        }
        if (!playbackStillFits(plan, port)) {
          settleBelowViewport(plan, port, painter, paint);
          settled = true;
          break scenes;
        }
        const result = paint(() => painter.replace(viewport));
        if (result.status === "refused") {
          settleBelowViewport(plan, port, painter, paint);
          settled = true;
          break scenes;
        }
        if (frameIndex < scene.viewports.length - 1) {
          await port.wait(scene.frameMs, signal);
        }
      }
      if (scene.finalHoldMs > 0) {
        await port.wait(scene.finalHoldMs, signal);
        if (signal.aborted) {
          throw abortFailure(signal);
        }
      }
    }
    if (!settled) {
      if (!playbackStillFits(plan, port)) {
        settleBelowViewport(plan, port, painter, paint);
        settled = true;
      } else {
        paint(() => painter.clear());
      }
    }
    if (!settled) {
      port.write(`${plan.finalTranscript}\n`);
    }
  } catch (error) {
    failure = { error };
    if (
      !painterWriteFailed && painter.currentFrame !== "" &&
      playbackStillFits(plan, port)
    ) {
      bestEffortSync("terminal-playback-failure-clear", () => {
        painter.clear();
      });
    }
  }

  if (failure !== undefined) {
    throwCaptured(failure);
  }
}
