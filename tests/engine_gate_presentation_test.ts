/** Closed-set and composition coverage for the Gate's pure CLI presentation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsi } from "discern-design-system/cli";
import {
  createGateTtyProgress,
  renderGateTtyTable,
} from "../src/engine/gate/gate_tty.ts";
import {
  gateRunContext,
  resolveGateRunPolicy,
} from "../src/engine/gate/execute.ts";
import {
  GATE_DIAGNOSTIC_SEVERITY,
  GATE_FAILED_STAGE_LABEL,
  GATE_JOB_STATUS_LABEL,
  GATE_JOB_STEP_STATUS,
  GATE_LANDING_AUTHORITY_PRESENTATION,
  GATE_PLAN_STEP_STATUS,
  GATE_PROOF_CHECK_PRESENTATION,
  GATE_PROOF_RECORD_PRESENTATION,
  GATE_STANDARD_DIRECTION,
  GATE_STANDARD_MEASUREMENT_LABEL,
  GATE_STANDARD_TREND,
  renderGateDiagnostics,
  renderGateFailureSummary,
  renderGatePlan,
  renderGateProof,
  renderGateProofCheck,
  renderGateStandards,
  renderProofLineCli,
} from "../src/engine/gate/presentation.ts";
import {
  renderProofLine,
  renderProofMarkdown,
} from "../src/engine/gate/proof_render.ts";
import type { JobGroup } from "../src/engine/gate/plan.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import {
  type Diagnostic,
  DIAGNOSTIC_SEVERITIES,
  type EnginePlan,
  FAILED_STAGES,
  STEP_DISPOSITIONS,
  STEP_OUTCOMES,
  type StepResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import {
  GATE_PROOF_CHECK_STATUSES,
  type GateData,
  type GateStandard,
  type Proof,
  STANDARD_MEASUREMENTS,
  STANDARD_VERDICTS,
} from "../src/shared/result_schemas.ts";
import { LANDING_AUTHORITY_KINDS } from "../src/shared/consent.ts";
import { displayWidth } from "../src/lib/text.ts";
import { fakeEnv } from "./helpers.ts";

type GateProofRecord = NonNullable<GateData["gate_proof"]>;

/** Construct one explicit terminal context without touching process state. */
function terminal(options: {
  readonly color?: "none" | "ansi16" | "ansi256" | "truecolor";
  readonly unicode?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  readonly stdoutIsTerminal?: boolean;
  readonly ci?: string;
  readonly theme?: "light" | "dark";
} = {}): TerminalContext {
  const color = options.color ?? "none";
  const unicode = options.unicode ?? true;
  const columns = options.columns ?? 80;
  const env: Record<string, string> = {
    TERM: color === "ansi256" || color === "truecolor"
      ? "xterm-256color"
      : "xterm",
    LANG: unicode ? "en_GB.UTF-8" : "C",
    ...(color === "truecolor" ? { COLORTERM: "truecolor" } : {}),
    ...(options.ci === undefined ? {} : { CI: options.ci }),
  };
  return resolveTerminalContext({
    noColor: color === "none",
    env: fakeEnv(env),
    isTerminal: () => options.stdoutIsTerminal ?? true,
    consoleSize: () => ({ columns, rows: options.rows ?? 24 }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
  });
}

/** Mutable injected viewport with explicit sampling and cleanup evidence. */
function observedTerminal(
  initial: { readonly columns: number; readonly rows: number },
): {
  readonly terminal: TerminalContext;
  readonly set: (
    next: { readonly columns: number; readonly rows: number },
  ) => void;
  readonly samples: () => number;
  readonly closes: () => number;
} {
  let size = initial;
  let sampleCount = 0;
  let closeCount = 0;
  const base = terminal(initial);
  return {
    terminal: {
      ...base,
      observeViewport: () => {
        let closed = false;
        return {
          sample: () => {
            if (!closed) sampleCount += 1;
            return size;
          },
          close: () => {
            if (closed) return;
            closed = true;
            closeCount += 1;
          },
        };
      },
    },
    set: (next): void => {
      size = next;
    },
    samples: (): number => sampleCount,
    closes: (): number => closeCount,
  };
}

const PLAIN = terminal();

const GROUP: JobGroup = {
  stage: "check",
  mode: "parallel",
  heading: "Checking...",
  display: "Check",
  jobs: ["format", "lint", "types", "test"].map((label) => ({
    label,
    command: `run ${label}`,
    kind: "known",
    reportStage: "check",
    willRun: true,
  })),
};

const PROOF_FACTS = {
  branch: "agent/gate-components",
  trunk: "main",
  head: "abc1234def01",
  files_total: 2,
  insertions: 42,
  deletions: 7,
} as const;

const PROOF_STEPS: StepResult[] = [{
  step: {
    kind: "job",
    label: verbatimStepLabel("test"),
    disposition: "run",
    note: "deno task test",
    group: "Check & test",
  },
  outcome: "ok",
  durationS: 2,
}, {
  step: {
    kind: "scope-gate",
    label: verbatimStepLabel("scope:site"),
    disposition: "skip",
    note: "scope unchanged",
    group: "Scope gates",
  },
  outcome: "skipped",
}];

const PROOF: Proof = {
  ...PROOF_FACTS,
  line: renderProofLine(PROOF_FACTS),
  markdown: renderProofMarkdown(PROOF_FACTS, PROOF_STEPS),
};

/** Assert two finite key sets are identical without relying on order. */
function assertKeys(
  actual: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  assertEquals(Object.keys(actual).sort(), [...expected].sort());
}

/** Assert every rendered line fits its full terminal width. */
function assertWithinWidth(rendered: string, width: number): void {
  for (const line of rendered.split("\n")) {
    assert(
      displayWidth(line) <= width,
      `line is ${displayWidth(line)} columns at width ${width}: ${line}`,
    );
  }
}

Deno.test("Gate presentation mappings cover every closed typed state", () => {
  assertKeys(GATE_JOB_STEP_STATUS, [...STEP_OUTCOMES, "pending", "running"]);
  assertKeys(GATE_JOB_STATUS_LABEL, [...STEP_OUTCOMES, "pending", "running"]);
  assertKeys(GATE_PLAN_STEP_STATUS, STEP_DISPOSITIONS);
  assertKeys(GATE_FAILED_STAGE_LABEL, FAILED_STAGES);
  assertKeys(GATE_DIAGNOSTIC_SEVERITY, DIAGNOSTIC_SEVERITIES);
  assertKeys(GATE_STANDARD_DIRECTION, ["up", "down"]);
  assertKeys(GATE_STANDARD_TREND, STANDARD_VERDICTS);
  assertKeys(GATE_STANDARD_MEASUREMENT_LABEL, STANDARD_MEASUREMENTS);
  assertKeys(GATE_PROOF_CHECK_PRESENTATION, GATE_PROOF_CHECK_STATUSES);
  assertKeys(GATE_LANDING_AUTHORITY_PRESENTATION, LANDING_AUTHORITY_KINDS);
  assertKeys(
    GATE_PROOF_RECORD_PRESENTATION,
    [
      "recorded",
      "skipped_dirty",
      "skipped_head_moved",
      "unavailable",
      "record_failed",
      "cleared",
      "clear_failed",
    ] satisfies GateProofRecord["status"][],
  );
});

Deno.test("Gate output policy separates live presentation from static transcript timing", () => {
  const live = terminal({ columns: 93, ci: "false" });
  const ci = terminal({ columns: 71, ci: "  TRUE " });
  const pipe = terminal({ columns: 67, stdoutIsTerminal: false });
  const dumb = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "dumb", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 48, rows: 24 }),
  });

  for (const staticStream of [false, true]) {
    const livePolicy = resolveGateRunPolicy(staticStream, {
      kind: "human",
      plain: false,
      terminal: live,
    });
    assertEquals(livePolicy.output.kind, "live-frame");
    assertEquals(livePolicy.capture, "buffered-capped");
    assertEquals(
      livePolicy.output.kind === "live-frame"
        ? livePolicy.output.ttyWidth
        : undefined,
      93,
    );

    const expectedStatic = staticStream ? "static-streamed" : "static-grouped";
    for (
      const surface of [
        { kind: "human" as const, plain: false, terminal: ci },
        { kind: "human" as const, plain: true, terminal: live },
        { kind: "human" as const, plain: false, terminal: pipe },
        { kind: "human" as const, plain: false, terminal: dumb },
      ]
    ) {
      const policy = resolveGateRunPolicy(staticStream, surface);
      assertEquals(policy.output.kind, expectedStatic);
      assertEquals(
        policy.capture,
        staticStream ? "streamed-capped" : "buffered-capped",
      );
    }
  }

  const quiet = resolveGateRunPolicy(true, {
    kind: "quiet-result",
    terminal: live,
  });
  assertEquals(quiet.output.kind, "quiet-result");
  assertEquals(quiet.capture, "buffered-capped");
});

Deno.test("Gate Proof makes landing readiness explicit without claiming consent", () => {
  const authorized = renderGateProof(
    PROOF,
    { status: "recorded" },
    PROOF_STEPS,
    { width: 76, terminal: PLAIN },
    { kind: "authorized", source: "effort-grant" },
  );
  assertStringIncludes(authorized, "Landing authority");
  assertStringIncludes(authorized, "effort-grant");
  assertStringIncludes(authorized, "authorized");

  const conversational = renderGateProof(
    PROOF,
    { status: "recorded" },
    PROOF_STEPS,
    { width: 76, terminal: PLAIN },
    {
      kind: "conversation-required",
      uncovered: [{ path: "src/gate.ts", scopes: ["engine"] }],
    },
  );
  assertStringIncludes(conversational, "conversation required");
  assertStringIncludes(conversational, "1 uncovered");
  assertStringIncludes(conversational, "Landing still needs");
  assertStringIncludes(conversational, "conversation consent");
  assertEquals(conversational.includes("Landing is authorized"), false);
});

Deno.test("Gate presentation renders every failure stage through ResultSummary", () => {
  for (const stage of FAILED_STAGES) {
    const rendered = renderGateFailureSummary(
      "done",
      "The Gate stopped.",
      [],
      { width: 80, terminal: PLAIN },
      stage,
    );
    assertStringIncludes(rendered, "Failed: discern done failed");
    assertStringIncludes(rendered, GATE_FAILED_STAGE_LABEL[stage]);
    assertStringIncludes(rendered, "The Gate stopped.");
  }
});

Deno.test("Gate run context keeps live presentation on full buffered capture", () => {
  const cfg = parseConfigOrThrow([
    "[project]",
    'slug = "gate-live-context"',
    "agents = []",
    "",
    "[instructions]",
    "sources = []",
    "",
    "[gate]",
    "stream = true",
  ].join("\n"));
  const livePolicy = resolveGateRunPolicy(true, {
    kind: "human",
    plain: false,
    terminal: terminal({ columns: 88 }),
  });
  const live = gateRunContext("/tmp/gate-live-context", cfg, livePolicy);
  assertEquals(live.runOpts.stream, false);
  assertEquals(live.runOpts.quiet, true);

  const streamedPolicy = resolveGateRunPolicy(true, {
    kind: "human",
    plain: true,
    terminal: terminal({ columns: 88 }),
  });
  const streamed = gateRunContext(
    "/tmp/gate-live-context",
    cfg,
    streamedPolicy,
  );
  assertEquals(streamed.runOpts.stream, true);
  assertEquals(streamed.runOpts.quiet, false);

  const quietPolicy = resolveGateRunPolicy(true, {
    kind: "quiet-result",
    terminal: terminal({ columns: 88 }),
  });
  const quiet = gateRunContext("/tmp/gate-live-context", cfg, quietPolicy);
  assertEquals(quiet.runOpts.stream, false);
  assertEquals(quiet.runOpts.quiet, true);
});

Deno.test("Gate activity pins lifecycle facts and fits a sanitised partial tail", async () => {
  let tick: (() => void) | undefined;
  let stops = 0;
  const writes: string[] = [];
  const viewport = observedTerminal({ columns: 72, rows: 20 });
  const progress = await createGateTtyProgress(
    (value) => writes.push(value),
    [GROUP],
    {
      width: 72,
      terminal: viewport.terminal,
      tailRows: 2,
      scheduler: {
        repeat(callback, intervalMs): () => void {
          assertEquals(intervalMs, 80);
          tick = callback;
          let stopped = false;
          return (): void => {
            if (stopped) return;
            stopped = true;
            stops += 1;
          };
        },
      },
    },
  );
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);

  progress.started(lint);
  progress.output({ kind: "line", label: "lint", text: "older line" });
  progress.output({
    kind: "line",
    label: "lint",
    text: "newer\x1b[31mred",
  });
  progress.output({
    kind: "partial",
    label: "lint",
    text: "building\rrewritten partial",
  });
  progress.output({
    kind: "line",
    label: "outside-the-plan",
    text: "must stay invisible",
  });
  tick?.();
  await Promise.resolve();

  const active = stripAnsi(writes.at(-1) ?? "");
  assertStringIncludes(active, "lint started");
  assertStringIncludes(active, "lint │ newerred");
  assertStringIncludes(active, "rewritten partial");
  assertEquals(active.includes("older line"), false);
  assertEquals(active.includes("must stay invisible"), false);
  assertEquals(active.includes("[31m"), false);

  progress.settled({
    label: "lint",
    status: "ok",
    code: 0,
    durationS: 1,
    outputLines: 2,
    errorLikeLines: 0,
  });
  tick?.();
  await Promise.resolve();
  await progress.complete(PROOF_STEPS);

  const completed = stripAnsi(writes.join(""));
  assertStringIncludes(completed, "lint passed");
  assertEquals(stops, 1);
  assertEquals(viewport.closes(), 1);
  assertStringIncludes(writes.join(""), "\x1b[?25h");
  assertEquals(progress.writeFailed(), false);
});

Deno.test("Gate activity follows package fitting from full through compact to append-only", async () => {
  let tick: (() => void) | undefined;
  let stops = 0;
  const writes: string[] = [];
  const viewport = observedTerminal({ columns: 64, rows: 12 });
  const progress = await createGateTtyProgress(
    (value) => writes.push(value),
    [GROUP],
    {
      width: 64,
      terminal: viewport.terminal,
      tailRows: 4,
      scheduler: {
        repeat(callback): () => void {
          tick = callback;
          let stopped = false;
          return (): void => {
            if (stopped) return;
            stopped = true;
            stops += 1;
          };
        },
      },
    },
  );
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);

  viewport.set({ columns: 64, rows: 4 });
  tick?.();
  await Promise.resolve();
  const compact = stripAnsi(writes.at(-1) ?? "");
  assertStringIncludes(compact, "lint started");
  assertEquals(
    compact.split("\n").filter((line) => line.trim() === "│").length,
    0,
    "the package removes the tail before giving up cursor control",
  );

  const beforeAppend = writes.length;
  viewport.set({ columns: 64, rows: 3 });
  tick?.();
  await Promise.resolve();
  const degradation = writes.slice(beforeAppend).join("");
  assertEquals(degradation.includes("\x1b[1G"), false);
  assertEquals(degradation.includes("\x1b[J"), false);

  progress.output({
    kind: "line",
    label: "lint",
    text: "committed after shrink",
  });
  const beforePartial = writes.length;
  progress.output({
    kind: "partial",
    label: "lint",
    text: "partial after shrink",
  });
  assertEquals(
    writes.length,
    beforePartial,
    "append-only degradation suppresses partial-line churn",
  );
  progress.settled({
    label: "lint",
    status: "ok",
    code: 0,
    durationS: 1,
    outputLines: 2,
    errorLikeLines: 0,
  });
  await progress.complete(PROOF_STEPS);

  const appended = stripAnsi(writes.slice(beforeAppend).join(""));
  assertStringIncludes(appended, "committed after shrink");
  assertStringIncludes(appended, "partial after shrink");
  assertStringIncludes(appended, "lint passed");
  assertEquals(appended.split("partial after shrink").length - 1, 1);
  assertEquals(stops, 1);
  assertEquals(viewport.closes(), 1);
  assertEquals(progress.writeFailed(), false);
});

Deno.test("Gate activity latches a terminal write failure without retrying cleanup", async () => {
  let attempts = 0;
  const viewport = observedTerminal({ columns: 72, rows: 20 });
  const progress = await createGateTtyProgress(
    () => {
      attempts += 1;
      throw new Error("terminal disappeared");
    },
    [GROUP],
    {
      width: 72,
      terminal: viewport.terminal,
    },
  );
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);
  progress.output({ kind: "line", label: "lint", text: "ignored" });
  await progress.complete(PROOF_STEPS);

  assertEquals(progress.writeFailed(), true);
  assertEquals(attempts, 1);
  assertEquals(viewport.closes(), 1);
});

Deno.test("Gate plan preserves prerequisite and configured-job group boundaries", () => {
  const plan: EnginePlan = {
    title: "Gate plan",
    details: ["Changed scopes: site"],
    steps: [{
      kind: "merge-check",
      label: verbatimStepLabel("merge-check"),
      disposition: "gate",
      note: "main is already merged",
    }, {
      kind: "job",
      label: verbatimStepLabel("format"),
      disposition: "run",
      note: "deno fmt",
      group: "Fix",
    }, {
      kind: "scope-gate",
      label: verbatimStepLabel("scope:map"),
      disposition: "skip",
      note: "scope unchanged",
      group: "Scope gates",
    }, {
      kind: "tracked-refresh-check",
      label: verbatimStepLabel("refresh-check"),
      disposition: "gate",
      note: "refresh has no pending effect",
    }],
  };
  const rendered = renderGatePlan(plan, { width: 62, terminal: PLAIN });
  assertStringIncludes(rendered, "Changed scopes: site");
  assertStringIncludes(rendered, "Gate prerequisites");
  assertStringIncludes(rendered, "main is already merged");
  assertStringIncludes(rendered, "Fix");
  assertStringIncludes(rendered, "Run: deno fmt");
  assertStringIncludes(rendered, "scope:map [skipped]");
  assertStringIncludes(rendered, "Final checks");
  assertStringIncludes(rendered, "refresh has no pending effect");
  assert(rendered.indexOf("Gate prerequisites") < rendered.indexOf("Fix"));
  assert(rendered.indexOf("Fix") < rendered.indexOf("Scope gates"));
  assert(rendered.indexOf("Scope gates") < rendered.indexOf("Final checks"));
});

Deno.test("Gate plan section rules inherit the bound terminal theme", () => {
  const plan: EnginePlan = {
    title: "Gate plan",
    details: [],
    steps: [],
  };
  const light = renderGatePlan(plan, {
    width: 62,
    terminal: terminal({ color: "truecolor", theme: "light" }),
  });
  const dark = renderGatePlan(plan, {
    width: 62,
    terminal: terminal({ color: "truecolor", theme: "dark" }),
  });
  assertEquals(stripAnsi(light), stripAnsi(dark));
  assertStringIncludes(stripAnsi(light), "◮");
  assert(light !== dark, "light and dark section-rule styling must differ");
});

Deno.test("Gate Standards render every measurement and verdict without invented values", () => {
  const standards: GateStandard[] = [
    {
      name: "coverage",
      direction: "up",
      limit: 80,
      measurement: "measured",
      value: 83,
      verdict: "held",
      duration_s: 3,
    },
    {
      name: "cli_pending",
      direction: "down",
      limit: 10,
      measurement: "measured",
      value: 8,
      verdict: "improved",
      pin_eligible: true,
      pin_target: 9,
    },
    {
      name: "bundle",
      direction: "down",
      limit: 100,
      measurement: "replayed",
      value: 104,
      verdict: "regressed",
      replayed_from: "abc1234",
    },
    {
      name: "docs",
      direction: "up",
      limit: 90,
      measurement: "deferred",
    },
    {
      name: "prose",
      direction: "down",
      limit: 40,
      measurement: "skipped",
    },
  ];
  const rendered = renderGateStandards(standards, {
    width: 64,
    terminal: PLAIN,
  });
  for (
    const fact of [
      "coverage · flat",
      "Current: 83",
      "Limit: floor 80",
      "cli_pending · improving",
      "Pin eligible: yes",
      "Pin target: 9",
      "bundle · drifting",
      "Current: 104",
      "replayed from abc1234",
      "Measurement is deferred",
      "Run discern standards.",
      "The gate stopped before this standard measurement ran.",
    ]
  ) {
    assertStringIncludes(rendered.replaceAll(/\s+/gu, " "), fact);
  }
  assertEquals(rendered.includes("Current: undefined"), false);
  assertEquals(rendered.includes("Current: 0"), false);
});

Deno.test("Gate diagnostics preserve severity, location, controls, excerpt, and retry", () => {
  const diagnostics: Diagnostic[] = [{
    tool: "lint",
    severity: "error",
    message: "Unexpected control\x07 byte",
    reproduce_cmd: "deno lint\n--again",
    file: "src/a/very/long/path/to/entrypoint.ts\x1b[31m",
    line: 12,
    col: 4,
    rule: "no-control",
    fix_available: true,
    output: "first\nsecond\x00",
    truncated: true,
    output_path: "/tmp/full-output.log",
  }, {
    tool: "tests",
    severity: "warning",
    message: "One flaky case was observed.",
    reproduce_cmd: "deno task test",
  }];
  const rendered = renderGateDiagnostics(diagnostics, {
    width: 48,
    terminal: PLAIN,
  });
  for (
    const fact of [
      "FAILURE: lint: no-control",
      "Unexpected control␇ byte",
      ":12:4",
      "Reproduce: $ deno lint",
      "--again",
      "lint captured output excerpt",
      "second␀",
      "Full output artifact:",
      "/tmp/full-output.log",
      "Safe to retry",
      "Run discern prepare",
      "ATTENTION: tests",
      "One flaky case was observed.",
    ]
  ) {
    assertStringIncludes(rendered.replaceAll(/\s+/gu, " "), fact);
  }
  assertStringIncludes(rendered, "lint␊--again");
  assertEquals(rendered.includes("\x1b"), false);
  assertEquals(rendered.includes("\x07"), false);
  assertEquals(rendered.includes("\x00"), false);
  assertWithinWidth(rendered, 48);
});

Deno.test("Gate Proof presents every recording and currency state truthfully", () => {
  for (
    const status of Object.keys(
      GATE_PROOF_RECORD_PRESENTATION,
    ) as GateProofRecord["status"][]
  ) {
    const rendered = renderGateProof(
      PROOF,
      { status },
      PROOF_STEPS,
      { width: 76, terminal: PLAIN },
    );
    const state = GATE_PROOF_RECORD_PRESENTATION[status];
    assertStringIncludes(rendered, "**Proof:**");
    assertStringIncludes(rendered, state.stateLabel);
    assertStringIncludes(rendered, state.summary);
    assertStringIncludes(rendered, "1 passed, 1 skipped");
    assertEquals(rendered.includes("[✓]"), status === "recorded");
    assert(rendered.endsWith(renderProofLineCli(PROOF.line, PLAIN, 76)));
  }

  for (const status of GATE_PROOF_CHECK_STATUSES) {
    const rendered = renderGateProofCheck({
      status,
      path: ".git/discern-proof.json",
      recorded: "abc1234",
      head: "def5678",
      reason: status === "stale" ? "The branch advanced." : undefined,
      proof_line: status === "honored" ? PROOF.line : undefined,
    }, { width: 76, terminal: PLAIN });
    const state = GATE_PROOF_CHECK_PRESENTATION[status];
    assertStringIncludes(rendered, state.stateLabel);
    assertStringIncludes(rendered, state.summary);
    assertEquals(rendered.includes("[✓]"), status === "honored");
    assertEquals(
      rendered.includes(renderProofLineCli(PROOF.line, PLAIN, 76)),
      status === "honored",
    );
  }
});

Deno.test("Gate completed workflow renders all result outcomes and Standards", () => {
  const outcomes = STEP_OUTCOMES.map((outcome, index): StepResult => ({
    step: {
      kind: "job",
      label: verbatimStepLabel(`job-${outcome}`),
      disposition: outcome === "skipped" ? "skip" : "run",
      note: `run job-${outcome}`,
      group: "Check",
    },
    outcome,
    durationS: index,
  }));
  const rendered = renderGateTtyTable(outcomes, {
    width: 72,
    terminal: PLAIN,
  }, [{
    name: "coverage",
    direction: "up",
    limit: 80,
    measurement: "measured",
    value: 82,
    verdict: "held",
  }]);
  for (const outcome of STEP_OUTCOMES) {
    assertStringIncludes(
      rendered,
      `job-${outcome} [${GATE_JOB_STATUS_LABEL[outcome]}]`,
    );
  }
  assertStringIncludes(rendered, "coverage · flat");
  assertStringIncludes(rendered, "A Gate job failed.");
});

Deno.test("Gate cancellation never earns the completed lifecycle", () => {
  const rendered = renderGateTtyTable([{
    step: {
      kind: "job",
      label: verbatimStepLabel("test"),
      disposition: "run",
      note: "deno task test",
      group: "Test",
    },
    outcome: "cancelled",
    durationS: 1,
  }], { width: 60, terminal: PLAIN });
  assertStringIncludes(rendered, "The Gate run was cancelled.");
  assertStringIncludes(rendered, "test [cancelled]");
  assertEquals(rendered.includes("✓ Complete"), false);
});
