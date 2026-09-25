/**
 * American-spelling guard for the shipped copy Vale never reads.
 *
 * discern writes American English wherever a reader meets its words. The house
 * Vale rule (`.vale/Discern/AmericanSpelling.yml`) holds map and manual prose;
 * this guard applies the same word list to copy outside those corpora: string
 * literals under `src/` (help text, results, diagnostics, MCP descriptions),
 * every text file under `templates/` (shipped verbatim into other projects),
 * and the instruction sources and authored skills every agent session loads.
 *
 * The Vale rule's swap table is the single source of the word list, so a
 * spelling added there is enforced here in the same change. Identifiers and
 * wire values stay outside the law: code spans are skipped, and the table
 * leaves out forms American English also accepts, such as the published
 * `cancelled` result state.
 */

import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { stringLiterals, visibleMarkdown } from "./vocab_scan.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RULE = ".vale/Discern/AmericanSpelling.yml";

/** The British spellings the Vale rule swaps, read from its swap table. */
async function britishSpelling(): Promise<RegExp> {
  const text = await Deno.readTextFile(join(REPO_ROOT, RULE));
  const table = text.slice(text.indexOf("\nswap:\n"));
  const keys = [...table.matchAll(/^ {2}([^\s:#][^:]*):\s+\S/gm)]
    .map((match) => (match[1] ?? "").trim());
  if (keys.length === 0) throw new Error(`${RULE} declares no swaps`);
  return new RegExp(String.raw`\b(?:${keys.join("|")})\b`, "gi");
}

/** Blank code so an identifier in a code span or block never counts. */
function withoutMarkdownCode(text: string): string {
  const blank = (code: string): string => code.replace(/[^\n]/g, " ");
  return visibleMarkdown(
    text
      .replace(/^(\s*)(```|~~~)[^\n]*\n[\s\S]*?^\s*\2[^\n]*$/gm, blank)
      .replace(/`+[^`\n]*`+/g, blank),
  );
}

/** One finding per British spelling, with the line it starts on. */
function findings(
  rel: string,
  text: string,
  pattern: RegExp,
  firstLine = 1,
): string[] {
  return [...text.matchAll(pattern)].map((match) => {
    const line = firstLine + text.slice(0, match.index).split("\n").length - 1;
    return `${rel}:${line} "${match[0]}"`;
  });
}

Deno.test("shipped source strings use American spelling", async () => {
  const pattern = await britishSpelling();
  const files = await structuralGuardScope({
    guard: "tests/us_spelling_guard_test.ts#shipped-source-strings",
    universe: "authored-ts",
    narrow: {
      reason:
        "Shipped copy lives in string literals under src; scripts and tests never reach a reader.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
  const found: string[] = [];
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const literal of stringLiterals(source)) {
      found.push(...findings(rel, literal.text, pattern, literal.line));
    }
  }
  assertEquals(
    found,
    [],
    `write shipped copy in American English; the word list is ${RULE}`,
  );
});

Deno.test("shipped templates, instructions, and skills use American spelling", async () => {
  const pattern = await britishSpelling();
  const instructions = new Set(
    REPO_AUTHORED_PATHS.instructions.map((path) => relative(REPO_ROOT, path)),
  );
  const skills = `${relative(REPO_ROOT, REPO_AUTHORED_PATHS.skills)}/`;
  const files = await structuralGuardScope({
    guard: "tests/us_spelling_guard_test.ts#shipped-text",
    universe: "authored-text",
    narrow: {
      reason:
        "Templates ship verbatim and instruction sources and skills load into every session; Vale lints map and manual prose.",
      include: (rel) =>
        rel.startsWith("templates/") || instructions.has(rel) ||
        rel.startsWith(skills),
    },
  });
  const found: string[] = [];
  for (const rel of files) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    const prose = rel.endsWith(".md") ? withoutMarkdownCode(text) : text;
    found.push(...findings(rel, prose, pattern));
  }
  assertEquals(
    found,
    [],
    `write shipped copy in American English; the word list is ${RULE}`,
  );
});
