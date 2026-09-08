/** Product-name and registry-driven canonical-term casing on shipped copy. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { runningProseCaseRules } from "../scripts/glossary_registry.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  bannedPhraseLines,
  runningMarkdownProse,
  stringLiterals,
} from "./vocab_scan.ts";

const CAPITALIZED_PRODUCT = /\bDiscern\b(?!-(?:owned|authored)\b|\$\{)/g;
const DOTTED_IDENTIFIER =
  /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g;

const SOURCE_PRODUCT_IDENTIFIER_EXCEPTIONS = [{
  path: "src/shared/result_codegen.ts",
  literal: "Discern",
  count: 2,
  reason:
    "The fragment prefixes generated exported TypeScript identifiers; it is not running product prose.",
}] as const;

/** Production TypeScript files whose string literals enter the shipped binary. */
async function shippedSourceFiles(): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/product_name_case_test.ts#shipped-source-strings",
    universe: "authored-ts",
    narrow: {
      reason:
        "Compiled product copy lives in src; repository scripts and tests are development surfaces.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
}

/** Authored text surfaces copied or published as product documentation. */
async function shippedTextFiles(): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/product_name_case_test.ts#shipped-text-copy",
    universe: "authored-text",
    narrow: {
      reason:
        "Templates, public schemas, and the bundled manual are copied or served as product text.",
      include: (rel) =>
        rel.startsWith("templates/") || rel.startsWith("schema/") ||
        rel.startsWith("project/manual/"),
    },
  });
}

const JSON_PROSE_KEYS = new Set([
  "description",
  "help",
  "hint",
  "message",
  "note",
  "prompt",
  "question",
  "reason",
  "recovery",
  "summary",
  "title",
  "why",
]);

/** Textual contract fields from generated JSON, excluding keys and identifiers. */
function jsonProse(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return JSON_PROSE_KEYS.has(key) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => jsonProse(item));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([childKey, child]) =>
    jsonProse(child, childKey)
  );
}

/** Extract running prose from one shipped Markdown, JSON, or template file. */
async function textProse(rel: string): Promise<string[]> {
  const text = await Deno.readTextFile(join(REPO_ROOT, rel));
  if (rel.endsWith(".json")) {
    return jsonProse(decodeWith(z.json(), text)).map((value) =>
      runningMarkdownProse(value).replace(DOTTED_IDENTIFIER, "")
    );
  }
  if (rel.endsWith(".md")) {
    return [runningMarkdownProse(text).replace(DOTTED_IDENTIFIER, "")];
  }
  // Non-Markdown templates use `#` for reader-facing comments, not headings.
  return text.split("\n").map((line) =>
    runningMarkdownProse(line.replace(/^\s*#\s?/, "")).replace(
      DOTTED_IDENTIFIER,
      "",
    )
  );
}

Deno.test("the product name remains lowercase across every shipped surface", async () => {
  const offenders: string[] = [];
  const exceptionCounts = new Map<string, number>();
  for (const rel of await shippedSourceFiles()) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const literal of stringLiterals(source)) {
      const exception = SOURCE_PRODUCT_IDENTIFIER_EXCEPTIONS.find((entry) =>
        entry.path === rel && entry.literal === literal.text
      );
      if (exception !== undefined) {
        exceptionCounts.set(rel, (exceptionCounts.get(rel) ?? 0) + 1);
        continue;
      }
      for (
        const finding of bannedPhraseLines(
          rel,
          literal.text,
          CAPITALIZED_PRODUCT,
        )
      ) {
        offenders.push(`${finding} (literal starts at ${literal.line})`);
      }
    }
  }
  for (const exception of SOURCE_PRODUCT_IDENTIFIER_EXCEPTIONS) {
    const actual = exceptionCounts.get(exception.path) ?? 0;
    if (actual !== exception.count) {
      offenders.push(
        `${exception.path}: expected ${exception.count} exact ${exception.literal} ` +
          `identifier fragments, found ${actual} (${exception.reason})`,
      );
    }
  }
  for (const rel of await shippedTextFiles()) {
    for (const prose of await textProse(rel)) {
      offenders.push(...bannedPhraseLines(rel, prose, CAPITALIZED_PRODUCT));
    }
  }
  assertEquals(
    offenders,
    [],
    "write the product name as lowercase discern; only Discern-owned, " +
      `Discern-authored, and identifier compounds are exempt:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("the product-name detector preserves exact allowed compounds", () => {
  assertEquals("Discern checks".match(CAPITALIZED_PRODUCT)?.[0], "Discern");
  assertEquals(
    "Discern-owned Discern-authored DiscernResult Discern${Type}".match(
      CAPITALIZED_PRODUCT,
    ),
    null,
  );
});

Deno.test("glossary case choices govern shipped running prose", async () => {
  const rules = runningProseCaseRules();
  const offenders: string[] = [];
  const inspect = (rel: string, text: string, origin = ""): void => {
    for (const rule of rules) {
      const findings = bannedPhraseLines(
        rel,
        text,
        new RegExp(rule.pattern, "g"),
      );
      offenders.push(
        ...findings.map((finding) =>
          `${finding}${origin} — use ${rule.expected}`
        ),
      );
    }
  };
  for (const rel of await shippedSourceFiles()) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const literal of stringLiterals(source)) {
      // Tiny literals are labels, enum values, aliases, and other identifiers;
      // human-facing source prose has enough context to establish casing.
      if (literal.text.trim().split(/\s+/).length < 4) continue;
      inspect(
        rel,
        runningMarkdownProse(literal.text).replace(DOTTED_IDENTIFIER, ""),
        ` (literal starts at ${literal.line})`,
      );
    }
  }
  for (const rel of await shippedTextFiles()) {
    for (const prose of await textProse(rel)) inspect(rel, prose);
  }
  assertEquals(
    offenders,
    [],
    `capitalize Proof and its family only; lowercase other glossary concepts in running prose:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("the glossary case detector rejects both directions", () => {
  const rules = runningProseCaseRules();
  const text = "Run the Gate and inspect the proof line.";
  const hits = rules.filter((rule) => new RegExp(rule.pattern).test(text));
  assertEquals(hits.map((rule) => rule.term).sort(), ["Gate", "Proof"]);
});

Deno.test("lowercase glossary terms stay lowercase after capitalized lead-ins", () => {
  const misses = runningProseCaseRules()
    .filter((rule) =>
      rule.expected ===
        rule.term.charAt(0).toLowerCase() + rule.term.slice(1)
    )
    .flatMap((rule) =>
      [
        `The ${rule.term} remains visible.`,
        `_The ${rule.term} remains visible._`,
      ].filter((text) => !new RegExp(rule.pattern).test(text))
        .map((text) => `${rule.term}: ${text}`)
    );
  assertEquals(
    misses,
    [],
    `capitalized lead-ins escaped the running-prose detector: ${
      misses.join(", ")
    }`,
  );
});

Deno.test("lowercase glossary terms retain case at true prose starts", () => {
  const falseHits = runningProseCaseRules()
    .filter((rule) =>
      rule.expected ===
        rule.term.charAt(0).toLowerCase() + rule.term.slice(1)
    )
    .flatMap((rule) =>
      [
        `${rule.term} remains visible.`,
        `Proof: ${rule.term} remains visible.`,
        `Proof: _${rule.term} remains visible._`,
      ].filter((text) => new RegExp(rule.pattern).test(text))
        .map((text) => `${rule.term}: ${text}`)
    );
  assertEquals(
    falseHits,
    [],
    `true prose starts were rejected: ${falseHits.join(", ")}`,
  );
});

Deno.test("the glossary case detector leaves dotted contract fields alone", () => {
  const prose = "Return data.proof and data.proof.line to the caller.".replace(
    DOTTED_IDENTIFIER,
    "",
  );
  const hits = runningProseCaseRules().filter((rule) =>
    new RegExp(rule.pattern).test(prose)
  );
  assertEquals(hits, []);
});

Deno.test("the glossary case detector leaves relay placeholders alone", () => {
  const prose = runningMarkdownProse(
    "Carry <proof> as a named relay fact, not running product prose.",
  );
  const hits = runningProseCaseRules().filter((rule) =>
    new RegExp(rule.pattern).test(prose)
  );
  assertEquals(hits, []);
});

Deno.test("canonical casing respects Markdown structure and ordinary proof", () => {
  const cases = [
    { text: "This is not proof that another file must change.", expected: [] },
    { text: "Several proofs explain the result.", expected: [] },
    { text: "Read [Practice and roles](page.md).", expected: [] },
    { text: "See [Gate and Proof troubleshooting](page.md).", expected: [] },
    { text: "Read [Worktrees and the trunk](page.md).", expected: [] },
    {
      text:
        "For a closer look at the everyday relationship between you, the agent, and the project, read [Practice and roles](../20-understand/practice-and-roles.md).",
      expected: [],
    },
    {
      text:
        "For a specific evidence or output problem, see [Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md). The [result reference](../30-reference/mcp-and-results.md) explains diagnostic fields.",
      expected: [],
    },
    {
      text:
        "Status requires a discern project. Linked-worktree lifecycle fields require a Git repository with at least one commit. For a practical introduction, read [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md).",
      expected: [],
    },
    {
      text: "Read [**Standard** examples][guide].\n\n[guide]: /the-Gate",
      expected: [],
    },
    { text: "[Read the Gate](page.md).", expected: ["Gate"] },
    {
      text: "Read [Review the **Standard**][guide].\n\n[guide]: page.md",
      expected: ["Standard"],
    },
    { text: "Run the **Gate**.", expected: ["Gate"] },
    { text: "The _Worktrees_ remain visible.", expected: ["Worktree"] },
    {
      text: "Run the Gate and inspect the proof line.",
      expected: ["Gate", "Proof"],
    },
    { text: "Read the proof notes.", expected: ["Proof"] },
    { text: "Read the Proof notes.", expected: [] },
    { text: "# Read the Gate\n\nGate remains visible.", expected: [] },
    { text: "A label\n\nGate remains visible.", expected: [] },
    {
      text: "Read ``the Gate and `proof note` `` before continuing.",
      expected: [],
    },
    { text: "    Read the Gate and proof note.\n", expected: [] },
    { text: "Read <https://example.test/the-Gate> for details.", expected: [] },
  ];
  for (const { text, expected } of cases) {
    const prose = runningMarkdownProse(text).replace(DOTTED_IDENTIFIER, "");
    const actual = runningProseCaseRules().filter((rule) =>
      new RegExp(rule.pattern).test(prose)
    ).map((rule) => rule.term).sort();
    assertEquals(actual, expected, text);
  }
});

Deno.test("Markdown casing findings retain authored line numbers", () => {
  const source =
    "---\ntitle: Metadata\n---\n\n# Read the Gate\n\nRead [the **Gate**](page.md).\n";
  const rule = runningProseCaseRules().find((entry) => entry.term === "Gate");
  if (rule === undefined) throw new Error("Gate is missing from the glossary");
  const findings = bannedPhraseLines(
    "fixture.md",
    runningMarkdownProse(source),
    new RegExp(rule.pattern, "g"),
  );
  assertEquals(findings, ['fixture.md:7 contains "the Gate"']);
});
