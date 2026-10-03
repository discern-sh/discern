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

import { stripAnsi } from "../shared/color_env.ts";

/** A committed line, or the line still being written. */
export type LiveTailKind = "line" | "partial";

/**
 * Code units of one streamed line a view keeps: one row more than it shows at
 * `columns`, at two code units per cell so wide and astral characters still
 * fill it.
 */
export function liveTailLimit(columns: number, tailRows: number): number {
  return columns * (tailRows + 1) * 2;
}

/**
 * The part of one streamed line a view can show. A committed line shows its
 * last wrapped rows, so it keeps its end; an in-progress line shows the start
 * of its last carriage-return segment, so it keeps that start. Each cut is
 * marked with the ellipsis and never splits a surrogate pair.
 */
export function liveTailText(
  kind: LiveTailKind,
  text: string,
  limit: number,
  ellipsis: string,
): string {
  if (text.length <= limit) return text;
  if (kind === "line") {
    const start = text.length - limit;
    return `${ellipsis}${
      text.slice(isLowSurrogate(text, start) ? start + 1 : start)
    }`;
  }
  const end = text.endsWith("\r") ? text.length - 1 : text.length;
  const start = text.lastIndexOf("\r", end - 1) + 1;
  if (end - start <= limit) return text.slice(start, end);
  const stop = start + limit;
  return `${
    text.slice(start, isLowSurrogate(text, stop) ? stop - 1 : stop)
  }${ellipsis}`;
}

/** Whether the code unit at `index` continues a surrogate pair. */
function isLowSurrogate(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
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
  const text = `${output[TEXT]}${stripAnsi(more[TEXT])}`;
  const kept = text.split("\n");
  return streamedOutput(
    kept.length <= lines ? text : kept.slice(-lines).join("\n"),
  );
}

/** Whether the output holds only whitespace. */
export function streamedOutputIsBlank(output: StreamedOutput): boolean {
  return output[TEXT].trim() === "";
}

/** Every line of the output, each bounded as a committed line. */
export function liveTailOutput(
  output: StreamedOutput,
  limit: number,
  ellipsis: string,
): string {
  return output[TEXT].split("\n").map((line) =>
    liveTailText("line", line, limit, ellipsis)
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

/** All of the output's text, for a test that checks what was kept. */
export function wholeStreamedOutput(output: StreamedOutput): string {
  return output[TEXT];
}
