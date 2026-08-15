/**
 * The one human narration authority and its boundary-accounting sink.
 *
 * Every small human output verb — an info/success/warning/danger line, a strong
 * heading, a semantic group boundary (ADR 0250) — renders here exactly once.
 * The engine's `Out` and the installer's `Logger` are thin stream
 * configurations of this implementation, so the glyph grammar, the ruled group
 * label, and the blank-line rhythm cannot drift between the two halves of the
 * binary. The sink owns every boundary: a block declares "exactly one blank
 * line before me" and receives it mechanically, so no caller performs newline
 * arithmetic.
 */

import {
  assertHumanOutputGroupId,
  assertHumanOutputGroupLabel,
} from "../shared/result.ts";
import {
  type TerminalContext,
  terminalLine,
  type TerminalMultiline,
} from "./terminal.ts";

/** A physical process stream the sink can write to. */
export type OutputStream = "stdout" | "stderr";

/** Options for one declared semantic boundary. */
export interface BoundaryOptions {
  /** Also separate before the first write — the heading's leading line. */
  readonly evenAtStart?: boolean;
  /** Receive missing blank lines here instead of the last written stream. */
  readonly stream?: OutputStream;
}

/**
 * The single boundary-accounting write sink. It tracks the trailing blank
 * state of everything written through it — across both streams — so a block
 * can declare its separation instead of hand-emitting newlines.
 */
export interface OutputSink {
  /** Write raw text verbatim; newlines inside `text` are the caller's own. */
  write(text: string, stream: OutputStream): void;
  /** Write one complete line (`text` plus its line ending). */
  line(text: string, stream: OutputStream): void;
  /** Ensure exactly one blank line stands between prior output and what follows. */
  boundary(options?: BoundaryOptions): void;
  /** The stream that received the most recent write. */
  lastStream(): OutputStream;
  /** Whether anything has been written through this sink. */
  wrote(): boolean;
}

/**
 * How the sink reaches its process streams. Raw writers receive exact text
 * including line endings (the engine's byte writers); line writers receive one
 * line without its ending and append it themselves (the installer's console
 * writers, which test spies intercept). A line-oriented sink cannot carry raw
 * partial-line text — `write` is reserved for raw-writer sinks.
 */
export type SinkWriters =
  | {
    readonly kind: "raw";
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  }
  | {
    readonly kind: "line";
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  };

/** Build the boundary-accounting sink over one pair of stream writers. */
export function makeOutputSink(writers: SinkWriters): OutputSink {
  let wroteAny = false;
  // Trailing newline count of everything emitted so far, capped at the two that
  // make one complete blank-line boundary.
  let trailing = 0;
  let last: OutputStream = "stdout";

  const account = (physical: string, stream: OutputStream): void => {
    wroteAny = true;
    last = stream;
    const suffix = physical.match(/\n+$/)?.[0] ?? "";
    trailing = suffix.length === physical.length
      ? Math.min(2, trailing + suffix.length)
      : Math.min(2, suffix.length);
  };

  const sink: OutputSink = {
    write(text: string, stream: OutputStream): void {
      if (text === "") return;
      if (writers.kind === "line") {
        throw new TypeError(
          "this output sink is line-oriented; write complete lines through line()",
        );
      }
      writers[stream](text);
      account(text, stream);
    },
    line(text: string, stream: OutputStream): void {
      if (writers.kind === "raw") {
        writers[stream](`${text}\n`);
      } else {
        writers[stream](text);
      }
      account(`${text}\n`, stream);
    },
    boundary(options: BoundaryOptions = {}): void {
      const target = options.stream ?? last;
      if (!wroteAny) {
        if (options.evenAtStart === true) sink.line("", target);
        return;
      }
      while (trailing < 2) sink.line("", target);
    },
    lastStream: (): OutputStream => last,
    wrote: (): boolean => wroteAny,
  };
  return sink;
}

/** A sink that swallows everything — quiet and `--json` modes, where the result
 * envelope is the entire program output (ADR 0030). */
export function silentOutputSink(): OutputSink {
  return {
    write: (): void => {},
    line: (): void => {},
    boundary: (): void => {},
    lastStream: (): OutputStream => "stdout",
    wrote: (): boolean => false,
  };
}

/** Which stream each narration channel reaches — the sink configuration that
 * distinguishes the engine (narration on stdout) from the installer (narration
 * on stderr, keeping stdout for structured results and content). */
export interface NarrationStreams {
  /** info/ok/heading/detail and verbatim narration lines. */
  readonly narration: OutputStream;
  /** warn/error danger lines. */
  readonly alerts: OutputStream;
}

/** The shared narration surface both `Out` and `Logger` configure. */
export interface Narration {
  /** Informational step (accent arrow). */
  info(message: string): void;
  /** Success line (semantic success check). */
  ok(message: string): void;
  /** Non-fatal warning (semantic warning bang) on the alert stream. */
  warn(message: string): void;
  /** Failure line (semantic danger cross) on the alert stream; never exits. */
  error(message: string): void;
  /** A strong section banner owning one leading blank line. */
  heading(text: string): void;
  /** Start a semantic group and optionally give it a visible ruled label. */
  group(id: string, label?: string): void;
  /** A dimmed, indented detail line under a heading. */
  detail(text: string): void;
  /** A pre-composed narration line emitted verbatim — the caller owns its
   * wrapping, indentation, and any package Token roles. */
  humanLine(text: string): void;
  /** Emit branded terminal-safe multiline text as one semantic error block. */
  terminalSafeMultilineError(message: TerminalMultiline): void;
}

/** Build the one narration implementation over a sink and stream policy. */
export function makeNarration(
  sink: OutputSink,
  terminal: TerminalContext,
  streams: NarrationStreams,
): Narration {
  return {
    info: (message: string): void =>
      sink.line(
        terminal.presenter.note(terminalLine(message)),
        streams.narration,
      ),
    ok: (message: string): void =>
      sink.line(
        terminal.presenter.success(terminalLine(message)),
        streams.narration,
      ),
    warn: (message: string): void =>
      sink.line(
        terminal.presenter.warning(terminalLine(message)),
        streams.alerts,
      ),
    error: (message: string): void =>
      sink.line(
        terminal.presenter.failure(terminalLine(message)),
        streams.alerts,
      ),
    heading: (text: string): void => {
      sink.boundary({ evenAtStart: true, stream: streams.narration });
      sink.line(
        terminal.presenter.style(terminalLine(text), { role: "strong" }),
        streams.narration,
      );
    },
    group: (id: string, label?: string): void => {
      assertHumanOutputGroupId(id);
      if (label !== undefined) assertHumanOutputGroupLabel(id, label);
      sink.boundary();
      if (label !== undefined) {
        sink.line(
          `  ${terminal.presenter.style("──", { role: "muted" })} ${
            terminal.presenter.style(terminalLine(label), { role: "strong" })
          }`,
          sink.lastStream(),
        );
      }
    },
    detail: (text: string): void =>
      sink.line(
        `  ${terminal.presenter.style(terminalLine(text), { role: "muted" })}`,
        streams.narration,
      ),
    humanLine: (text: string): void => sink.line(text, streams.narration),
    terminalSafeMultilineError: (message: TerminalMultiline): void => {
      const [first = "", ...continuation] = message.split("\n");
      const failure = terminal.presenter.failure(first);
      sink.line([failure, ...continuation].join("\n"), streams.alerts);
    },
  };
}

/**
 * The one human failure form: a danger line stating the condition, then one
 * recovery group carrying the next step. A failure whose message already names
 * its next step stays a single `error` line; a distinct actionable step —
 * a command to run, a canonical suggestion — gets the recovery group.
 */
export function reportFailure(
  narration: Pick<Narration, "error" | "group" | "humanLine">,
  condition: string,
  recovery: readonly string[] = [],
): void {
  narration.error(condition);
  if (recovery.length === 0) return;
  narration.group("failure-recovery");
  for (const step of recovery) {
    narration.humanLine(`  ${terminalLine(step)}`);
  }
}
