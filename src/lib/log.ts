/**
 * Colour-aware, TTY-aware logging for the installer.
 *
 * Mirrors the harness's own output convention: a single `Logger` instance holds
 * the run's presentation mode (colour on/off, JSON mode) so every command emits
 * consistently. Colour is suppressed when `--no-color` is passed, when `NO_COLOR`
 * is set, or when stdout is not a TTY — matching the engine's `output.sh`.
 */

import { colors } from "@cliffy/ansi/colors";
import type { RenderSink } from "../shared/result.ts";

/** How a command should present its results. */
export interface LogOptions {
  /** Emit machine-readable JSON instead of human text. */
  json: boolean;
  /** Force colour off regardless of TTY (set by --no-color / NO_COLOR). */
  noColor: boolean;
  /**
   * Which stream info/ok/heading/detail go to. "stderr" (the default) suits the
   * installer (machine JSON on stdout); the engine recipes pass "stdout" to match
   * the shell `output.sh` (info/ok/heading → stdout, warn/error → stderr).
   */
  humanStream?: "stdout" | "stderr";
}

/** Resolve whether colour should be used for this run. */
export function colourEnabled(noColor: boolean): boolean {
  if (noColor) {
    return false;
  }
  if (
    Deno.env.get("NO_COLOR") !== undefined && Deno.env.get("NO_COLOR") !== ""
  ) {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** A presentation-aware logger shared across a command invocation. */
export class Logger {
  readonly json: boolean;
  private readonly colour: boolean;
  private readonly humanStream: "stdout" | "stderr";

  /** Build a logger from the resolved run options. */
  constructor(options: LogOptions) {
    this.json = options.json;
    this.colour = colourEnabled(options.noColor);
    this.humanStream = options.humanStream ?? "stderr";
  }

  /** Write a human line to the configured stream (stderr by default). */
  private writeHuman(line: string): void {
    if (this.humanStream === "stdout") {
      console.log(line);
    } else {
      console.error(line);
    }
  }

  /** Apply a colour transform only when colour is enabled. */
  private paint(fn: (s: string) => string, text: string): string {
    return this.colour ? fn(text) : text;
  }

  /** Informational step (cyan arrow). Suppressed in JSON mode. */
  info(message: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`${this.paint(colors.cyan, "→")} ${message}`);
  }

  /** Success line (green check). Suppressed in JSON mode. */
  ok(message: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`${this.paint(colors.green, "✓")} ${message}`);
  }

  /** Non-fatal warning (yellow bang) to stderr. Suppressed in JSON mode. */
  warn(message: string): void {
    if (this.json) {
      return;
    }
    console.error(`${this.paint(colors.yellow, "!")} ${message}`);
  }

  /** Error line (red cross) to stderr. Does not exit. Suppressed in JSON mode. */
  error(message: string): void {
    if (this.json) {
      return;
    }
    console.error(`${this.paint(colors.red, "✗")} ${message}`);
  }

  /** A bold section banner. Suppressed in JSON mode. */
  heading(text: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`\n${this.paint(colors.bold, text)}`);
  }

  /** A dimmed detail line, indented under a heading. Suppressed in JSON mode. */
  detail(text: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`  ${this.paint(colors.dim, text)}`);
  }

  /** Plain line to stdout (the user-facing channel for human output). */
  line(text = ""): void {
    if (this.json) {
      return;
    }
    console.log(text);
  }

  /** Emit a final JSON payload to stdout. Only does anything in JSON mode. */
  jsonResult(payload: unknown): void {
    if (!this.json) {
      return;
    }
    console.log(JSON.stringify(payload, null, 2));
  }

  /** Bold a fragment of text inline (no-op without colour). */
  bold(text: string): string {
    return this.paint(colors.bold, text);
  }

  /** Dim a fragment of text inline (no-op without colour). */
  dim(text: string): string {
    return this.paint(colors.dim, text);
  }
}

/** Adapt the installer's `Logger` to a {@link RenderSink} for the shared plan renderer. */
export function loggerSink(log: Logger): RenderSink {
  return {
    heading: (t: string): void => log.heading(t),
    line: (t: string): void => log.line(t),
    dim: (t: string): string => log.dim(t),
  };
}
