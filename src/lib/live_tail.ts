/**
 * What a repainting terminal view keeps of a streamed line.
 *
 * A package view that repaints lays out every line it holds again on each
 * frame, and the work that wrote a line chose its length. A view therefore
 * receives only the part of each streamed line it can show; the record or
 * artifact that keeps the output keeps all of it.
 */

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
