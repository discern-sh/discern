/**
 * The receipt renderer's diff-stability contract: `renderReceiptMarkdown` and
 * `renderReceiptLine` are pure functions of the envelope pieces (the gathered
 * git facts + `steps[]` + standards), so fixed inputs pin the EXACT output —
 * same tree, same result → same receipt (durations excepted, and durations here
 * are fixed inputs too). A wording or layout change must show up as a deliberate
 * edit to these golden strings.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  renderReceiptLine,
  renderReceiptMarkdown,
} from "../src/engine/gate/receipt_render.ts";
import type { StepResult } from "../src/shared/result.ts";
import type {
  GateStandard,
  Receipt,
  StandardsLimitsData,
} from "../src/shared/result_schemas.ts";

type ReceiptFacts = Omit<Receipt, "markdown" | "line">;

const FACTS: ReceiptFacts = {
  branch: "agent/upload-retry",
  trunk: "main",
  head: "abc1234def01",
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

const HELD: GateStandard = {
  name: "coverage",
  direction: "up",
  limit: 80,
  measurement: "measured",
  value: 83,
  verdict: "held",
  duration_s: 3,
};

const VERIFIED: StandardsLimitsData = { status: "verified", trunk: "main" };

Deno.test("receipt render: fixed facts + steps pin the exact page", () => {
  const expected = [
    "### Receipt — `agent/upload-retry`",
    "",
    "All gate checks passed on a clean tree at `abc1234def01` · diff vs `main`: 2 files +42 −7",
    "",
    "| ran | command | result |",
    "| --- | --- | --- |",
    "| format | `deno fmt` | ok · 1s |",
    "| test | `deno task test` | ok · 41s |",
    "| scope:web | scope unchanged | skipped |",
    "",
    "Inspect: `git diff main...agent/upload-retry`",
  ].join("\n");
  assertEquals(renderReceiptMarkdown(FACTS, STEPS), expected);
});

Deno.test("receipt render: standards render before the job table", () => {
  const expected = [
    "### Receipt — `agent/upload-retry`",
    "",
    "All gate checks passed on a clean tree at `abc1234def01` · diff vs `main`: 2 files +42 −7",
    "",
    "Standards (limits verified against `main`):",
    "",
    "- coverage 83 (floor 80, held) · 3s",
    "",
    "| ran | command | result |",
    "| --- | --- | --- |",
    "| format | `deno fmt` | ok · 1s |",
    "| test | `deno task test` | ok · 41s |",
    "| scope:web | scope unchanged | skipped |",
    "",
    "Inspect: `git diff main...agent/upload-retry`",
  ].join("\n");
  assertEquals(
    renderReceiptMarkdown(FACTS, STEPS, [HELD], VERIFIED),
    expected,
  );
});

Deno.test("receipt render: is deterministic across calls", () => {
  assertEquals(
    renderReceiptMarkdown(FACTS, STEPS),
    renderReceiptMarkdown(FACTS, STEPS),
  );
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
    "(no job is wired — nothing ran)",
  );
});

Deno.test("receipt line: fixed facts pin the exact sentence", () => {
  assertEquals(
    renderReceiptLine(FACTS),
    "Receipt: gate passed on agent/upload-retry @ abc1234def01 · " +
      "2 files +42 −7 vs main · full receipt: discern status --verbose",
  );
});

Deno.test("receipt line: a single file reads in the singular", () => {
  const line = renderReceiptLine({
    ...FACTS,
    files_total: 1,
    insertions: 5,
    deletions: 0,
  });
  assertStringIncludes(line, "1 file +5 −0 vs main");
});

Deno.test("receipt line: held standards claim one segment", () => {
  assertStringIncludes(
    renderReceiptLine(FACTS, [HELD], VERIFIED),
    "· standards held ·",
  );
});

Deno.test("receipt line: improved and deferred standards are counted", () => {
  const improved: GateStandard = {
    ...HELD,
    name: "guidance_words",
    verdict: "improved",
  };
  const deferred: GateStandard = {
    name: "bundle_size",
    direction: "down",
    limit: 1024,
    measurement: "deferred",
  };
  assertStringIncludes(
    renderReceiptLine(FACTS, [HELD, improved, deferred], VERIFIED),
    "· standards held, 1 improved, 1 deferred ·",
  );
});

Deno.test("receipt line: all standards deferred is stated as such", () => {
  const deferred: GateStandard = {
    name: "bundle_size",
    direction: "down",
    limit: 1024,
    measurement: "deferred",
  };
  assertStringIncludes(
    renderReceiptLine(FACTS, [deferred], VERIFIED),
    "· standards deferred (1) ·",
  );
});

Deno.test("receipt line: unverified limits are disclosed loudly", () => {
  assertStringIncludes(
    renderReceiptLine(FACTS, [HELD], {
      status: "unverified",
      trunk: "main",
      reason: "trunk config unavailable",
    }),
    "· standards UNVERIFIED ·",
  );
});

Deno.test("receipt line: no standards configured claims nothing", () => {
  const line = renderReceiptLine(FACTS, []);
  assertEquals(line.includes("standards"), false);
});
