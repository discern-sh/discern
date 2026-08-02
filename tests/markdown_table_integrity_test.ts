/**
 * The pipe-in-code-span table-destruction class, cured as a class: GFM splits
 * table rows on every raw `|` — inside code spans too — so a row authored
 * with an unescaped in-span pipe carries phantom cells, and the Markdown
 * formatters (`deno fmt` over templates/, `discern tidy` over the map)
 * normalize the row against its header and silently drop the overflow. That
 * destroyed the Node row of templates/setup/instructions.md's stack-wiring
 * table: the install command's tail and the whole smoke-check cell vanished.
 *
 * The predicate (src/lib/table_integrity.ts): in every recognized GFM table,
 * no row may split into more cells than its header (`extra_cells` — the lossy
 * authored state), and no row may open a code span that never closes
 * (`unclosed_span` — the wreckage a lossy format leaves, which count checks
 * alone miss because the formatter re-normalizes the cell count). The
 * universe is every tracked Markdown file (tests/repo_authored_paths.ts), so
 * a new page, tree, or template enrols the moment it is tracked. `discern
 * tidy` additionally refuses the lossy kind before writing, for every
 * project's map (tests/engine_tidy_test.ts).
 *
 * Bite proofs first — including the literal wrecked and pre-wreck bytes of
 * the row that motivated the guard — then tolerance proofs for the legal
 * idioms, one adversarial future sibling in unrelated vocabulary, then the
 * live sweep the gate runs.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  scanMarkdownTables,
  type TableViolation,
} from "../src/lib/table_integrity.ts";
import { REPO_ROOT, TRACKED_MD_FILES } from "./repo_authored_paths.ts";

/** Terminate fixture rows as a complete Markdown table block. */
function table(...rows: string[]): string {
  return [...rows, ""].join("\n");
}

/** Reduce table findings to stable line-and-rule evidence for assertions. */
function at(violations: TableViolation[]): string[] {
  return violations.map((v) => `${v.line}:${v.kind}`);
}

const STACK_HEADER =
  "| Stack | What a fresh worktree is missing → how to wire it | Prove it boots (`smoke`) |";
const STACK_DELIMITER = "| --- | --- | --- |";

/** The Node row as authored before the escape — the state that loses cells. */
const NODE_ROW_UNESCAPED =
  "| **Node / JS / TS** | `node_modules/` → `ensure`: a check-then-install (`npm ls --silent >/dev/null 2>&1 || npm ci`, or your package manager's frozen-lockfile install) | the package's own CLI `--version`, or a one-line script that imports your entry module and exits |";

/** The same row after a formatter dropped the phantom-cell overflow. */
const NODE_ROW_WRECKED =
  "| **Node / JS / TS** | `node_modules/` → `ensure`: a check-then-install (`npm ls --silent >/dev/null 2>&1 | |";

/** The cured row: every in-span pipe escaped as `\|`. */
const NODE_ROW_ESCAPED =
  "| **Node / JS / TS** | `node_modules/` → `ensure`: a check-then-install (`npm ls --silent >/dev/null 2>&1 \\|\\| npm ci`, or your package manager's frozen-lockfile install) | the package's own CLI `--version`, or a one-line script that imports your entry module and exits |";

// ── bite proofs ───────────────────────────────────────────────────────────────

Deno.test("the unescaped in-span pipes that caused the loss are a violation (the guard bites)", () => {
  const found = scanMarkdownTables(
    table(STACK_HEADER, STACK_DELIMITER, NODE_ROW_UNESCAPED),
  );
  // The raw `||` splits the row into five cells and tears the command's code
  // span open — both kinds fire on the same row.
  assertEquals(at(found), ["3:extra_cells", "3:unclosed_span"]);
  assert(
    found.some((v) => v.reason.includes('"\\|"')),
    "the diagnostic must carry the escape remedy",
  );
});

Deno.test("the wreckage a lossy format leaves is a violation the cell count alone would miss", () => {
  const found = scanMarkdownTables(
    table(STACK_HEADER, STACK_DELIMITER, NODE_ROW_WRECKED),
  );
  // The formatter re-normalized the count to the header's, so only the torn
  // span betrays the loss.
  assertEquals(at(found), ["3:unclosed_span"]);
  assert(
    found[0]?.reason.includes("version control"),
    "the diagnostic must point at recovering the dropped text",
  );
});

Deno.test("an in-span pipe that lands back on the header count still bites", () => {
  const found = scanMarkdownTables(table(
    "| flag | meaning |",
    "| --- | --- |",
    "| `x | y` |",
  ));
  // Two phantom cells equal the two-column header, so no overflow — the torn
  // span is the only witness.
  assertEquals(at(found), ["3:unclosed_span"]);
});

Deno.test("a torn span in the header row itself is a violation", () => {
  const found = scanMarkdownTables(table(
    "| a | `b | c |",
    "| --- | --- | --- |",
    "| one | two | three |",
  ));
  assertEquals(at(found), ["1:unclosed_span"]);
});

Deno.test("adversarial future sibling: unrelated vocabulary in another table shape still bites", () => {
  // Nothing here shares wording with the row that motivated the guard: a
  // two-column pattern table whose alternation pipe is unescaped.
  const found = scanMarkdownTables(table(
    "| pattern | matches |",
    "| ------- | ------- |",
    "| `cat|dog` | either word |",
  ));
  assertEquals(at(found), ["3:extra_cells", "3:unclosed_span"]);
});

// ── tolerance proofs: the corpus's legal idioms stay legal ────────────────────

Deno.test("the cured row — in-span pipes escaped — is clean", () => {
  assertEquals(
    scanMarkdownTables(table(STACK_HEADER, STACK_DELIMITER, NODE_ROW_ESCAPED)),
    [],
  );
});

Deno.test("example tables inside fences are inert and skipped", () => {
  assertEquals(
    scanMarkdownTables([
      "```",
      STACK_HEADER,
      STACK_DELIMITER,
      NODE_ROW_UNESCAPED,
      "```",
      "",
    ].join("\n")),
    [],
  );
});

Deno.test("a longer-run span carrying a literal backtick is clean", () => {
  assertEquals(
    scanMarkdownTables(table(
      "| character | meaning |",
      "| --- | --- |",
      "| `` ` `` | a literal backtick |",
    )),
    [],
  );
});

Deno.test("a backslash-escaped backtick outside any span is clean", () => {
  assertEquals(
    scanMarkdownTables(table(
      "| a \\` b | c |",
      "| --- | --- |",
      "| one | two |",
    )),
    [],
  );
});

Deno.test("a row with fewer cells than its header is legal — padding loses nothing", () => {
  assertEquals(
    scanMarkdownTables(table(
      "| a | b | c |",
      "| --- | --- | --- |",
      "| one | two |",
    )),
    [],
  );
});

Deno.test("a header/delimiter count mismatch is not a table and is skipped", () => {
  assertEquals(
    scanMarkdownTables(table(
      "| a | b |",
      "| --- | --- | --- |",
      "| `x | y | z | w |",
    )),
    [],
  );
});

Deno.test("pipes in prose without a delimiter row are not a table", () => {
  assertEquals(
    scanMarkdownTables("either `a | b` or `c || d` reads fine in prose\n"),
    [],
  );
});

// ── the live sweep the gate runs ──────────────────────────────────────────────

Deno.test("the tracked-Markdown universe covers the row that motivated the guard", () => {
  assert(
    TRACKED_MD_FILES.includes("templates/setup/instructions.md"),
    "templates/setup/instructions.md ships the setup brief — if it left " +
      "the universe, the table this guard exists for would go unguarded",
  );
});

Deno.test("every GFM table row in tracked Markdown splits cleanly against its header", async () => {
  const failures: string[] = [];
  for (const rel of TRACKED_MD_FILES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const v of scanMarkdownTables(text)) {
      failures.push(`${rel}:${v.line} [${v.kind}] ${v.reason}`);
    }
  }
  assertEquals(
    failures,
    [],
    'malformed table row(s). A raw "|" inside a code span still separates ' +
      "cells, so a formatter drops whatever overflows the header — escape " +
      'every in-span pipe as "\\|". For an unclosed_span finding the loss ' +
      "may already have happened: recover the row from git history, then " +
      "escape it. (Scanner: src/lib/table_integrity.ts)",
  );
});
