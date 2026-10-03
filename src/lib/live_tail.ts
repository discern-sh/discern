/**
 * What a repainting terminal view keeps of streamed output.
 *
 * A package view that repaints lays out every line it holds again on each
 * frame, and the work that wrote a line chose its length. A view therefore
 * receives only the part of each streamed line it can show. The Gate's live
 * activity log bounds each child line with `liveTailText`. Output captured
 * beside a live screen arrives as `StreamedOutput`, whose text only this
 * module reads: a view through the live tail, a test through
 * `wholeStreamedOutput`. The record that holds a `StreamedOutput`, or a job's
 * output artifact, keeps every line whole.
 */

import { stripAnsi } from "./text.ts";

/**
 * Which part of a streamed line a view keeps. A committed `line` keeps its
 * end: the rows a tail anchored at its last rows shows, and the words a
 * summary of how work ended reads. A `partial` line, still being written,
 * shows the start of its last carriage-return segment, so it keeps that
 * start. A `scrolled` line, in a reader that scrolls to every row it keeps,
 * keeps its start and its end: an error usually names itself first.
 */
export type LiveTailKind = "line" | "partial" | "scrolled";

/** The share of a scrolled line's room its start keeps; its end keeps the rest. */
const SCROLLED_START_SHARE = 0.6;

/**
 * How a view's rows hold the lines it keeps. A view anchored at its last rows
 * clips the rows above them, so it keeps enough of a line to `fill` its rows.
 * A view that lays out every row it keeps, such as a summary or a reader that
 * scrolls, keeps no more of a line than will `fit` them.
 */
export type LiveTailSizing = "fill" | "fit";

/**
 * Code units of one streamed line a view keeps. To fill `rows` at `columns`,
 * it keeps one row more than it shows, at two code units per cell, so wide
 * and astral characters still fill them. To fit them, it keeps one code unit
 * per cell, so a line of narrow characters fills them exactly.
 */
export function liveTailLimit(
  sizing: LiveTailSizing,
  columns: number,
  rows: number,
): number {
  return sizing === "fill" ? columns * (rows + 1) * 2 : columns * rows;
}

/**
 * The part of one streamed line a view can show, as its kind keeps it: at
 * most `limit` code units, the ellipsis that marks a cut included. A line is
 * measured without the escape sequences no view shows, so styling neither
 * spends the limit nor leaves a fragment at a cut, and a cut falls only
 * between graphemes.
 */
export function liveTailText(
  kind: LiveTailKind,
  text: string,
  limit: number,
  ellipsis: string,
): string {
  if (text.length <= limit) return text;
  const shown = plainText(text);
  if (shown.length <= limit) return shown;
  const room = Math.max(0, limit - ellipsis.length);
  if (kind === "line") {
    return `${ellipsis}${shown.slice(graphemeEnd(shown, shown.length - room))}`;
  }
  if (kind === "scrolled") {
    const start = Math.floor(room * SCROLLED_START_SHARE);
    return `${shown.slice(0, graphemeStart(shown, start))}${ellipsis}${
      shown.slice(graphemeEnd(shown, shown.length - (room - start)))
    }`;
  }
  const end = shown.endsWith("\r") ? shown.length - 1 : shown.length;
  const start = shown.lastIndexOf("\r", end - 1) + 1;
  if (end - start <= limit) return shown.slice(start, end);
  return `${shown.slice(start, graphemeStart(shown, start + room))}${ellipsis}`;
}

const ESCAPE = "\u001b";

/**
 * The escapes the package's streamed-text display drops besides control
 * sequences and operating system commands: a character set designation and
 * a single-character escape.
 */
const SHORT_ESCAPE = new RegExp(`${ESCAPE}(?:[()][ -~]|[ -~]?)`, "gu");

/** Text without the escape sequences no view shows. */
function plainText(text: string): string {
  return text.includes(ESCAPE)
    ? stripAnsi(text).replaceAll(SHORT_ESCAPE, "")
    : text;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Whether a code unit is a printable ASCII character. */
function printableAscii(unit: number): boolean {
  return unit >= 0x20 && unit <= 0x7e;
}

/**
 * The grapheme that `index` falls inside, or `undefined` when one starts
 * there. Two printable ASCII characters always have a boundary between them,
 * so only text beside anything else asks the segmenter.
 */
function straddled(
  text: string,
  index: number,
): { readonly start: number; readonly end: number } | undefined {
  if (
    index <= 0 || index >= text.length ||
    (printableAscii(text.charCodeAt(index - 1)) &&
      printableAscii(text.charCodeAt(index)))
  ) return undefined;
  const grapheme = GRAPHEMES.segment(text).containing(index);
  return grapheme === undefined || grapheme.index === index ? undefined : {
    start: grapheme.index,
    end: grapheme.index + grapheme.segment.length,
  };
}

/** `index`, or the start of the grapheme it falls inside. */
function graphemeStart(text: string, index: number): number {
  return straddled(text, index)?.start ?? index;
}

/** `index`, or the end of the grapheme it falls inside. */
function graphemeEnd(text: string, index: number): number {
  return straddled(text, index)?.end ?? index;
}

const TEXT: unique symbol = Symbol("streamed output text");

/**
 * Text that work wrote while it ran, kept whole. Its lines are as long as the
 * work chose, so a view reads it only through `liveTailOutput` or
 * `liveTailOutputLines`; nothing else can read its text.
 */
export interface StreamedOutput {
  readonly [TEXT]: string;
}

/** Wrap text as it was written. */
export function streamedOutput(text: string): StreamedOutput {
  return Object.freeze({ [TEXT]: text });
}

/** Output from work that has written nothing yet. */
export const NO_STREAMED_OUTPUT: StreamedOutput = streamedOutput("");

/**
 * Add what work wrote next and keep the last `lines` lines, without terminal
 * styling: a view shows the text plain.
 */
export function appendStreamedOutput(
  output: StreamedOutput,
  more: StreamedOutput,
  lines: number,
): StreamedOutput {
  const text = `${output[TEXT]}${plainText(more[TEXT])}`;
  const kept = text.split("\n");
  return streamedOutput(
    kept.length <= lines ? text : kept.slice(-lines).join("\n"),
  );
}

/** Whether the output holds only whitespace. */
export function streamedOutputIsBlank(output: StreamedOutput): boolean {
  return output[TEXT].trim() === "";
}

/**
 * Every line of the output, for a reader that scrolls to every row it keeps:
 * a long line keeps its start and its end.
 */
export function liveTailOutput(
  output: StreamedOutput,
  limit: number,
  ellipsis: string,
): string {
  return output[TEXT].split("\n").map((line) =>
    liveTailText("scrolled", line, limit, ellipsis)
  ).join("\n");
}

/**
 * The last `count` lines that carry text, trailing whitespace removed, each
 * bounded as a committed line. Lines are read from the end, so the rest of
 * the output is never split.
 */
export function liveTailOutputLines(
  output: StreamedOutput,
  count: number,
  limit: number,
  ellipsis: string,
): readonly string[] {
  const text = output[TEXT];
  const lines: string[] = [];
  let end = text.length;
  while (lines.length < count && end > 0) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    const line = text.slice(start, end).trimEnd();
    if (line.trim() !== "") {
      lines.unshift(liveTailText("line", line, limit, ellipsis));
    }
    end = start - 1;
  }
  return lines;
}

/**
 * All of the output's text, for a test that checks what was kept. The
 * terminal live tail guard admits no runtime caller.
 */
export function wholeStreamedOutput(output: StreamedOutput): string {
  return output[TEXT];
}
