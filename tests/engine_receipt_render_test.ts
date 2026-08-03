/**
 * The receipt renderer's diff-stability contract: `renderReceiptMarkdown` and
 * `renderReceiptLine` are pure functions of the envelope pieces (the gathered
 * git facts + `steps[]` + standards), so fixed inputs pin the EXACT output —
 * same tree, same result → same receipt (durations excepted, and durations here
 * are fixed inputs too). A wording or layout change must show up as a deliberate
 * edit to these golden strings.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  renderLandingReceiptLine,
  renderReceiptLine,
  renderReceiptMarkdown,
} from "../src/engine/gate/receipt_render.ts";
import { renderDoneTtySummary } from "../src/engine/gate/done_tty.ts";
import {
  createGateTtyProgress,
  renderGateTtyProgressTable,
  renderGateTtyStatus,
  renderGateTtyTable,
} from "../src/engine/gate/gate_tty.ts";
import { dimBlock, type StepResult } from "../src/shared/result.ts";
import { makeOut, outSink } from "../src/engine/output.ts";
import { displayWidth } from "../src/lib/text.ts";
import type { GatePlan } from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import type {
  GateStandard,
  Receipt,
  StandardsLimitsData,
} from "../src/shared/result_schemas.ts";

type ReceiptFacts = Omit<Receipt, "markdown" | "line">;

const SGR = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "u",
);
const SGR_GLOBAL = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "gu",
);

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
      label: "lint",
      disposition: "run",
      note: "deno lint",
      group: "Check & test",
    },
    outcome: "ok",
    durationS: 0,
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

const PLAN: GatePlan = {
  groups: [
    {
      stage: "fix",
      mode: "serial",
      heading: "Applying fixers...",
      display: "Fix",
      jobs: [{
        label: "format",
        command: "deno fmt",
        kind: "known",
        reportStage: "fix",
        willRun: true,
      }],
    },
    {
      stage: "check/test",
      mode: "parallel",
      heading: "Checking and testing...",
      display: "Check & test",
      jobs: [
        {
          label: "lint",
          command: "deno lint",
          kind: "known",
          reportStage: "check",
          willRun: true,
        },
        {
          label: "test",
          command: "deno task test",
          kind: "known",
          reportStage: "test",
          willRun: true,
        },
      ],
    },
    {
      stage: "scope_gates",
      mode: "parallel",
      heading: "Running gates for changed scopes...",
      display: "Scope gates",
      jobs: [{
        label: "scope:web",
        command: "deno task web",
        kind: "scope-gate",
        reportStage: "scope_gates",
        willRun: false,
      }],
    },
  ],
  standardsLimitsCheck: true,
  guidanceCheck: true,
  skillsCheck: true,
  mergeCheck: true,
  trackedArtifactsCheck: true,
  scopesChanged: [],
};

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
    "| lint | `deno lint` | ok · <1s |",
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
    "| lint | `deno lint` | ok · <1s |",
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

Deno.test("receipt render: a timed sub-second standard says <1s", () => {
  const md = renderReceiptMarkdown(
    FACTS,
    STEPS,
    [{ ...HELD, duration_s: 0 }],
    VERIFIED,
  );
  assertStringIncludes(md, "- coverage 83 (floor 80, held) · <1s");
});

Deno.test("receipt render: an untimed run claims no duration at all", () => {
  const untimed: StepResult[] = [
    {
      step: { kind: "job", label: "smoke", disposition: "run", note: "true" },
      outcome: "ok",
    },
  ];
  assertStringIncludes(
    renderReceiptMarkdown(FACTS, untimed),
    "| smoke | `true` | ok |",
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

Deno.test("done TTY render: fixed steps pin the plain 80-column summary", () => {
  const receipt: Receipt = {
    ...FACTS,
    line: renderReceiptLine(FACTS),
    markdown: renderReceiptMarkdown(FACTS, STEPS),
  };
  const expected = [
    "  JOB                 COMMAND                                    RESULT",
    "  ──────────────────────────────────────────────────────────────────────────────",
    "  format              deno fmt                                   ok · 1s",
    "  ──────────────────────────────────────────────────────────────────────────────",
    "  lint                deno lint                                  ok · <1s",
    "  ──────────────────────────────────────────────────────────────────────────────",
    "  test                deno task test                             ok · 41s",
    "  ──────────────────────────────────────────────────────────────────────────────",
    "  scope:web           scope unchanged                            skipped",
    "  ──────────────────────────────────────────────────────────────────────────────",
    "",
    "  │  ",
    "  │  Receipt: gate passed on agent/upload-retry @ abc1234def01 · 2 files +42",
    "  │  −7 vs main · full receipt: discern status --verbose",
    "  │  ",
  ].join("\n");
  assertEquals(
    renderDoneTtySummary(STEPS, receipt, { width: 80, color: false }),
    expected,
  );
});

Deno.test("done TTY render: color paints success and the receipt without widening lines", () => {
  const receipt: Receipt = {
    ...FACTS,
    line: renderReceiptLine(FACTS),
    markdown: renderReceiptMarkdown(FACTS, STEPS),
  };
  const rendered = renderDoneTtySummary(STEPS, receipt, {
    width: 80,
    color: true,
  });
  assertStringIncludes(rendered, "\x1b[38;2;52;211;121mok");
  assertStringIncludes(rendered, "\x1b[48;2;12;29;27m");
  for (const line of rendered.split("\n")) {
    assert(
      displayWidth(line) <= 80,
      `TTY line is ${displayWidth(line)} columns: ${line}`,
    );
  }
});

Deno.test("gate TTY render: a narrow terminal stacks commands below each result", () => {
  const rendered = renderGateTtyTable(STEPS, {
    width: 40,
    color: false,
  });
  assertStringIncludes(rendered, "JOB / RESULT");
  assertStringIncludes(rendered, "format  ok · 1s");
  assertStringIncludes(rendered, "    deno fmt");
  assertEquals(rendered.includes("\x1b["), false);
});

Deno.test("gate TTY progress: planned rows move from pending through running to settled", () => {
  const initial = renderGateTtyProgressTable(
    PLAN.groups,
    new Set(),
    new Map(),
    { width: 80, color: false },
  );
  assertStringIncludes(initial, "format");
  assertStringIncludes(initial, "deno fmt");
  assertStringIncludes(initial, "pending");
  assertStringIncludes(initial, "scope:web");
  assertStringIncludes(initial, "deno task web");
  assertStringIncludes(initial, "skipped");

  const result: JobResult = {
    label: "format",
    status: "ok",
    code: 0,
    durationS: 1,
    outputLines: 0,
    errorLikeLines: 0,
  };
  const updated = renderGateTtyProgressTable(
    PLAN.groups,
    new Set(["lint"]),
    new Map([["format", result]]),
    { width: 80, color: false },
  );
  assertStringIncludes(updated, "ok · 1s");
  assertStringIncludes(updated, "running");
  assertStringIncludes(updated, "test");
  assertStringIncludes(updated, "pending");
});

Deno.test("gate TTY progress: controller redraws in place and leaves no color SGR in no-color mode", async () => {
  const writes: string[] = [];
  const progress = createGateTtyProgress(
    (value) => writes.push(value),
    { width: 80, color: false },
  );
  progress.start(PLAN.groups);
  assertStringIncludes(writes[0] ?? "", "format");
  assertStringIncludes(writes[0] ?? "", "pending");

  progress.started({ label: "format", command: "deno fmt" });
  await Promise.resolve();
  assertStringIncludes(writes[writes.length - 1] ?? "", "\x1b[");
  assertStringIncludes(writes[writes.length - 1] ?? "", "running");

  progress.settled({
    label: "format",
    status: "ok",
    code: 0,
    durationS: 1,
    outputLines: 0,
    errorLikeLines: 0,
  });
  await Promise.resolve();
  assertStringIncludes(writes[writes.length - 1] ?? "", "ok · 1s");
  assertEquals(SGR.test(writes.join("")), false);

  progress.complete(STEPS);
  assertStringIncludes(writes[writes.length - 1] ?? "", "scope unchanged");
});

Deno.test("gate TTY render: color changes styling only and every line stays within budget", () => {
  const outcomes: StepResult[] = [
    ...STEPS,
    {
      step: {
        kind: "job",
        label: "types",
        disposition: "run",
        note: "deno check a/long/path/to/the/project/entrypoint.ts",
        group: "Check",
      },
      outcome: "failed",
      durationS: 0.25,
    },
    {
      step: {
        kind: "job",
        label: "lint#2",
        disposition: "run",
        note: "deno lint",
        group: "Check",
      },
      outcome: "cancelled",
      durationS: 0.1,
    },
  ];
  const options = { width: 52, color: false };
  const plain = `${renderGateTtyTable(outcomes, options)}\n${
    renderGateTtyStatus(
      "Fix and check stages passed. Build and test stages did not run.",
      "ok",
      options,
    )
  }`;
  const colored = `${
    renderGateTtyTable(outcomes, { ...options, color: true })
  }\n${
    renderGateTtyStatus(
      "Fix and check stages passed. Build and test stages did not run.",
      "ok",
      { ...options, color: true },
    )
  }`;
  const stripSgr = (value: string): string => value.replaceAll(SGR_GLOBAL, "");
  assertEquals(stripSgr(colored), plain);
  assertStringIncludes(colored, "\x1b[31mfailed");
  assertStringIncludes(colored, "\x1b[33mcancelled");
  for (const line of colored.split("\n")) {
    assert(
      displayWidth(line) <= options.width,
      `gate TTY line is ${displayWidth(line)} columns: ${line}`,
    );
  }
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

Deno.test("landing receipt line records each canonical consent source", () => {
  const line = renderReceiptLine(FACTS);
  assertEquals(
    renderLandingReceiptLine(line, { source: "conversation" }),
    `${line} · landed with conversation consent`,
  );
  assertEquals(
    renderLandingReceiptLine(line, {
      source: "standing-grant",
      scopes: ["map", "site"],
    }),
    `${line} · landed under standing grant: map, site`,
  );
  assertEquals(
    renderLandingReceiptLine(line, { source: "effort-grant" }),
    `${line} · landed under effort grant`,
  );
});

// ── the page's terminal treatment ───────────────────────────────────────────
//
// Every TTY print site (`status --verbose`, `done`'s success tail, `accept`'s
// landing record) routes the page through `dimBlock`, so the quoted markdown
// reads as secondary against the narration around it. The CLI-level suites run
// colourless (no TTY), where dim is identity — these pin the colour-ON contract.

Deno.test("dimBlock wraps every non-empty line and leaves blank lines bare", () => {
  assertEquals(
    dimBlock("### Receipt\n\n| ran |", (s) => `[${s}]`),
    "[### Receipt]\n\n[| ran |]",
  );
});

Deno.test("dimBlock with a colour-off dim returns the block unchanged", () => {
  const page = renderReceiptMarkdown(FACTS, STEPS);
  assertEquals(dimBlock(page, (s) => s), page);
});

Deno.test("a receipt page dims per line under the real ANSI palette", () => {
  const dim = outSink(makeOut(true)).dim;
  const page = renderReceiptMarkdown(FACTS, STEPS);
  const block = dimBlock(page, dim);
  for (const line of block.split("\n")) {
    if (line === "") {
      continue;
    }
    assertEquals(line.startsWith("\x1b[2m"), true, `undimmed line: ${line}`);
    assertEquals(line.endsWith("\x1b[0m"), true, `unreset line: ${line}`);
  }
  // Attributes never straddle a newline: stripping the codes recovers the page.
  assertEquals(
    block.replaceAll("\x1b[2m", "").replaceAll("\x1b[0m", ""),
    page,
  );
});
