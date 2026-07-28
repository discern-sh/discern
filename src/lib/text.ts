/**
 * Shared terminal-text layout for human (non-`--json`) renderings: the one
 * width reader, display-width measurement, word-wrap, and content-sized table.
 *
 * Layout measures ANSI-styled text by stripping control sequences while
 * retaining them in the returned strings. Callers may therefore style before
 * layout without escape bytes skewing padding or wrapping.
 */

import type { EnvReader } from "../shared/env.ts";

const DEFAULT_TERMINAL_WIDTH = 80;
const ESC = String.fromCharCode(27);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Injectable boundaries for resolving the current terminal width. */
export interface TerminalWidthOptions {
  env?: EnvReader;
  /** Width used when neither the console nor `$COLUMNS` supplies one. */
  fallback?: number;
  /** Test seam for `Deno.consoleSize`; production callers leave it unset. */
  consoleSize?: () => { columns: number };
}

/**
 * Resolve the terminal's usable column count. The real console wins, then
 * `$COLUMNS`, then a caller-specific fallback or the conventional 80 columns.
 * This is the only place the CLI reads terminal dimensions.
 */
export function terminalWidth(options: TerminalWidthOptions = {}): number {
  const env = options.env ?? Deno.env;
  let cols: number | undefined;
  try {
    cols = (options.consoleSize ?? (() => Deno.consoleSize())).call(undefined)
      .columns;
  } catch {
    cols = undefined;
  }
  if (cols === undefined || cols <= 0) {
    const parsed = Number(env.get("COLUMNS"));
    cols = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  if (cols !== undefined) {
    return cols;
  }
  const fallback = options.fallback ?? DEFAULT_TERMINAL_WIDTH;
  return Number.isFinite(fallback) && fallback > 0
    ? fallback
    : DEFAULT_TERMINAL_WIDTH;
}

/**
 * Visible terminal columns in `text`: ANSI CSI escapes count as zero and each
 * remaining Unicode code point counts as one.
 */
export function displayWidth(text: string): number {
  return [...text.replace(ANSI_CSI, "")].length;
}

/**
 * Greedy word-wrap `text` into lines no wider than `width`. Continuation lines
 * carry `hangingIndent`, whose display width reduces their available content
 * width. A single word longer than the available width overflows on its own
 * line rather than splitting a path, branch, or URL.
 */
export function wrapText(
  text: string,
  width: number,
  hangingIndent = "",
): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) {
    return [""];
  }
  const target = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const continuationWidth = Math.max(
    1,
    target - displayWidth(hangingIndent),
  );
  const lines: string[] = [];
  let line = words[0] ?? "";
  for (const word of words.slice(1)) {
    const available = lines.length === 0 ? target : continuationWidth;
    if (displayWidth(line) + 1 + displayWidth(word) <= available) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.map((value, index) =>
    index === 0 ? value : `${hangingIndent}${value}`
  );
}

/** One column in a content-sized aligned table. */
export interface AlignedColumn<Row> {
  header: string;
  value: (row: Row) => string;
}

/** Pad `text` to a visible width without counting its ANSI escape bytes. */
function padDisplayEnd(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

/**
 * Render a header and rows as an aligned table. Each column sizes to its widest
 * visible header or cell; the final column carries no trailing padding.
 */
export function renderAlignedTable<Row>(
  columns: readonly AlignedColumn<Row>[],
  rows: readonly Row[],
): string[] {
  if (columns.length === 0) {
    return [];
  }
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(
      displayWidth(column.header),
      ...cells.map((row) => displayWidth(row[index] ?? "")),
    )
  );
  const line = (values: readonly string[]): string =>
    values.map((value, index) =>
      index === values.length - 1
        ? value
        : padDisplayEnd(value, widths[index] ?? 0)
    ).join("  ");
  return [
    line(columns.map((column) => column.header)),
    ...cells.map(line),
  ];
}
