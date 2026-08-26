/**
 * Colour-aware, TTY-aware logging for the installer.
 *
 * A single `Logger` instance holds the run's presentation mode (package terminal
 * context plus JSON mode) so every command emits consistently. The process
 * adapter has already resolved `--no-color`, NO_COLOR, TERM, locale, dimensions,
 * and terminal attachment before Logger chooses semantic Token roles. The
 * rendering itself — glyphs, ruled group labels, blank-line boundaries — lives
 * in the shared narration authority (`./narration.ts`); Logger is its
 * installer-stream configuration plus the quiet-result channel.
 */

import type { DiscernResult, RenderSink } from "../shared/result.ts";
import { emitResult } from "../shared/emit.ts";
import { observeResult } from "../shared/result_capture.ts";
import {
  makeNarration,
  makeOutputSink,
  type Narration,
  type OutputSink,
  reportFailure,
  silentOutputSink,
} from "./narration.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalContextWithColor,
  terminalLine,
  type TerminalMultiline,
} from "./terminal.ts";

/** How a command should present its results. */
export interface LogOptions {
  /** Suppress terminal narration for an explicit result format. */
  json: boolean;
  /** Force colour off regardless of TTY (set by --no-color / NO_COLOR). */
  noColor: boolean;
  /**
   * Which stream info/ok/heading/detail go to. "stderr" (the default) suits the
   * installer (the selected result stays on stdout); the engine passes "stdout" (info/ok/
   * heading → stdout, warn/error → stderr).
   */
  humanStream?: "stdout" | "stderr";
  /** Explicit package presentation facts for deterministic tests/callers. */
  terminal?: TerminalContext;
}

/** A presentation-aware logger shared across a command invocation. */
export class Logger {
  readonly json: boolean;
  /** Package presentation facts shared with composed human renderers. */
  readonly terminal: TerminalContext;
  /**
   * Which stream human (non-JSON) narration (info/ok/heading/detail) goes to:
   * `"stdout"` for an interactive verb, `"stderr"` when the parent reserves its
   * stdout for a structured result (the `worktree create` hook returns the worktree
   * path there). Project-supplied commands route independently of this — they are
   * captured and surfaced only on failure (`engine/worktree/shell.ts`), so a chatty
   * command never lands on either narration channel regardless of this setting.
   */
  readonly humanStream: "stdout" | "stderr";
  readonly #sink: OutputSink;
  readonly #narration: Narration;
  /** Emit branded terminal-safe multiline text as one semantic error block.
   * Bound from the shared narration authority, whose signature requires the
   * `TerminalMultiline` brand. Suppressed in JSON mode. */
  readonly terminalSafeMultilineError: (message: TerminalMultiline) => void;

  /** Build a logger from the resolved run options. */
  constructor(options: LogOptions) {
    this.json = options.json;
    const terminal = options.terminal ?? terminalContext();
    this.terminal = options.noColor
      ? terminalContextWithColor(terminal, false)
      : terminal;
    this.humanStream = options.humanStream ?? "stderr";
    // The shared narration authority renders every terminal line; quiet result
    // mode gets the silent sink so one selected result stays the entire output.
    this.#sink = this.json ? silentOutputSink() : makeOutputSink({
      kind: "line",
      stdout: (line: string): void => console.log(line),
      stderr: (line: string): void => console.error(line),
    });
    this.#narration = makeNarration(this.#sink, this.terminal, {
      narration: this.humanStream,
      alerts: "stderr",
    });
    this.terminalSafeMultilineError =
      this.#narration.terminalSafeMultilineError;
  }

  /** Informational step (accent arrow). Suppressed in JSON mode. */
  info(message: string): void {
    this.#narration.info(message);
  }

  /** Success line (semantic success check). Suppressed in JSON mode. */
  ok(message: string): void {
    this.#narration.ok(message);
  }

  /** Non-fatal warning (semantic warning bang) to stderr. */
  warn(message: string): void {
    this.#narration.warn(message);
  }

  /** Error line (semantic danger cross) to stderr. Does not exit. */
  error(message: string): void {
    this.#narration.error(message);
  }

  /** A product-composed failure whose authored newlines are real structure. */
  errorBlock(message: string): void {
    this.#narration.errorBlock(message);
  }

  /** Emit the shared terminal failure form: condition, then recovery actions. */
  failure(message: string, recovery: readonly string[] = []): void {
    reportFailure(this.#narration, message, recovery);
  }

  /** A bold section banner owning one leading blank line. Suppressed in JSON
   * mode. */
  heading(text: string): void {
    this.#narration.heading(text);
  }

  /** Start a semantic group and optionally give it a visible ruled label. */
  group(id: string, label?: string): void {
    this.#narration.group(id, label);
  }

  /** A dimmed detail line, indented under a heading. Suppressed in JSON mode. */
  detail(text: string): void {
    this.#narration.detail(text);
  }

  /**
   * A plain content line on STDOUT — always, independent of `humanStream`. This is
   * deliberately the logger's CONTENT/result channel (a plan row, a `config` edit
   * echo), kept separate from the NARRATION channel ({@link info}/{@link ok}/
   * {@link heading}/{@link detail}, which follow `humanStream`). The split is
   * load-bearing: `renderPlan` (shared/result.ts) routes its heading to the
   * narration stream but each plan row through here, so the rows stay
   * capturable/greppable even when narration is sent to stderr (see the renderPlan
   * test). Single shell-facing values (`config get`) bypass the logger through
   * the engine's raw stdout adapter. Suppressed in JSON mode.
   *
   * Corollary for a caller that reserves stdout for its OWN structured result — the
   * `worktree create` hook returns the worktree path there: it must NOT narrate via
   * `line()` on that path. It routes its setup commands' output to stderr (see
   * `engine/worktree/shell.ts`) and the hook test asserts stdout stays the path.
   */
  line(text: string): void {
    this.#sink.line(text, "stdout");
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

  /**
   * Emit a pre-composed line to the human (narration) stream verbatim — the
   * fully-controlled counterpart to {@link detail}, which forces its own indent and
   * dim. A caller that composes package Token roles and owns its wrapping or
   * indentation uses this. Follows `humanStream` (stderr for the installer) and
   * is suppressed in JSON mode, like the rest of the narration.
   */
  humanLine(text: string): void {
    this.#narration.humanLine(text);
  }
}

/** Adapt the installer's `Logger` to a {@link RenderSink} for the shared plan renderer. */
export function loggerSink(log: Logger): RenderSink {
  return {
    heading: (t: string): void => log.heading(t),
    line: (t: string): void => log.line(t),
    safeLine: (t: string): string => terminalLine(t),
    dim: (t: string): string => log.terminal.role(terminalLine(t), "muted"),
  };
}
