/**
 * Colour-aware, TTY-aware logging for the installer.
 *
 * A single `Logger` instance holds the run's presentation mode (package terminal
 * context plus JSON mode) so every command emits consistently. The process
 * adapter has already resolved `--no-color`, NO_COLOR, TERM, locale, dimensions,
 * and terminal attachment before Logger chooses semantic Token roles.
 */

import {
  assertHumanOutputGroupId,
  assertHumanOutputGroupLabel,
  type DiscernResult,
  type RenderSink,
} from "../shared/result.ts";
import { emitResult } from "../shared/emit.ts";
import { observeResult } from "../shared/result_capture.ts";
import type { EnvReader } from "../shared/env.ts";
import {
  productionTerminalContext,
  type TerminalContext,
  terminalContext,
  terminalContextWithColor,
} from "./terminal.ts";

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
  /** Explicit package presentation facts for deterministic tests/callers. */
  terminal?: TerminalContext;
}

/** Resolve whether colour should be used for this run. */
export function colourEnabled(
  noColor: boolean,
  env: EnvReader = Deno.env,
): boolean {
  return productionTerminalContext({ noColor, env }).color;
}

/** A presentation-aware logger shared across a command invocation. */
export class Logger {
  readonly json: boolean;
  /** Package presentation facts shared with composed human renderers. */
  readonly terminal: TerminalContext;
  /**
   * Which stream human (non-JSON) narration (info/ok/heading/detail) goes to:
   * `"stdout"` for an interactive verb, `"stderr"` when the parent reserves its
   * stdout for a machine result (the `worktree create` hook returns the worktree
   * path there). Project-supplied commands route independently of this — they are
   * captured and surfaced only on failure (`engine/worktree/shell.ts`), so a chatty
   * command never lands on either narration channel regardless of this setting.
   */
  readonly humanStream: "stdout" | "stderr";
  private wroteHuman = false;
  private atGroupBoundary = false;

  /** Build a logger from the resolved run options. */
  constructor(options: LogOptions) {
    this.json = options.json;
    const terminal = options.terminal ?? terminalContext();
    this.terminal = options.noColor
      ? terminalContextWithColor(terminal, false)
      : terminal;
    this.humanStream = options.humanStream ?? "stderr";
  }

  /** Write a human line to the configured stream (stderr by default). */
  private writeHuman(line: string): void {
    if (this.humanStream === "stdout") {
      console.log(line);
    } else {
      console.error(line);
    }
    this.wroteHuman = true;
    this.atGroupBoundary = line === "" || line.endsWith("\n\n");
  }

  /** Informational step (accent arrow). Suppressed in JSON mode. */
  info(message: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`${this.terminal.tone("→", "accent")} ${message}`);
  }

  /** Success line (semantic success check). Suppressed in JSON mode. */
  ok(message: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`${this.terminal.tone("✓", "success")} ${message}`);
  }

  /** Non-fatal warning (semantic warning bang) to stderr. */
  warn(message: string): void {
    if (this.json) {
      return;
    }
    console.error(`${this.terminal.tone("!", "warning")} ${message}`);
    this.wroteHuman = true;
    this.atGroupBoundary = false;
  }

  /** Error line (semantic danger cross) to stderr. Does not exit. */
  error(message: string): void {
    if (this.json) {
      return;
    }
    console.error(`${this.terminal.tone("✗", "danger")} ${message}`);
    this.wroteHuman = true;
    this.atGroupBoundary = false;
  }

  /** A bold section banner. Suppressed in JSON mode. */
  heading(text: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`\n${this.terminal.role(text, "strong")}`);
  }

  /** Start a semantic group and optionally give it a visible ruled label. */
  group(id: string, label?: string): void {
    assertHumanOutputGroupId(id);
    if (label !== undefined) assertHumanOutputGroupLabel(id, label);
    if (this.json) return;
    if (this.wroteHuman && !this.atGroupBoundary) {
      this.writeHuman("");
    }
    if (label !== undefined) {
      this.writeHuman(
        `  ${this.terminal.role("──", "muted")} ${
          this.terminal.role(label, "strong")
        }`,
      );
    }
  }

  /** A dimmed detail line, indented under a heading. Suppressed in JSON mode. */
  detail(text: string): void {
    if (this.json) {
      return;
    }
    this.writeHuman(`  ${this.terminal.role(text, "muted")}`);
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
  line(text: string): void {
    if (this.json) {
      return;
    }
    console.log(text);
    this.wroteHuman = true;
    this.atGroupBoundary = text === "" || text.endsWith("\n\n");
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

  /**
   * Emit a pre-composed line to the human (narration) stream verbatim — the
   * fully-controlled counterpart to {@link detail}, which forces its own indent and
   * dim. A caller that composes package Token roles and owns its wrapping or
   * indentation uses this. Follows `humanStream` (stderr for the installer) and
   * is suppressed in JSON mode, like the rest of the narration.
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
    dim: (t: string): string => log.terminal.role(t, "muted"),
  };
}
