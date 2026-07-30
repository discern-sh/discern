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
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MARK = /\p{Mark}/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const SPARKLINE_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Whether one Unicode scalar is conventionally two terminal columns. */
function isWideCodePoint(code: number): boolean {
  return code >= 0x1100 &&
    (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1b000 && code <= 0x1b2ff) ||
      (code >= 0x1f200 && code <= 0x1f251) ||
      (code >= 0x20000 && code <= 0x3fffd)
    );
}

/** Terminal width of one extended grapheme cluster. */
function graphemeWidth(grapheme: string): number {
  if (
    PICTOGRAPH.test(grapheme) ||
    EMOJI_PRESENTATION.test(grapheme) ||
    grapheme.includes("\u20e3")
  ) {
    return 2;
  }
  for (const scalar of grapheme) {
    const code = scalar.codePointAt(0) ?? 0;
    if (
      MARK.test(scalar) ||
      code === 0x200d ||
      (code >= 0xfe00 && code <= 0xfe0f) ||
      (code >= 0xe0100 && code <= 0xe01ef)
    ) {
      continue;
    }
    if (code === 0 || code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      return 0;
    }
    return isWideCodePoint(code) ? 2 : 1;
  }
  return 0;
}

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
 * Visible terminal columns in `text`: ANSI CSI escapes, controls, combining
 * marks, and joiners count as zero; CJK/full-width and emoji graphemes count as
 * two; other graphemes count as one.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of GRAPHEMES.segment(text.replace(ANSI_CSI, ""))) {
    width += graphemeWidth(segment);
  }
  return width;
}

/**
 * Render finite numeric values as a compact Unicode sparkline scaled across
 * their own minimum and maximum. Flat input uses the lowest glyph for every
 * point, including a single value. Empty input stays empty; a non-finite value
 * is a contract error rather than an invented mark.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) {
    return "";
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("sparkline values must be finite numbers");
  }
  const first = values[0];
  if (first === undefined) {
    return "";
  }
  let minimum = first;
  let maximum = first;
  for (const value of values.slice(1)) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum === maximum) {
    return SPARKLINE_GLYPHS[0].repeat(values.length);
  }
  const range = maximum - minimum;
  return values.map((value) => {
    const index = Math.round(
      ((value - minimum) / range) * (SPARKLINE_GLYPHS.length - 1),
    );
    return SPARKLINE_GLYPHS[index] ?? SPARKLINE_GLYPHS[0];
  }).join("");
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
export function padDisplayEnd(text: string, width: number): string {
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
