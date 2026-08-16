/**
 * The proof renderer's diff-stability contract: `renderProofMarkdown` and
 * `renderProofLine` are pure functions of the envelope pieces (the gathered
 * git facts + `steps[]` + standards), so fixed inputs pin the EXACT output —
 * same tree, same result → same proof (durations excepted, and durations here
 * are fixed inputs too). A wording or layout change must show up as a deliberate
 * edit to these golden strings.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  renderLandingProofLine,
  renderProofLine,
  renderProofMarkdown,
} from "../src/engine/gate/proof_render.ts";
import { renderDoneTtySummary } from "../src/engine/gate/done_tty.ts";
import {
  renderGateTtyStatus,
  renderGateTtyTable,
} from "../src/engine/gate/gate_tty.ts";
import {
  dimBlock,
  type StepResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { makeOut, outSink } from "../src/engine/output.ts";
import { displayWidth } from "../src/lib/text.ts";
import type {
  GateStandard,
  Proof,
  StandardsLimitsData,
} from "../src/shared/result_schemas.ts";
import {
  LANDING_CONSENT_SOURCES,
  type LandingConsent,
  type LandingConsentSource,
} from "../src/shared/consent.ts";

type ProofFacts = Omit<Proof, "markdown" | "line">;

const SGR = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "u",
);
const SGR_GLOBAL = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "gu",
);
const stripSgr = (value: string): string => value.replaceAll(SGR_GLOBAL, "");
const PLAIN_TERMINAL = makeOut(false).terminal;
const COLOR_TERMINAL = makeOut(true).terminal;
const FACTS: ProofFacts = {
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
      label: verbatimStepLabel("format"),
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
      label: verbatimStepLabel("lint"),
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
      label: verbatimStepLabel("test"),
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
      label: verbatimStepLabel("scope:web"),
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

Deno.test("proof render: fixed facts + steps pin the exact page", () => {
  const expected = [
    "### Proof — `agent/upload-retry`",
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
  assertEquals(renderProofMarkdown(FACTS, STEPS), expected);
});

Deno.test("proof render: standards render before the job table", () => {
  const expected = [
    "### Proof — `agent/upload-retry`",
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
    renderProofMarkdown(FACTS, STEPS, [HELD], VERIFIED),
    expected,
  );
});

Deno.test("proof render: a timed sub-second standard says <1s", () => {
  const md = renderProofMarkdown(
    FACTS,
    STEPS,
    [{ ...HELD, duration_s: 0 }],
    VERIFIED,
  );
  assertStringIncludes(md, "- coverage 83 (floor 80, held) · <1s");
});

Deno.test("proof render: an untimed run claims no duration at all", () => {
  const untimed: StepResult[] = [
    {
      step: {
        kind: "job",
        label: verbatimStepLabel("smoke"),
        disposition: "run",
        note: "true",
      },
      outcome: "ok",
    },
  ];
  assertStringIncludes(
    renderProofMarkdown(FACTS, untimed),
    "| smoke | `true` | ok |",
  );
});

Deno.test("proof render: is deterministic across calls", () => {
  assertEquals(
    renderProofMarkdown(FACTS, STEPS),
    renderProofMarkdown(FACTS, STEPS),
  );
});

Deno.test("proof render: a pipe in a command cannot break the table", () => {
  const steps: StepResult[] = [
    {
      step: {
        kind: "job",
        label: verbatimStepLabel("lint"),
        disposition: "run",
        note: "grep -c TODO src | sort",
        group: "Check & test",
      },
      outcome: "ok",
      durationS: 2,
    },
  ];
  const md = renderProofMarkdown(FACTS, steps);
  assertStringIncludes(md, "| lint | `grep -c TODO src \\| sort` | ok · 2s |");
});

Deno.test("proof render: a no-op gate is stated honestly", () => {
  const md = renderProofMarkdown(FACTS, []);
  assertStringIncludes(
    md,
    "(no job is wired — nothing ran)",
  );
});

Deno.test("done TTY render: the package workflow leads into a truthful receipt", () => {
  const proof: Proof = {
    ...FACTS,
    line: renderProofLine(FACTS),
    markdown: renderProofMarkdown(FACTS, STEPS),
  };
  const rendered = renderDoneTtySummary(
    STEPS,
    proof,
    { width: 80, terminal: PLAIN_TERMINAL },
    [],
    { status: "recorded" },
  );
  for (
    const fact of [
      "Gate progress",
      "[100%]",
      "✓ Complete",
      "format [passed]",
      "Run: deno fmt",
      "passed in 1s",
      "lint [passed]",
      "test [passed]",
      "scope:web [skipped]",
      "Receipt: Gate proof",
      "[PASS]",
      "3 passed, 1 skipped",
      "Proof record",
      "recorded",
    ]
  ) {
    assertStringIncludes(rendered, fact);
  }
  assertEquals(rendered.split("\n").at(-1), proof.line);
  assert(rendered.indexOf("Gate progress") < rendered.indexOf("Receipt"));
});

Deno.test("done TTY render: color paints success and the proof without widening lines", () => {
  const proof: Proof = {
    ...FACTS,
    line: renderProofLine(FACTS),
    markdown: renderProofMarkdown(FACTS, STEPS),
  };
  const rendered = renderDoneTtySummary(
    STEPS,
    proof,
    {
      width: 80,
      terminal: COLOR_TERMINAL,
    },
    [],
    { status: "recorded" },
  );
  const plain = renderDoneTtySummary(
    STEPS,
    proof,
    {
      width: 80,
      terminal: PLAIN_TERMINAL,
    },
    [],
    { status: "recorded" },
  );
  assert(SGR.test(rendered));
  assertEquals(stripSgr(rendered), plain);
  for (
    const line of rendered.split("\n").filter((line) => line !== proof.line)
  ) {
    assert(
      displayWidth(line) <= 80,
      `TTY line is ${displayWidth(line)} columns: ${line}`,
    );
  }
});

Deno.test("gate TTY render: a narrow terminal wraps commands without losing facts", () => {
  const rendered = renderGateTtyTable(STEPS, {
    width: 40,
    terminal: PLAIN_TERMINAL,
  });
  assertStringIncludes(rendered, "Gate progress");
  assertStringIncludes(rendered, "[100%]");
  assertStringIncludes(rendered, "✓ Complete");
  assertStringIncludes(rendered, "format [passed]");
  assertStringIncludes(rendered, "Run: deno fmt");
  assertStringIncludes(rendered, "passed\nin 1s");
  assertStringIncludes(rendered, "scope:web [skipped]");
  assertEquals(rendered.includes("\x1b["), false);
});

Deno.test("gate TTY render: color changes styling only and every line stays within budget", () => {
  const outcomes: StepResult[] = [
    ...STEPS,
    {
      step: {
        kind: "job",
        label: verbatimStepLabel("types"),
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
        label: verbatimStepLabel("lint#2"),
        disposition: "run",
        note: "deno lint",
        group: "Check",
      },
      outcome: "cancelled",
      durationS: 0.1,
    },
  ];
  const options = { width: 52, terminal: PLAIN_TERMINAL };
  const plain = `${renderGateTtyTable(outcomes, options)}\n${
    renderGateTtyStatus(
      "Fix and check stages passed. Build and test stages did not run.",
      "ok",
      options,
    )
  }`;
  const colored = `${
    renderGateTtyTable(outcomes, { ...options, terminal: COLOR_TERMINAL })
  }\n${
    renderGateTtyStatus(
      "Fix and check stages passed. Build and test stages did not run.",
      "ok",
      { ...options, terminal: COLOR_TERMINAL },
    )
  }`;
  assertEquals(stripSgr(colored), plain);
  assert(SGR.test(colored));
  assertStringIncludes(stripSgr(colored), "types [failed]");
  assertStringIncludes(stripSgr(colored), "lint#2 [cancelled]");
  for (const line of colored.split("\n")) {
    assert(
      displayWidth(line) <= options.width,
      `gate TTY line is ${displayWidth(line)} columns: ${line}`,
    );
  }
});

Deno.test("proof line: fixed facts pin the exact sentence", () => {
  assertEquals(
    renderProofLine(FACTS),
    "Proof: gate passed on agent/upload-retry @ abc1234def01 · " +
      "2 files +42 −7 vs main · full proof: discern status --verbose",
  );
});

Deno.test("proof line: a single file reads in the singular", () => {
  const line = renderProofLine({
    ...FACTS,
    files_total: 1,
    insertions: 5,
    deletions: 0,
  });
  assertStringIncludes(line, "1 file +5 −0 vs main");
});

Deno.test("proof line: held standards claim one segment", () => {
  assertStringIncludes(
    renderProofLine(FACTS, [HELD], VERIFIED),
    "· standards held ·",
  );
});

Deno.test("proof line: improved and deferred standards are counted", () => {
  const improved: GateStandard = {
    ...HELD,
    name: "instruction_words",
    verdict: "improved",
  };
  const deferred: GateStandard = {
    name: "bundle_size",
    direction: "down",
    limit: 1024,
    measurement: "deferred",
  };
  assertStringIncludes(
    renderProofLine(FACTS, [HELD, improved, deferred], VERIFIED),
    "· standards held, 1 improved, 1 deferred ·",
  );
});

Deno.test("proof line: all standards deferred is stated as such", () => {
  const deferred: GateStandard = {
    name: "bundle_size",
    direction: "down",
    limit: 1024,
    measurement: "deferred",
  };
  assertStringIncludes(
    renderProofLine(FACTS, [deferred], VERIFIED),
    "· standards deferred (1) ·",
  );
});

Deno.test("proof line: unverified limits are disclosed loudly", () => {
  assertStringIncludes(
    renderProofLine(FACTS, [HELD], {
      status: "unverified",
      trunk: "main",
      reason: "trunk config unavailable",
    }),
    "· standards UNVERIFIED ·",
  );
});

Deno.test("proof line: no standards configured claims nothing", () => {
  const line = renderProofLine(FACTS, []);
  assertEquals(line.includes("standards"), false);
});

Deno.test("landing proof line records each canonical consent source", () => {
  const line = renderProofLine(FACTS);
  const cases = {
    conversation: {
      consent: { source: "conversation" },
      expected: `${line} · landed with conversation consent`,
    },
    "standing-grant": {
      consent: { source: "standing-grant", scopes: ["map", "site"] },
      expected: `${line} · landed under standing grant: map, site`,
    },
    "effort-grant": {
      consent: { source: "effort-grant" },
      expected: `${line} · landed under effort grant`,
    },
  } satisfies Record<
    LandingConsentSource,
    { readonly consent: LandingConsent; readonly expected: string }
  >;

  assertEquals(Object.keys(cases).sort(), [...LANDING_CONSENT_SOURCES].sort());
  for (const source of LANDING_CONSENT_SOURCES) {
    const testCase = cases[source];
    assertEquals(
      renderLandingProofLine(line, testCase.consent),
      testCase.expected,
      `${source} must report its successful landing evidence`,
    );
  }
});

// ── the page's terminal treatment ───────────────────────────────────────────
//
// Every TTY print site (`status --verbose`, `done`'s success tail, `accept`'s
// landing record) routes the page through `dimBlock`, so the quoted markdown
// reads as secondary against the narration around it. The CLI-level suites run
// colourless (no TTY), where dim is identity — these pin the colour-ON contract.

Deno.test("dimBlock wraps every non-empty line and leaves blank lines bare", () => {
  assertEquals(
    dimBlock("### Proof\n\n| ran |", (s) => `[${s}]`),
    "[### Proof]\n\n[| ran |]",
  );
});

Deno.test("dimBlock with a colour-off dim returns the block unchanged", () => {
  const page = renderProofMarkdown(FACTS, STEPS);
  assertEquals(dimBlock(page, (s) => s), page);
});

Deno.test("a proof page applies the package muted role per line", () => {
  const dim = outSink(makeOut(true)).dim;
  const page = renderProofMarkdown(FACTS, STEPS);
  const block = dimBlock(page, dim);
  assertEquals(
    block.split("\n"),
    page.split("\n").map((line) =>
      line === "" ? "" : COLOR_TERMINAL.role(line, "muted")
    ),
  );
});
