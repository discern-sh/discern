/**
 * The Desk's only route from product text to a terminal slot.
 *
 * Observed text (task titles, Git output, refusal messages, briefs) can hold
 * line breaks and control characters. A single-line slot (a title, a label, a
 * description, a command) joins its lines with spaces; a reading region keeps
 * each line on its own row. Neither renders a raw control character, and no
 * line break ever reaches a single-line sanitizer, so multi-line evidence
 * never collapses into one paragraph of visible control pictures.
 */

import {
  type TerminalLine,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";

const LINE_BREAK = /[ \t]*(?:\r\n|[\n\r\u2028\u2029\u0085])[ \t]*/gu;
const OTHER_LINE_BREAK = /\r\n|[\r\u2028\u2029\u0085]/gu;
const MARKDOWN_SPECIAL = /[\\`*_{}\[\]<>#|]/gu;
const LEADING_BLOCK_MARKER = /^([-+=~])|^(\d+)([.)])/u;

/** Text for one single-line slot: its lines joined by spaces. */
export function deskLine(value: string): TerminalLine {
  return terminalLine(value.replace(LINE_BREAK, " "));
}

/** One line of observed text as literal Markdown inline content. */
function literalLine(line: string): string {
  return line
    .replace(MARKDOWN_SPECIAL, "\\$&")
    .replace(
      LEADING_BLOCK_MARKER,
      (_marker, sign: string | undefined, digits: string, closer: string) =>
        sign === undefined ? `${digits}\\${closer}` : `\\${sign}`,
    );
}

/**
 * Observed text as literal Markdown for a reading region. Every line keeps
 * its own row through a hard break; nothing in it can start a heading, list,
 * quote, fence, or emphasis.
 */
export function deskLiteral(value: string): string {
  return terminalMultiline(value.replace(OTHER_LINE_BREAK, "\n"))
    .split("\n")
    .map((line) => literalLine(line.trim()))
    .join("  \n");
}
