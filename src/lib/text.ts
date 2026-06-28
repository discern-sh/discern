/**
 * Shared plain-text layout helpers for the human (non-`--json`) renderings —
 * the one place the terminal word-wrap lives, so `doctor`'s execution model and
 * `discern --help`'s grouped command list wrap identically.
 */

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
