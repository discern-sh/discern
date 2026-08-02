/**
 * The voice skill's banned-words table and the Discern Vale style encode one
 * rule set on two surfaces: the skill is the canon agents read; the style is
 * the tripwire the gate runs over the map. This guard forces the pair to move
 * together — every mechanically bannable phrase in the skill's table must be
 * matched by some pattern in `.vale/Discern/`, so adding a word to the canon
 * without teaching the lint fails the gate (the fix-the-class discipline,
 * applied to prose rules).
 *
 * Direction matters: the style may encode MORE than the table (the skill's
 * banned *moves* — contrast-frames, recap headings — live there too), but the
 * table may never ban a phrase the style cannot see.
 *
 * Rows whose "Avoid" cell isn't purely quoted phrases (passive-voice dodging,
 * exclamation points, emoji) describe patterns no token list can hold; they
 * are skipped by shape, not by a hand-kept exception list.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

const SKILL_PATH = join(
  REPO_AUTHORED_PATHS.skills,
  "discern-voice-and-tone",
  "SKILL.md",
);
const STYLE_DIR = join(REPO_ROOT, ".vale", "Discern");

/** The quoted phrases of one banned-words table row, or undefined when the
 * row isn't a pure phrase list (prose descriptions can't be lint tokens). */
function phrasesOfRow(avoidCell: string): string[] | undefined {
  const quoted = [...avoidCell.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  if (quoted.length === 0) return undefined;
  const residue = avoidCell.replaceAll(/"[^"]+"/g, "");
  if (/[A-Za-z]/.test(residue)) return undefined;
  return quoted.flatMap(expandSlashes).map((p) =>
    p.replace(/[.,;]+$/, "").trim().toLowerCase()
  );
}

/** "We're excited/thrilled to announce" → both single-word alternatives. */
function expandSlashes(phrase: string): string[] {
  const m = phrase.match(/^(.*?)(\w+)\/(\w+)(.*)$/);
  if (!m) return [phrase];
  const [, pre, a, b, post] = m;
  return [
    ...expandSlashes(`${pre}${a}${post}`),
    ...expandSlashes(`${pre}${b}${post}`),
  ];
}

/** Every regex pattern the Discern style can fire on: `tokens:`/`raw:` list
 * items, `swap:` keys, and scalar `token:` values, from every rule file. */
async function stylePatterns(): Promise<{ file: string; pattern: string }[]> {
  const patterns: { file: string; pattern: string }[] = [];
  for await (const entry of Deno.readDir(STYLE_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".yml")) continue;
    const text = await Deno.readTextFile(join(STYLE_DIR, entry.name));
    let inList = false;
    let inSwap = false;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trimEnd();
      if (line.trim() === "") continue;
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        const [, key, value] = keyMatch;
        inList = key === "tokens" || key === "raw";
        inSwap = key === "swap";
        if (key === "token" && value) {
          patterns.push({ file: entry.name, pattern: unquote(value) });
        }
        continue;
      }
      const item = line.match(/^\s+-\s+(.*)$/);
      if (inList && item) {
        patterns.push({ file: entry.name, pattern: unquote(item[1] ?? "") });
        continue;
      }
      const swapKey = line.match(/^\s+([^:]+):\s+.+$/);
      if (inSwap && swapKey) {
        patterns.push({
          file: entry.name,
          pattern: unquote((swapKey[1] ?? "").trim()),
        });
      }
    }
  }
  return patterns;
}

/** Strip balanced YAML scalar quotes before compiling Vale vocabulary patterns in JavaScript. */
function unquote(s: string): string {
  const t = s.trim();
  return (t.startsWith("'") && t.endsWith("'")) ||
      (t.startsWith('"') && t.endsWith('"'))
    ? t.slice(1, -1)
    : t;
}

/** Vale wraps word-ish tokens in \b…\b; mirror that leniently for the test. */
function matchers(pattern: string): RegExp[] {
  const out: RegExp[] = [];
  for (const source of [pattern, `\\b(?:${pattern})\\b`]) {
    try {
      out.push(new RegExp(source, "i"));
    } catch {
      // A Vale-only construct that JS can't compile is fine as long as the
      // bare form compiled; if neither does, the pattern matches nothing.
    }
  }
  return out;
}

Deno.test("every banned word in the voice skill is lintable by the Discern style", async () => {
  const skill = await Deno.readTextFile(SKILL_PATH);
  const section = skill.split(/^## Banned words$/m)[1]?.split(/^## /m)[0];
  assert(
    section !== undefined,
    "the voice skill keeps a '## Banned words' section — the canon this guard reads",
  );

  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  const phraseRows = rows
    .slice(2) // header + separator
    .map((row) => phrasesOfRow(row.split("|")[1] ?? ""))
    .filter((p): p is string[] => p !== undefined);
  assert(
    phraseRows.length >= 5,
    "the banned-words table holds several mechanical rows — an empty parse " +
      "means the table shape changed; update this guard's reader with it",
  );

  const patterns = await stylePatterns();
  assert(
    patterns.length >= 20,
    "the Discern style carries its token lists — an empty parse means the " +
      "rule-file shape changed; update this guard's reader with it",
  );
  const compiled = patterns.map((p) => matchers(p.pattern)).flat();

  const unmatched = phraseRows.flat().filter((phrase) =>
    !compiled.some((re) => re.test(phrase))
  );
  assertEquals(
    unmatched,
    [],
    "banned in the voice skill but invisible to .vale/Discern/ — add a " +
      "pattern for each so the canon and the tripwire move together",
  );
});

Deno.test("every Discern pattern survives a source-line wrap", async () => {
  // The map hard-wraps prose at ~80 columns, so any word gap in a page can be
  // a newline. A multi-word pattern joined by a literal space silently skips
  // every wrapped instance — the gap class behind several live misses. Join
  // words with \s+ instead; this guard fails on any literal space so a new
  // pattern can't reintroduce the class.
  const offenders = (await stylePatterns()).filter((p) =>
    p.pattern.includes(" ")
  );
  assertEquals(
    offenders,
    [],
    "a literal space in a Vale pattern misses instances wrapped across " +
      "source lines — join words with \\s+ instead",
  );
});
