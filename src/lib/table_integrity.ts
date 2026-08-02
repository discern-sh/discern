/**
 * GFM-table integrity scanner — the executable predicate behind the
 * pipe-in-code-span table-destruction class.
 *
 * The mechanism that permits the defect: GFM splits a table row into cells on
 * every raw `|`, including one inside a code span (the spec's escape is `\|`).
 * A row authored with a raw in-span pipe therefore carries phantom cells, and
 * a table-normalizing Markdown formatter resolves the row against the header's
 * column count and silently drops the overflow — destroying content. Renderers
 * drop the same overflow at display time.
 *
 * Two consumers, one definition of "sound": `discern tidy` refuses to format a
 * file whose tables would lose cells — the `extra_cells` kind — before any
 * byte is written (src/engine/tidy/tidy.ts), and this repo's own gate sweeps
 * every tracked Markdown file with the stricter editorial predicate — both
 * kinds — so torn-span wreckage left by a formatter cannot persist
 * (tests/markdown_table_integrity_test.ts).
 *
 * Deliberate leniency, so legal idioms stay legal:
 *  - a row with FEWER cells than its header is fine: GFM pads it and a
 *    formatter completes it losslessly;
 *  - a header/delimiter cell-count mismatch is not a table at all (GFM and
 *    formatters leave the block as prose), so it is skipped;
 *  - fenced blocks are skipped — an example table inside a fence is inert
 *    (fencedBlocks is the shared fence authority);
 *  - code-span pairing follows CommonMark's equal-run rule, so a longer-run
 *    span carrying a literal backtick stays legal, as does a
 *    backslash-escaped backtick outside any span.
 */

import { fencedBlocks } from "./docs_integrity.ts";
import { isTableDelimiter, splitRow } from "./markdown.ts";

/** One integrity violation in a GFM table row. */
export interface TableViolation {
  /** 1-based source line of the offending row. */
  line: number;
  /**
   * `extra_cells`: the row splits into more cells than its header, so a
   * formatter or renderer drops the overflow — content is lost.
   * `unclosed_span`: a backtick run in the row opens a code span no equal run
   * closes — the signature of a span already torn at a `|` cell boundary.
   */
  kind: "extra_cells" | "unclosed_span";
  /** What is wrong and how to fix it, phrased for the row's author. */
  reason: string;
}

/**
 * Whether a backtick run in `cell` opens a code span that no later equal-length
 * run closes. CommonMark pairing: a span opened by a run of N backticks closes
 * at the next run of exactly N (unequal runs in between are span content), and
 * a backslash-escaped backtick outside a span is literal text, not a run.
 */
function hasUnclosedSpan(cell: string): boolean {
  const chars = Array.from(cell);
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === "\\" && chars[i + 1] === "`") {
      i += 2;
      continue;
    }
    if (chars[i] !== "`") {
      i += 1;
      continue;
    }
    let open = 0;
    while (chars[i] === "`") {
      open += 1;
      i += 1;
    }
    let closed = false;
    let j = i;
    while (j < chars.length) {
      if (chars[j] !== "`") {
        j += 1;
        continue;
      }
      let run = 0;
      while (chars[j] === "`") {
        run += 1;
        j += 1;
      }
      if (run === open) {
        closed = true;
        i = j;
        break;
      }
    }
    if (!closed) return true;
  }
  return false;
}

/** Check the row. */
function checkRow(
  line: string,
  lineNo: number,
  headerCells: number,
  isHeader: boolean,
  out: TableViolation[],
): void {
  const cells = splitRow(line);
  if (!isHeader && cells.length > headerCells) {
    out.push({
      line: lineNo,
      kind: "extra_cells",
      reason: `table row splits into ${cells.length} cells against a ` +
        `${headerCells}-column header, so formatting would drop the ` +
        'overflow — a raw "|" separates cells even inside a code span; ' +
        'escape each in-span pipe as "\\|"',
    });
  }
  if (cells.some(hasUnclosedSpan)) {
    out.push({
      line: lineNo,
      kind: "unclosed_span",
      reason: "table row opens a code span no equal backtick run closes — " +
        'the signature of a span torn at a "|" cell boundary; escape ' +
        'in-span pipes as "\\|", and if a formatter already truncated the ' +
        "row, recover the lost text from version control",
    });
  }
}

/**
 * Scan one Markdown document for table-integrity violations, in document
 * order. A table is a line containing `|` followed by a delimiter row with the
 * same cell count (the GFM recognition rule); its rows run until a blank line
 * or a line without `|`.
 */
export function scanMarkdownTables(md: string): TableViolation[] {
  const lines = md.split("\n");
  const fenced = new Set<number>();
  for (const block of fencedBlocks(md)) {
    // startLine is the first body line; the closing fence marker cannot look
    // like a table row, so excluding the body alone is sufficient.
    for (let n = 0; n < block.lines.length; n += 1) {
      fenced.add(block.startLine + n);
    }
  }
  const out: TableViolation[] = [];
  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i] ?? "";
    const delimiter = lines[i + 1];
    if (
      fenced.has(lineNo) || !/\|/.test(line) || delimiter === undefined ||
      fenced.has(lineNo + 1) || !isTableDelimiter(delimiter)
    ) {
      i += 1;
      continue;
    }
    const headerCells = splitRow(line).length;
    if (splitRow(delimiter).length !== headerCells) {
      i += 2;
      continue;
    }
    checkRow(line, lineNo, headerCells, true, out);
    i += 2;
    while (i < lines.length) {
      const row = lines[i] ?? "";
      if (fenced.has(i + 1) || !/\|/.test(row) || row.trim() === "") break;
      checkRow(row, i + 1, headerCells, false, out);
      i += 1;
    }
  }
  return out;
}
