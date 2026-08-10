/** Print or animate the complete discern terminal-art family for visual review. */

import {
  applyTerminalPlayback,
  planTerminalPlayback,
  type TerminalAnimationScene,
  type TerminalPlaybackPlan,
} from "../../src/lib/terminal_playback.ts";
import {
  abortableWait,
  observeTerminalAnimationEnvironment,
  runTerminalPlayback,
  terminalAnimationAllowed,
  type TerminalAnimationEnvironment,
  terminalPlaybackPort,
} from "../../src/lib/terminal_animation.ts";
import { type TerminalSize, terminalSize } from "../../src/lib/text.ts";
import { writeStderr, writeStdout } from "../../src/engine/output.ts";
import { DISCERN_ART_VARIANTS, type DiscernArtVariant } from "./brand.ts";
import { DISCERN_TRIANGLE_MOTIFS } from "./triangle.ts";

const ART_USAGE = "Run `deno task art` or `deno task art --animate`.";

/** The observed terminal policy inputs consumed by the pure command planner. */
export type ArtCommandEnvironment = TerminalAnimationEnvironment;

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

/** One named member of either terminal-art enrolment registry. */
export interface ArtGalleryEntry {
  readonly name: string;
  readonly variant: DiscernArtVariant;
}

const ART_GALLERY_ENTRIES: readonly ArtGalleryEntry[] = Object.freeze([
  ...Object.entries(DISCERN_ART_VARIANTS).map(([name, variant]) =>
    Object.freeze({ name, variant })
  ),
  ...Object.entries(DISCERN_TRIANGLE_MOTIFS).map(([name, variant]) =>
    Object.freeze({ name, variant })
  ),
]);

/** Return the shared ordered projection used by both gallery modes. */
export function artGalleryEntries(): readonly ArtGalleryEntry[] {
  return ART_GALLERY_ENTRIES;
}

/** Render every registered design in stable order with a compact name label. */
export function renderArtGallery(): string {
  return artGalleryEntries()
    .map(({ name, variant }) => `[${name}]\n${variant.render()}`)
    .join("\n\n");
}

/** Derive one labelled semantic animation scene from every registered design. */
export function artAnimationScenes(): readonly TerminalAnimationScene[] {
  return artGalleryEntries().map(({ name, variant }) => {
    const animation = variant.animate();
    return Object.freeze({
      label: `[${name}]`,
      frames: animation.frames,
      frameMs: animation.frameMs,
      finalHoldMs: animation.finalHoldMs,
    });
  });
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
  if (args.length === 0 || !terminalAnimationAllowed(environment)) {
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

/** Plan and run the maintainer gallery against the real terminal boundaries. */
export async function runArtCommand(
  args: readonly string[] = Deno.args,
): Promise<number> {
  const plan = planArtCommand(
    args,
    observeTerminalAnimationEnvironment(),
  );
  if (plan.mode === "animate") {
    await runTerminalPlayback(plan.playback, terminalPlaybackPort(writeStdout));
    return 0;
  }
  return await executeArtCommand(
    plan,
    {
      stdout: writeStdout,
      stderr: writeStderr,
      wait: abortableWait,
      terminalSize,
    },
    new AbortController().signal,
  );
}

if (import.meta.main) {
  Deno.exit(await runArtCommand());
}
