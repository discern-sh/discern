/**
 * The receipt renderer's diff-stability contract: `renderReceiptMarkdown` is a
 * pure function of the envelope pieces (the gathered git facts + `steps[]`), so
 * fixed inputs pin the EXACT markdown — same tree, same result → same receipt
 * (durations excepted, and durations here are fixed inputs too). A wording or
 * layout change must show up as a deliberate edit to these golden strings.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderReceiptMarkdown } from "../src/engine/gate/receipt_render.ts";
import type { StepResult } from "../src/shared/result.ts";
import type { Receipt } from "../src/shared/result_schemas.ts";

type ReceiptFacts = Omit<Receipt, "markdown">;

const FACTS: ReceiptFacts = {
  branch: "agent/upload-retry",
  trunk: "main",
  commits: [
    { sha: "abc1234", subject: "Add retry to upload path" },
    { sha: "def5678", subject: "Cover the retry with a test" },
  ],
  commits_total: 2,
  files: [
    { path: "src/upload.ts", status: "M", added: 42, removed: 7 },
    { path: "assets/logo.png", status: "A", added: null, removed: null },
  ],
  files_total: 2,
  insertions: 42,
  deletions: 7,
};

const STEPS: StepResult[] = [
  {
    step: {
      kind: "job",
      label: "format",
      disposition: "run",
      note: "deno fmt",
      group: "Fix",
    },
    outcome: "ok",
    durationS: 1,
  },
  {
    step: {
      kind: "job",
      label: "test",
      disposition: "run",
      note: "deno task test",
      group: "Check & test",
    },
    outcome: "ok",
    durationS: 41,
  },
  {
    step: {
      kind: "scope-gate",
      label: "scope:web",
      disposition: "skip",
      note: "scope unchanged",
      group: "Scope gates",
    },
    outcome: "skipped",
    durationS: 0,
  },
];

Deno.test("receipt render: fixed facts + steps pin the exact markdown", () => {
  const expected = [
    "### Receipt — `agent/upload-retry`",
    "",
    "All gate checks passed on a clean tree · diff vs `main`: 2 files (+42 −7)",
    "",
    "| ran | command | result |",
    "| --- | --- | --- |",
    "| format | `deno fmt` | ok · 1s |",
    "| test | `deno task test` | ok · 41s |",
    "| scope:web | scope unchanged | skipped |",
    "",
    "Commits (2):",
    "",
    "- `abc1234` Add retry to upload path",
    "- `def5678` Cover the retry with a test",
    "",
    "Files (2):",
    "",
    "- `src/upload.ts` (+42 −7)",
    "- `assets/logo.png` (binary)",
    "",
    "Inspect: `git diff main...agent/upload-retry`",
  ].join("\n");
  assertEquals(renderReceiptMarkdown(FACTS, STEPS), expected);
});

Deno.test("receipt render: is deterministic across calls", () => {
  assertEquals(
    renderReceiptMarkdown(FACTS, STEPS),
    renderReceiptMarkdown(FACTS, STEPS),
  );
});

Deno.test("receipt render: capped lists report the uncounted remainder", () => {
  const facts: ReceiptFacts = {
    ...FACTS,
    commits: FACTS.commits,
    commits_total: 12,
    files: FACTS.files,
    files_total: 25,
  };
  const md = renderReceiptMarkdown(facts, STEPS);
  assertStringIncludes(md, "Commits (12):");
  assertStringIncludes(md, "- … and 10 more");
  assertStringIncludes(md, "Files (25):");
  assertStringIncludes(md, "- … and 23 more");
});

Deno.test("receipt render: a pipe in a command cannot break the table", () => {
  const steps: StepResult[] = [
    {
      step: {
        kind: "job",
        label: "lint",
        disposition: "run",
        note: "grep -c TODO src | sort",
        group: "Check & test",
      },
      outcome: "ok",
      durationS: 2,
    },
  ];
  const md = renderReceiptMarkdown(FACTS, steps);
  assertStringIncludes(md, "| lint | `grep -c TODO src \\| sort` | ok · 2s |");
});

Deno.test("receipt render: a no-op gate is stated honestly", () => {
  const md = renderReceiptMarkdown(FACTS, []);
  assertStringIncludes(
    md,
    "(no capability or check is wired — nothing ran)",
  );
});
