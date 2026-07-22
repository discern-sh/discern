/**
 * Fast unit coverage for the gate's PURE planning core (`src/engine/gate/plan.ts`)
 * and the shared engine renderer (`src/shared/result.ts`). These run with NO
 * subprocess and NO git — the whole "what would the gate run, and how does it
 * serialize" decision is exercised in microseconds, the speed payoff of splitting
 * planning from execution (ADR 0027). The end-to-end behaviour is pinned by the
 * subprocess-driven `engine_finish_json_test.ts`; this pins the decisions directly.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import {
  buildGatePlan,
  buildGateResult,
  type GateData,
  gatePlanToEngine,
  planScopeGates,
  planStageJobs,
} from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import { fire, GATE_FAILURE_REMEDIES } from "../src/shared/hints.ts";
import {
  CAPTURE_CAP,
  type EnginePlan,
  FAILED_STAGES,
  planToJson,
  renderPlan,
  type RenderSink,
  renderStepResults,
  serializeResult,
  type StepResult,
} from "../src/shared/result.ts";

const FULL = parseConfigOrThrow(`
[jobs]
format = "deno fmt"
build = "deno task build"
lint = ["eslint .", "stylelint ."]
typecheck = "tsc --noEmit"
test = "vitest run"
smoke = "node -e 0"

[scopes.docs]
paths = ["docs/"]
neutral = true

[scopes.widget]
paths = ["widget/**"]
gate = "echo widget"

[scopes.gadget]
paths = ["gadget/**"]
gate = "echo gadget"
`);

function jobResult(
  fields:
    & Omit<JobResult, "outputLines" | "errorLikeLines">
    & Partial<Pick<JobResult, "outputLines" | "errorLikeLines">>,
): JobResult {
  return {
    outputLines: 0,
    errorLikeLines: 0,
    ...fields,
  };
}

Deno.test("the FULL fixture wires EVERY known capability (so the gate-shape tests cover the whole vocabulary)", () => {
  // The plan/shape assertions below hard-code capability labels off FULL's
  // [jobs]. Tie that fixture to the SSOT: a capability added to
  // KNOWN_JOBS must be wired into FULL (and its gate shape asserted) rather
  // than silently escaping this fast unit coverage.
  assertEquals(
    Object.keys(FULL.jobs).filter((name) => name in KNOWN_JOBS).sort(),
    Object.keys(KNOWN_JOBS).sort(),
    "the FULL fixture has drifted from KNOWN_JOBS — add the new capability to " +
      "the [jobs] block above and assert its gate-stage shape",
  );
});

Deno.test("gate job labels are unique across the whole plan (results are keyed by label)", () => {
  // The executor records every job result into ONE label-keyed map, and the
  // report looks each planned job up by label — so the plan's labels must be
  // unique across every job source. Exercise them all, driven off the
  // KNOWN_JOBS / STAGES registries so a new capability, stage, or label
  // scheme auto-enrols: every capability as a LIST (bare + `#N` labels), a
  // check in every stage, and several scope gates.
  const toml = [
    "[jobs]",
    ...Object.keys(KNOWN_JOBS).map((c) => `${c} = ["run-a", "run-b"]`),
    ...STAGES.flatMap((
      s,
    ) => [`[jobs.extra-${s}]`, `stage = "${s}"`, 'run = "x"']),
    "[scopes.widget]",
    'paths = ["widget/**"]',
    'gate = "echo w"',
    "[scopes.gadget]",
    'paths = ["gadget/**"]',
    'gate = "echo g"',
  ].join("\n");
  const plan = buildGatePlan(parseConfigOrThrow(toml), ["widget", "gadget"]);
  const labels = plan.groups.flatMap((g) => g.jobs.map((j) => j.label));
  assert(labels.length > 0);
  assertEquals(
    labels.length,
    new Set(labels).size,
    `duplicate gate job labels in: ${labels.join(", ")}`,
  );
});

Deno.test("planStageJobs: derived stage, array expansion, willRun always true", () => {
  const check = planStageJobs(FULL, "check");
  assertEquals(check.map((j) => j.label), ["lint", "lint#2", "typecheck"]);
  assert(check.every((j) => j.willRun));
  assert(check.every((j) => j.reportStage === "check"));
  assertEquals(planStageJobs(FULL, "fix").map((j) => j.label), ["format"]);
});

Deno.test("planScopeGates: every configured gate, willRun only for changed scopes", () => {
  const gates = planScopeGates(FULL, ["code", "widget"]);
  assertEquals(gates.map((j) => j.label), ["scope:widget", "scope:gadget"]);
  assertEquals(gates.find((g) => g.label === "scope:widget")?.willRun, true);
  assertEquals(gates.find((g) => g.label === "scope:gadget")?.willRun, false);
  assert(gates.every((g) => g.kind === "scope-gate"));
});

Deno.test("buildGatePlan: groups in fix→build→check/test→scope_gates order with correct modes", () => {
  const plan = buildGatePlan(FULL, ["widget"]);
  assertEquals(plan.groups.map((g) => g.stage), [
    "fix",
    "build",
    "check/test",
    "scope_gates",
  ]);
  assertEquals(plan.groups.map((g) => g.mode), [
    "serial", // fix mutates — serial
    "parallel",
    "parallel",
    "parallel",
  ]);
  // The check/test group fuses check then test jobs, in that order. `smoke` rides the
  // test stage (ADR 0090), so it follows `test` in the fused group.
  const ct = plan.groups.find((g) => g.stage === "check/test");
  assertEquals(ct?.jobs.map((j) => j.label), [
    "lint",
    "lint#2",
    "typecheck",
    "test",
    "smoke",
  ]);
  assert(plan.mergeCheck);
});

Deno.test("buildGatePlan: empty stages produce no group (a no-op gate has no groups)", () => {
  const bare = parseConfigOrThrow('[project]\nslug = "x"\n');
  const plan = buildGatePlan(bare, []);
  assertEquals(plan.groups, []);
  assert(plan.mergeCheck);
});

Deno.test("buildGateResult: serializes plan+results into the DiscernResult envelope", async () => {
  const plan = buildGatePlan(FULL, ["widget"]);
  // Simulate: fix+build+check/test all passed; widget gate passed; gadget skipped.
  const results = new Map<string, JobResult>();
  const ok = (label: string): void => {
    results.set(
      label,
      jobResult({ label, status: "ok", code: 0, durationS: 1 }),
    );
  };
  for (
    const l of [
      "format",
      "build",
      "lint",
      "lint#2",
      "typecheck",
      "test",
      "smoke",
    ]
  ) {
    ok(l);
  }
  ok("scope:widget");
  const result = await buildGateResult(plan, results, null);
  const steps = result.steps ?? [];

  assertEquals(result.ok, true);
  assertEquals(result.verb, "done");
  assertEquals((result.data as GateData).failed_stage, null);
  // The job-kind steps are the non-scope jobs in fix→build→check→test order.
  assertEquals(
    steps.filter((s) => s.step.kind === "job").map((s) => s.step.label),
    ["format", "build", "lint", "lint#2", "typecheck", "test", "smoke"],
  );
  // scope-gate steps list every configured gate; the unchanged one is skipped.
  const sg = (scope: string) =>
    steps.find((s) => s.step.label === `scope:${scope}`);
  assertEquals(sg("widget")?.step.kind, "scope-gate");
  assertEquals(sg("widget")?.outcome, "ok");
  assertEquals(sg("gadget")?.outcome, "skipped");
  // A clean run carries no diagnostics (the field is omitted).
  assertEquals(result.diagnostics, undefined);
});

Deno.test("buildGateResult: an aborted stage leaves later jobs skipped; the failure is a diagnostic", async () => {
  const plan = buildGatePlan(FULL, []);
  // Only the fix job ran and failed (with captured output); nothing else has a result.
  const results = new Map<string, JobResult>([
    [
      "format",
      jobResult({
        label: "format",
        status: "failed",
        code: 1,
        durationS: 0,
        output: "boom",
      }),
    ],
  ]);
  const result = await buildGateResult(plan, results, "fix");
  const steps = result.steps ?? [];
  const step = (label: string) => steps.find((s) => s.step.label === label);

  assertEquals(result.ok, false);
  assertEquals((result.data as GateData).failed_stage, "fix");
  assertEquals(step("format")?.outcome, "failed");
  // A later-stage job that never ran is "skipped", not absent.
  assertEquals(step("test")?.outcome, "skipped");
  // The failed job becomes a Tier-0 diagnostic carrying its output + reproduce cmd.
  const diag = (result.diagnostics ?? []).find((d) => d.tool === "format");
  assert(diag, "expected a diagnostic for the failed format job");
  assertEquals(diag.output, "boom");
  assertEquals(diag.reproduce_cmd, "deno fmt");
  assertEquals(diag.fix_available, undefined);
});

Deno.test("buildGateResult: every failed stage carries its remedy in the JSON envelope", async () => {
  const plan = buildGatePlan(FULL, []);
  const missing: string[] = [];
  for (const stage of FAILED_STAGES) {
    const result = await buildGateResult(
      plan,
      new Map<string, JobResult>(),
      stage,
    );
    const hints = serializeResult(result).hints as string[] | undefined;
    if (!(hints ?? []).includes(fire(GATE_FAILURE_REMEDIES[stage]).text)) {
      missing.push(stage);
    }
  }
  assertEquals(
    missing,
    [],
    `failed stages whose JSON envelopes omit their remedies: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("buildGateResult: non-fix capability/check failures note a wired fix stage", async () => {
  const plan = buildGatePlan(FULL, []);
  const results = new Map<string, JobResult>([
    [
      "format",
      jobResult({ label: "format", status: "ok", code: 0, durationS: 0 }),
    ],
    [
      "lint",
      jobResult({
        label: "lint",
        status: "failed",
        code: 1,
        durationS: 0,
        output: "boom",
      }),
    ],
  ]);
  const result = await buildGateResult(plan, results, "check/test");
  const diag = (result.diagnostics ?? []).find((d) => d.tool === "lint");
  assert(diag, "expected a diagnostic for the failed lint job");
  assertEquals(diag.fix_available, true);
});

Deno.test("buildGateResult: fix_available is absent without a fix-stage job and on scope-gates", async () => {
  const noFix = parseConfigOrThrow(`
[jobs]
lint = "eslint ."
`);
  const noFixResult = await buildGateResult(
    buildGatePlan(noFix, []),
    new Map<string, JobResult>([
      [
        "lint",
        jobResult({
          label: "lint",
          status: "failed",
          code: 1,
          durationS: 0,
          output: "boom",
        }),
      ],
    ]),
    "check/test",
  );
  const lint = (noFixResult.diagnostics ?? []).find((d) => d.tool === "lint");
  assert(lint, "expected a lint diagnostic");
  assertEquals(lint.fix_available, undefined);

  const scopeResult = await buildGateResult(
    buildGatePlan(FULL, ["widget"]),
    new Map<string, JobResult>([
      [
        "scope:widget",
        jobResult({
          label: "scope:widget",
          status: "failed",
          code: 1,
          durationS: 0,
          output: "boom",
        }),
      ],
    ]),
    "scope_gates",
  );
  const scope = (scopeResult.diagnostics ?? []).find((d) =>
    d.tool === "scope:widget"
  );
  assert(scope, "expected a scope-gate diagnostic");
  assertEquals(scope.fix_available, undefined);
});

Deno.test("buildGateResult: a cancelled sibling is reported skipped, not failed, and earns no diagnostic", async () => {
  const plan = buildGatePlan(FULL, []);
  const results = new Map<string, JobResult>([
    // lint genuinely failed (carries output); typecheck was fail-fast-cancelled.
    [
      "lint",
      jobResult({
        label: "lint",
        status: "failed",
        code: 1,
        durationS: 0,
        output: "boom",
      }),
    ],
    [
      "typecheck",
      jobResult({
        label: "typecheck",
        status: "failed",
        code: 1,
        durationS: 0,
        cancelled: true,
      }),
    ],
  ]);
  const result = await buildGateResult(plan, results, "check/test");
  const steps = result.steps ?? [];
  const step = (l: string) => steps.find((s) => s.step.label === l);
  assertEquals(step("lint")?.outcome, "failed");
  assertEquals(step("typecheck")?.outcome, "skipped"); // cancelled → skipped, not failed
  // Only the genuine failure earns a diagnostic; the cancelled sibling does not.
  const diags = result.diagnostics ?? [];
  assert(diags.some((d) => d.tool === "lint"));
  assert(!diags.some((d) => d.tool === "typecheck"));
});

Deno.test("buildGateResult: a LARGE SARIF output is normalized to one diagnostic per finding (not a truncated Tier-0 blob)", async () => {
  // Exceed the Tier-0 cap, to prove normalization runs on the FULL captured output —
  // not the capped string (which would be invalid JSON and collapse to one blob).
  const findings = Array.from({ length: 300 }, (_, i) => ({
    ruleId: `rule-${i}`,
    level: "error",
    message: { text: `problem number ${i} with some descriptive padding text` },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: `src/file${i}.ts` },
        region: { startLine: i + 1 },
      },
    }],
  }));
  const sarif = JSON.stringify({
    version: "2.1.0",
    runs: [{ results: findings }],
  });
  assert(
    sarif.length > CAPTURE_CAP,
    "fixture must exceed the Tier-0 cap to be a real test",
  );

  const results = new Map<string, JobResult>([
    [
      "lint",
      jobResult({
        label: "lint",
        status: "failed",
        code: 1,
        durationS: 0,
        output: sarif,
      }),
    ],
  ]);
  const result = await buildGateResult(
    buildGatePlan(FULL, []),
    results,
    "check/test",
  );
  const diags = result.diagnostics ?? [];
  assertEquals(
    diags.length,
    300,
    "one structured diagnostic per SARIF finding",
  );
  assertEquals(diags[0]?.rule, "rule-0");
  assertEquals(diags[0]?.file, "src/file0.ts");
  assert(diags.every((d) => d.fix_available === true));
  // Every diagnostic is Tier-1 (located) — none fell back to a raw Tier-0 blob.
  assert(diags.every((d) => d.file !== undefined && d.output === undefined));
});

Deno.test("gatePlanToEngine: firing job is run, unchanged scope gate is skip, built-in preconditions are gates", () => {
  const plan = buildGatePlan(FULL, ["widget"]);
  const engine = gatePlanToEngine(plan);
  const widget = engine.steps.find((s) => s.label === "scope:widget");
  const gadget = engine.steps.find((s) => s.label === "scope:gadget");
  assertEquals(widget?.disposition, "run");
  assertEquals(gadget?.disposition, "skip");
  assertEquals(
    engine.steps.find((s) => s.label === "format")?.disposition,
    "run",
  );
  // The merge check, tracked-artifacts guard, and guidance + skills currency checks
  // (FULL leaves both features on) are read-only `gate` preconditions, listed for
  // honesty.
  assertEquals(
    engine.steps.find((s) => s.kind === "merge-check")?.disposition,
    "gate",
  );
  assertEquals(
    engine.steps.find((s) => s.kind === "tracked-artifacts-check")
      ?.disposition,
    "gate",
  );
  assertEquals(
    engine.steps.find((s) => s.kind === "guidance-check")?.disposition,
    "gate",
  );
  assertEquals(
    engine.steps.find((s) => s.kind === "skills-check")?.disposition,
    "gate",
  );
});

// ── the shared renderer ────────────────────────────────────────────────────────

/** A sink that captures rendered lines (colour off — dim is a passthrough). */
function captureSink(): { sink: RenderSink; lines: string[] } {
  const lines: string[] = [];
  const sink: RenderSink = {
    heading: (t) => lines.push(t),
    line: (t) => lines.push(t),
    dim: (t) => t,
  };
  return { sink, lines };
}

Deno.test("renderPlan: groups its steps and marks dispositions", () => {
  const plan = gatePlanToEngine(buildGatePlan(FULL, ["widget"]));
  const { sink, lines } = captureSink();
  renderPlan(sink, plan);
  const text = lines.join("\n");
  assert(text.includes("Gate plan"));
  assert(/run\s+format/.test(text), text);
  assert(/skip\s+scope:gadget/.test(text), text);
  assert(/check\s+merge-check/.test(text), text);
});

Deno.test("renderPlan: an empty plan says so", () => {
  const empty: EnginePlan = { title: "Empty plan", details: [], steps: [] };
  const { sink, lines } = captureSink();
  renderPlan(sink, empty);
  assert(lines.join("\n").includes("nothing to do"));
});

Deno.test("renderStepResults: groups outcomes and renders result metadata", () => {
  const steps: StepResult[] = [
    {
      step: {
        kind: "job",
        label: "format",
        disposition: "run",
        note: "deno fmt",
        group: "Fix",
      },
      outcome: "ok",
      durationS: 2,
      outputLines: 3,
      errorLikeLines: 1,
      outputPath: "/tmp/format.out",
    },
    {
      step: {
        kind: "scope-gate",
        label: "scope:docs",
        disposition: "skip",
        note: "scope unchanged",
        group: "Scopes",
      },
      outcome: "skipped",
    },
    {
      step: {
        kind: "standard",
        label: "coverage",
        disposition: "run",
      },
      outcome: "failed",
    },
  ];
  const { sink, lines } = captureSink();
  renderStepResults(sink, { title: "Apply results", steps });
  const text = lines.join("\n");

  assert(text.includes("Apply results"));
  assert(text.includes("Fix"));
  assert(text.includes("Scopes"));
  assert(/ok\s+format/.test(text), text);
  assertStringIncludes(text, "deno fmt");
  assertStringIncludes(text, "2s");
  assertStringIncludes(text, "3 output lines");
  assertStringIncludes(text, "1 diagnostic-like line");
  assertStringIncludes(text, "output: /tmp/format.out");
  assert(/skipped\s+scope:docs/.test(text), text);
  assert(/failed\s+coverage/.test(text), text);
});

Deno.test("renderStepResults: an empty apply says nothing ran", () => {
  const { sink, lines } = captureSink();
  renderStepResults(sink, { title: "Apply results", steps: [] });
  assert(lines.join("\n").includes("nothing ran"));
});

Deno.test("planToJson: round-trips the plan shape", () => {
  const plan = gatePlanToEngine(buildGatePlan(FULL, ["widget"]));
  const json = planToJson(plan);
  assertEquals(json.title, "Gate plan");
  const widget = json.steps.find((s) => s.label === "scope:widget");
  assertEquals(widget?.disposition, "run");
  assertEquals(widget?.kind, "scope-gate");
});
