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
import {
  type AlignedRow,
  breakLongTokens,
  displayWidth,
  renderAlignedRows,
  wrapText,
} from "./text.ts";

/** Cells a wrapped item's continuation hangs past its first line, so the
 * continuation never reads as the start of the next item. */
const ITEM_HANG = 2;

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

/**
 * The shared narration surface both `Out` and `Logger` configure. Every verb
 * that renders prose bounds each emitted line to the terminal width through
 * the package renderers; only {@link Narration.humanLine} passes a caller's
 * composition through verbatim.
 */
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
  /** A dimmed detail item indented under a heading. The text's own leading
   * spaces deepen its indent; a wrapped item's continuation lines hang two
   * cells past its first line. */
  detail(text: string): void;
  /** An undimmed item indented under a group — a recovery step, a listed
   * path — laid out exactly as {@link Narration.detail}. */
  item(text: string): void;
  /** Dimmed label + body detail rows aligned through the one column policy;
   * a body too wide for the terminal wraps under the body column. `indent`
   * leads every row, the detail indent by default. */
  detailRows(rows: readonly AlignedRow[], indent?: string): void;
  /** A pre-composed narration line emitted verbatim — the caller owns its
   * wrapping, indentation, and any package Token roles. */
  humanLine(text: string): void;
  /** Emit branded terminal-safe multiline text as one semantic error block. */
  terminalSafeMultilineError(message: TerminalMultiline): void;
  /**
   * One product-composed failure whose message carries authored line
   * structure. Each authored line is made inert individually — a separator
   * inside a line renders as visible notation, never as structure — then
   * wrapped to the terminal width with its leading indentation preserved,
   * and the block leads with the semantic failure glyph. A single-line
   * message reads identically to `error`. The caller vouches that the
   * message's newlines are the product's own composition; captured foreign
   * text (subprocess output, file content) stays on `error`, where every
   * separator is visible.
   */
  errorBlock(message: string): void;
  /**
   * The one human failure form: a danger block stating the condition, then
   * one recovery group carrying each next step as an {@link Narration.item}.
   * A failure whose message already names its next step passes no recovery
   * and stays the danger block alone; a distinct actionable step — a command
   * to run, a canonical suggestion — gets the recovery group.
   */
  failure(condition: string, recovery?: readonly string[]): void;
}

/** Build the one narration implementation over a sink and stream policy. */
export function makeNarration(
  sink: OutputSink,
  terminal: TerminalContext,
  streams: NarrationStreams,
): Narration {
  const columns = terminal.presenter.capabilities.columns;
  const muted = (line: string): string =>
    terminal.presenter.style(line, { role: "muted" });
  const strong = (line: string): string =>
    terminal.presenter.style(line, { role: "strong" });
  const failureLine = (text: string): string =>
    terminal.presenter.failure(text);
  /** Cells a package narration renderer spends on its glyph and gap: its
   * rendering of one cell, less that cell. */
  const glyphColumn = (render: (text: string) => string): number =>
    displayWidth(render("x")) - 1;
  /** Render one inert line through a package narration renderer. Each token
   * wider than the renderer's text column is broken first through the text
   * authority, so package wrapping only ever measures words that fit a line
   * and a long token costs time in proportion to its length. */
  const glyphLine = (
    render: (text: string) => string,
    message: string,
  ): string =>
    render(
      breakLongTokens(terminalLine(message), columns - glyphColumn(render)),
    );
  /** Bound one inert prose line to the presenter's width behind a styled
   * `lead`. The line's own leading spaces deepen the indent, so an indented
   * line keeps its indent whether it fits or wraps. A line that fits is kept
   * intact, interior spacing included; an over-wide one re-flows through the
   * text authority with each continuation `hang` cells deeper, an overlong
   * token breaks rather than overflow, and `paint` styles each wrapped line on
   * its own so no styling crosses a line end. */
  const hanging = (
    lead: string,
    text: string,
    paint: (line: string) => string,
    hang = 0,
  ): string => {
    const leadWidth = displayWidth(lead);
    const room = Math.max(1, columns - leadWidth);
    // However deep the caller indents, at least one content cell remains.
    const leading = (text.match(/^ */u)?.[0] ?? "").slice(0, room - 1);
    const content = text.slice(leading.length);
    const width = room - leading.length;
    const continuation = " ".repeat(Math.min(hang, width - 1));
    const lines = displayWidth(content) <= width
      ? [content]
      : wrapText(content, width, continuation, { breakLongWords: true })
        .map((line, index) =>
          index === 0 ? line : line.slice(continuation.length)
        );
    return lines.map((line, index) =>
      `${index === 0 ? lead : " ".repeat(leadWidth)}${leading}${
        index === 0 ? "" : continuation
      }${paint(line)}`
    ).join("\n");
  };
  const errorBlock = (message: string): void => {
    if (!message.includes("\n")) {
      sink.line(glyphLine(failureLine, message), streams.alerts);
      return;
    }
    // Every wrapped line hangs under the glyph column.
    const glyph = glyphColumn(failureLine);
    const width = columns - glyph;
    const lines = message.split("\n").flatMap((raw) => {
      if (raw.trim() === "") return [""];
      const leading = raw.match(/^\s*/u)?.[0] ?? "";
      const content = terminalLine(raw.slice(leading.length));
      return wrapText(
        content,
        width - leading.length,
        `${leading}${" ".repeat(ITEM_HANG)}`,
        { breakLongWords: true },
      ).map((line, index) => (index === 0 ? `${leading}${line}` : line));
    });
    const [first = "", ...continuation] = lines;
    sink.line(
      [
        failureLine(first),
        ...continuation.map((line) =>
          line === "" ? "" : `${" ".repeat(glyph)}${line}`
        ),
      ].join("\n"),
      streams.alerts,
    );
  };
  /** One indented item on the narration stream; `detail` and `item` differ
   * only in `paint`. */
  const indented = (text: string, paint: (line: string) => string): void =>
    sink.line(
      hanging("  ", terminalLine(text), paint, ITEM_HANG),
      streams.narration,
    );
  const item = (text: string): void => indented(text, (line) => line);
  const group = (id: string, label?: string): void => {
    assertHumanOutputGroupId(id);
    if (label !== undefined) assertHumanOutputGroupLabel(id, label);
    sink.boundary();
    if (label !== undefined) {
      sink.line(
        hanging(`  ${muted("──")} `, terminalLine(label), strong),
        sink.lastStream(),
      );
    }
  };
  return {
    info: (message: string): void =>
      sink.line(
        glyphLine((text) => terminal.presenter.note(text), message),
        streams.narration,
      ),
    ok: (message: string): void =>
      sink.line(
        glyphLine((text) => terminal.presenter.success(text), message),
        streams.narration,
      ),
    warn: (message: string): void =>
      sink.line(
        glyphLine((text) => terminal.presenter.warning(text), message),
        streams.alerts,
      ),
    error: (message: string): void =>
      sink.line(glyphLine(failureLine, message), streams.alerts),
    heading: (text: string): void => {
      sink.boundary({ evenAtStart: true, stream: streams.narration });
      sink.line(hanging("", terminalLine(text), strong), streams.narration);
    },
    group,
    detail: (text: string): void => indented(text, muted),
    item,
    detailRows: (rows: readonly AlignedRow[], indent = "  "): void => {
      for (
        const line of renderAlignedRows(
          rows.map((row) => ({
            label: terminalLine(row.label),
            body: terminalLine(row.body),
          })),
          { indent, width: columns, styleLabel: muted, styleBody: muted },
        )
      ) sink.line(line, streams.narration);
    },
    humanLine: (text: string): void => sink.line(text, streams.narration),
    // Already-inert multiline text renders as the one authored failure block.
    terminalSafeMultilineError: (message: TerminalMultiline): void =>
      errorBlock(message),
    errorBlock,
    failure: (condition: string, recovery: readonly string[] = []): void => {
      errorBlock(condition);
      if (recovery.length === 0) return;
      group("failure-recovery");
      for (const step of recovery) item(step);
    },
  };
}
