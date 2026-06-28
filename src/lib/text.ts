/**
 * Shared plain-text layout helpers for the human (non-`--json`) renderings —
 * the one place the terminal word-wrap lives, so `doctor`'s execution model and
 * `discern --help`'s grouped command list wrap identically.
 */

import type { EnvReader } from "../shared/env.ts";

/**
 * The terminal's usable column count, or `undefined` when output is not a TTY and
 * `$COLUMNS` is unset (piped/redirected). The single place the CLI reads the
 * console width: width-aware human rendering funnels through here, so it pairs with
 * {@link wrapText} in one module and can never drift into a second ad-hoc reader
 * that wraps differently — or not at all. Callers apply their own default + clamp.
 */
export function terminalWidth(env: EnvReader = Deno.env): number | undefined {
  let cols: number | undefined;
  try {
    cols = Deno.consoleSize().columns;
  } catch {
    cols = undefined;
  }
  if (cols === undefined || cols <= 0) {
    const parsed = Number(env.get("COLUMNS"));
    cols = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return cols;
}

/**
 * Greedy word-wrap `text` into lines no wider than `width`. A single word longer
 * than `width` overflows on its own line rather than being split mid-token (so a
 * long path or a `colon:sub-verb` is never broken across a line).
 */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let line = words[0] ?? "";
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}
