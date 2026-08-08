/**
 * The voice registry's banned canon (`BANNED_WORDS` and `BANNED_MOVES` in
 * `scripts/brand/voice.ts`) and the Discern Vale style encode one rule set
 * on two surfaces: the canon renders into the generated voice skills agents
 * read; the style is the tripwire the gate runs over the map. This guard
 * forces the pair to move together — every `phrases` entry the canon
 * declares must be matched by some pattern in `.vale/Discern/`, so banning
 * a phrase in the canon without teaching the lint fails the gate (the
 * fix-the-class discipline, applied to prose rules).
 *
 * Direction matters: the style may encode MORE than the canon (extra tells
 * with no documenting rule are legal), but the canon may never declare a
 * phrase the style cannot see. Entries without `phrases` are judgment rules
 * no token list can hold; they are exempt by shape, not by a hand-kept
 * exception list.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { BANNED_MOVES, BANNED_WORDS } from "../scripts/brand/voice.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const STYLE_DIR = join(REPO_ROOT, ".vale", "Discern");

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

/** Flatten a canon set's declared phrases, tagged with their entry id. */
function declaredPhrases(
  entries: readonly { id: string; phrases?: readonly string[] }[],
): { id: string; phrase: string }[] {
  return entries.flatMap((entry) =>
    (entry.phrases ?? []).map((phrase) => ({ id: entry.id, phrase }))
  );
}

Deno.test("every banned phrase in the voice canon is lintable by the Discern style", async () => {
  const declared = [
    ...declaredPhrases(BANNED_WORDS),
    ...declaredPhrases(BANNED_MOVES),
  ];
  assert(
    declared.length >= 25,
    "the voice canon declares its mechanical phrases — a near-empty set " +
      "means the canon was gutted; the banned tables carry `phrases`",
  );

  const patterns = await stylePatterns();
  assert(
    patterns.length >= 20,
    "the Discern style carries its token lists — an empty parse means the " +
      "rule-file shape changed; update this guard's reader with it",
  );
  const compiled = patterns.map((p) => matchers(p.pattern)).flat();

  const unmatched = declared.filter(({ phrase }) =>
    !compiled.some((re) => re.test(phrase))
  );
  assertEquals(
    unmatched,
    [],
    "banned in the voice canon but invisible to .vale/Discern/ — add a " +
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
