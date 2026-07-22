/**
 * Colour-aware, TTY-aware logging for the installer.
 *
 * Mirrors discern's output convention: a single `Logger` instance holds
 * the run's presentation mode (colour on/off, JSON mode) so every command emits
 * consistently. Colour is suppressed when `--no-color` is passed, when `NO_COLOR`
 * is set, or when stdout is not a TTY — matching the engine's `output.sh`.
 */

import { colors } from "@cliffy/ansi/colors";
import type { DiscernResult, RenderSink } from "../shared/result.ts";
import { emitResult } from "../shared/emit.ts";
import { observeResult } from "../shared/result_capture.ts";
import type { EnvReader } from "../shared/env.ts";

/** How a command should present its results. */
export interface LogOptions {
  /** Emit machine-readable JSON instead of human text. */
  json: boolean;
  /** Force colour off regardless of TTY (set by --no-color / NO_COLOR). */
  noColor: boolean;
  /**
   * Which stream info/ok/heading/detail go to. "stderr" (the default) suits the
   * installer (machine JSON on stdout); the engine passes "stdout" (info/ok/
   * heading → stdout, warn/error → stderr).
   */
  humanStream?: "stdout" | "stderr";
}

/** Resolve whether colour should be used for this run. */
export function colourEnabled(
  noColor: boolean,
  env: EnvReader = Deno.env,
): boolean {
  if (noColor) {
    return false;
  }
  if (
    env.get("NO_COLOR") !== undefined && env.get("NO_COLOR") !== ""
  ) {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** A presentation-aware logger shared across a command invocation. */
export class Logger {
  readonly json: boolean;
  private readonly colour: boolean;
  /**
   * Which stream human (non-JSON) narration (info/ok/heading/detail) goes to:
   * `"stdout"` for an interactive verb, `"stderr"` when the parent reserves its
   * stdout for a machine result (the `worktree create` hook returns the worktree
   * path there). Project-supplied commands route independently of this — they are
   * captured and surfaced only on failure (`engine/worktree/shell.ts`), so a chatty
   * command never lands on either narration channel regardless of this setting.
   */
  readonly humanStream: "stdout" | "stderr";

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

  /**
   * A plain content line on STDOUT — always, independent of `humanStream`. This is
   * deliberately the logger's CONTENT/result channel (a plan row, a `config` edit
   * echo), kept separate from the NARRATION channel ({@link info}/{@link ok}/
   * {@link heading}/{@link detail}, which follow `humanStream`). The split is
   * load-bearing: `renderPlan` (shared/result.ts) routes its heading to the
   * narration stream but each plan row through here, so the rows stay
   * capturable/greppable even when narration is sent to stderr (see the renderPlan
   * test). Single capturable values (`config get`) bypass the logger with a direct
   * `console.log`. Suppressed in JSON mode.
   *
   * Corollary for a caller that reserves stdout for its OWN machine result — the
   * `worktree create` hook returns the worktree path there: it must NOT narrate via
   * `line()` on that path. It routes its setup commands' output to stderr (see
   * `engine/worktree/shell.ts`) and the hook test asserts stdout stays the path.
   */
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

  /**
   * Emit a {@link DiscernResult} as the verb's single `--json` object — the
   * envelope every verb shares (ADR 0028). Only does anything in JSON mode; the
   * human path is the verb's own narration. Delegates to the shared
   * {@link emitResult} chokepoint (ADR 0030) so installer and engine verbs print
   * the wire shape through one site.
   */
  result(r: DiscernResult): void {
    observeResult(r);
    if (!this.json) {
      return;
    }
    emitResult(r);
  }

  /** Bold a fragment of text inline (no-op without colour). */
  bold(text: string): string {
    return this.paint(colors.bold, text);
  }

  /** Dim a fragment of text inline (no-op without colour). */
  dim(text: string): string {
    return this.paint(colors.dim, text);
  }

  /** Cyan a fragment of text inline (no-op without colour). */
  cyan(text: string): string {
    return this.paint(colors.cyan, text);
  }

  /** Green a fragment of text inline (no-op without colour). */
  green(text: string): string {
    return this.paint(colors.green, text);
  }

  /**
   * Emit a pre-composed line to the human (narration) stream verbatim — the
   * fully-controlled counterpart to {@link detail}, which forces its own indent and
   * dim. A caller that builds a line out of inline colour fragments
   * ({@link bold}/{@link dim}/{@link cyan}/…) and owns its own wrapping/indentation
   * uses this. Follows `humanStream` (stderr for the installer) and is suppressed in
   * JSON mode, like the rest of the narration.
   */
  humanLine(text: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(text);
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
