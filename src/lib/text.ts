/**
 * Discern's retained terminal-text conveniences.
 *
 * The design-system package owns ANSI stripping, grapheme measurement,
 * truncation, padding, and the generic wrapping decisions. Discern keeps this
 * facade so later renderer migrations remain disjoint, plus four product-level
 * conveniences the package does not own: hanging indents, an explicit
 * long-token overflow policy, content-shaped tables, and numeric mini-charts.
 */

import {
  measureText,
  padText,
  stripAnsi as packageStripAnsi,
  truncateText as packageTruncateText,
  wrapText as packageWrapText,
} from "discern-design-system/cli";

export { terminalSize, terminalWidth } from "./terminal.ts";
export type {
  TerminalSize,
  TerminalSizeOptions,
  TerminalWidthOptions,
} from "./terminal.ts";

const SPARKLINE_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Optional policy for tokens wider than a wrapping line. */
export interface WrapTextOptions {
  /** Split an overlong token at package-owned grapheme boundaries. */
  readonly breakLongWords?: boolean;
}

/** Strip ANSI through the package authority. */
export function stripAnsi(text: string): string {
  return packageStripAnsi(text);
}

/** Measure the widest visible line through the package authority. */
export function displayWidth(text: string): number {
  return measureText(text);
}

/** Truncate plain display text without splitting a grapheme. */
export function truncateText(
  text: string,
  width: number,
  ellipsis = "…",
): string {
  return packageTruncateText(text, width, ellipsis);
}

/**
 * Render finite numeric values as a compact Unicode sparkline scaled across
 * their own minimum and maximum. This remains a Discern data projection; it
 * does not reproduce package text measurement.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return "";
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("sparkline values must be finite numbers");
  }
  const first = values[0];
  if (first === undefined) return "";
  let minimum = first;
  let maximum = first;
  for (const value of values.slice(1)) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum === maximum) return SPARKLINE_GLYPHS[0].repeat(values.length);
  const range = maximum - minimum;
  return values.map((value) => {
    const index = Math.round(
      ((value - minimum) / range) * (SPARKLINE_GLYPHS.length - 1),
    );
    return SPARKLINE_GLYPHS[index] ?? SPARKLINE_GLYPHS[0];
  }).join("");
}

/**
 * Project a bounded fraction into filled and unfilled runs. The caller retains
 * semantic styling; package Tokens remain the colour authority.
 */
export function meter(
  fraction: number,
  width: number,
): { filled: string; track: string } {
  if (!Number.isFinite(fraction)) {
    throw new TypeError("meter fraction must be a finite number");
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  let cells = Math.round(clamped * width);
  if (clamped > 0 && cells === 0) cells = 1;
  if (clamped < 1 && cells === width) cells = width - 1;
  return { filled: "█".repeat(cells), track: "░".repeat(width - cells) };
}

/** Whether package wrapping keeps one candidate on a single bounded line. */
function fitsOneLine(text: string, width: number): boolean {
  const lines = packageWrapText(packageStripAnsi(text), width);
  return lines.length === 1 && measureText(lines[0] ?? "") <= width;
}

/** Find the raw-string boundary for one offset in its ANSI-stripped value. */
function rawBoundary(
  raw: string,
  plain: string,
  offset: number,
): number {
  if (offset <= 0) return 0;
  if (offset >= plain.length) return raw.length;
  const expected = plain.slice(0, offset);
  for (let index = 1; index < raw.length; index += 1) {
    if (packageStripAnsi(raw.slice(0, index)) === expected) return index;
  }
  throw new TypeError("package wrapping produced an unmappable text boundary");
}

/** Reproject package-owned plain chunks onto the caller's existing ANSI bytes. */
function restoreStyledChunks(
  raw: string,
  chunks: readonly string[],
): string[] {
  const plain = packageStripAnsi(raw);
  if (plain === "") return [raw];
  const result: string[] = [];
  let plainStart = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (!plain.startsWith(chunk, plainStart)) {
      throw new TypeError("package wrapping changed a long token unexpectedly");
    }
    const plainEnd = plainStart + chunk.length;
    const rawStart = rawBoundary(raw, plain, plainStart);
    const rawEnd = index === chunks.length - 1
      ? raw.length
      : rawBoundary(raw, plain, plainEnd);
    result.push(raw.slice(rawStart, rawEnd));
    plainStart = plainEnd;
  }
  return result;
}

/** Split one styled token with package wrapping at two continuation widths. */
function splitDisplayWord(
  word: string,
  firstWidth: number,
  continuationWidth: number,
): string[] {
  const plain = packageStripAnsi(word);
  if (plain === "") return [word];
  const chunks: string[] = [];
  let remaining = plain;
  let width = firstWidth;
  while (remaining !== "") {
    const chunk = packageWrapText(remaining, width)[0] ?? "";
    if (chunk === "") {
      throw new TypeError(
        "package wrapping returned an empty long-token chunk",
      );
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
    width = continuationWidth;
  }
  return restoreStyledChunks(word, chunks);
}

/** Greedy hanging-indent adaptation for an explicit hard-wrap policy. */
function wrapBreakingLongWords(
  words: readonly string[],
  target: number,
  continuationWidth: number,
  hangingIndent: string,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const available = lines.length === 0 ? target : continuationWidth;
    if (line !== "" && fitsOneLine(`${line} ${word}`, available)) {
      line += ` ${word}`;
      continue;
    }
    if (line !== "") {
      lines.push(line);
      line = "";
    }
    const firstWidth = lines.length === 0 ? target : continuationWidth;
    const chunks = splitDisplayWord(word, firstWidth, continuationWidth);
    lines.push(...chunks.slice(0, -1));
    line = chunks.at(-1) ?? "";
  }
  if (line !== "" || lines.length === 0) lines.push(line);
  return lines.map((value, index) =>
    index === 0 ? value : `${hangingIndent}${value}`
  );
}

/**
 * Adapt package wrapping to Discern's existing hanging-indent contract. A lone
 * overlong token intentionally overflows unless `breakLongWords` is explicit;
 * the package still owns every measurement and grapheme split.
 */
export function wrapText(
  text: string,
  width: number,
  hangingIndent = "",
  options: WrapTextOptions = {},
): string[] {
  const words = text.split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0) return [""];
  const target = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const continuationWidth = Math.max(
    1,
    target - measureText(hangingIndent),
  );
  if (options.breakLongWords === true) {
    return wrapBreakingLongWords(
      words,
      target,
      continuationWidth,
      hangingIndent,
    );
  }
  const lines: string[] = [];
  let line = words[0] ?? "";
  for (const word of words.slice(1)) {
    const available = lines.length === 0 ? target : continuationWidth;
    if (fitsOneLine(`${line} ${word}`, available)) {
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

/** Pad one styled line through the package's display-width authority. */
export function padDisplayEnd(text: string, width: number): string {
  return padText(text, width, "start");
}

/** One label + body row of an aligned listing. */
export interface AlignedRow {
  readonly label: string;
  readonly body: string;
}

/** Layout inputs for {@link renderAlignedRows}. */
export interface AlignedRowsOptions {
  /** Ceiling on the label column, in display cells. */
  readonly labelCap?: number;
  /** Exact label-column width — for a multi-section listing that computed one
   * shared width with {@link alignedLabelWidth} so its sections align. */
  readonly labelWidth?: number;
  /** Leading indent on every emitted line. */
  readonly indent?: string;
  /** Total display width; bodies wrap with a hanging indent to the body
   * column. Omitted, each row stays on one unwrapped line. */
  readonly width?: number;
  /** Style one padded label cell after its geometry is fixed. */
  readonly styleLabel?: (cell: string) => string;
  /** Style one body line after its geometry is fixed. */
  readonly styleBody?: (line: string) => string;
}

const ALIGNED_LABEL_CAP = 32;
const ALIGNED_GUTTER = 2;
const ALIGNED_MIN_BODY = 24;

/** The label-column width the aligned-listing policy assigns: the widest label,
 * capped. Exposed for multi-section listings that share one column. */
export function alignedLabelWidth(
  labels: readonly string[],
  cap = ALIGNED_LABEL_CAP,
): number {
  return Math.min(cap, Math.max(...labels.map((label) => measureText(label))));
}

/**
 * The one column policy for aligned label + body listings (command tables,
 * script and skill inventories, tables of contents, help rows): the label
 * column is the widest label capped at `labelCap`, a two-cell gutter follows,
 * and — when a `width` is supplied — bodies wrap with a hanging indent to the
 * body column. When the body column would fall under 24 cells, rows stack:
 * the label on its own line, the body wrapped beneath a two-cell-deeper
 * indent. A width-bounded listing also stacks any single row whose label
 * exceeds the column, hard-breaking the label so every emitted line stays
 * bounded; without a width, rows stay on one unwrapped line. Geometry uses
 * package display-width measurement throughout; callers own safety (sanitize
 * dynamic labels and bodies first) and styling.
 */
export function renderAlignedRows(
  rows: readonly AlignedRow[],
  options: AlignedRowsOptions = {},
): string[] {
  if (rows.length === 0) return [];
  const indent = options.indent ?? "  ";
  const styleLabel = options.styleLabel ?? ((cell: string): string => cell);
  const styleBody = options.styleBody ?? ((line: string): string => line);
  const labelWidth = options.labelWidth ?? alignedLabelWidth(
    rows.map((row) => row.label),
    options.labelCap,
  );
  const bodyStart = measureText(indent) + labelWidth + ALIGNED_GUTTER;
  const bodyWidth = options.width === undefined
    ? undefined
    : Math.max(1, options.width - bodyStart);
  // One row on its own lines: the label first (hard-wrapped when a width
  // bounds the listing), then the body under a two-cell-deeper indent.
  const stackRow = (row: AlignedRow): string[] => {
    const stackIndent = `${indent}  `;
    const labelLines = options.width === undefined ? [row.label] : wrapText(
      row.label,
      Math.max(1, options.width - measureText(indent)),
      "",
      { breakLongWords: true },
    );
    const stackWidth = Math.max(
      1,
      (options.width ?? 1) - measureText(stackIndent),
    );
    return [
      ...labelLines.map((line) => `${indent}${styleLabel(line)}`.trimEnd()),
      ...(row.body === ""
        ? []
        : wrapText(row.body, stackWidth, "", { breakLongWords: true })
          .map((line) => `${stackIndent}${styleBody(line)}`.trimEnd())),
    ];
  };
  if (bodyWidth !== undefined && bodyWidth < ALIGNED_MIN_BODY) {
    return rows.flatMap(stackRow);
  }
  const continuation = " ".repeat(bodyStart);
  return rows.flatMap((row) => {
    if (bodyWidth !== undefined && measureText(row.label) > labelWidth) {
      return stackRow(row);
    }
    const cell = styleLabel(padDisplayEnd(row.label, labelWidth));
    const bodyLines = bodyWidth === undefined
      ? [row.body]
      : wrapText(row.body, bodyWidth, "", { breakLongWords: true });
    return [
      `${indent}${cell}  ${styleBody(bodyLines[0] ?? "")}`.trimEnd(),
      ...bodyLines.slice(1).map((line) =>
        `${continuation}${styleBody(line)}`.trimEnd()
      ),
    ];
  });
}
