/**
 * Fast unit coverage for the gate's PURE planning core (`src/engine/gate/plan.ts`)
 * and the shared engine renderer (`src/shared/result.ts`). These run with NO
 * subprocess and NO git — the whole "what would the gate run, and how does it
 * serialize" decision is exercised in microseconds, the speed payoff of splitting
 * planning from execution (ADR 0027). The end-to-end behaviour is pinned by the
 * subprocess-driven `engine_finish_json_test.ts`; this pins the decisions directly.
 */

import { assert, assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  buildGatePlan,
  buildGateReport,
  gatePlanToEngine,
  planScopeGates,
  planStageJobs,
} from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import {
  type EnginePlan,
  planToJson,
  renderPlan,
  type RenderSink,
} from "../src/shared/result.ts";

const FULL = parseConfigOrThrow(`
[capabilities]
format = "deno fmt"
build = "deno task build"
lint = ["eslint .", "stylelint ."]
typecheck = "tsc --noEmit"
test = "vitest run"

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
  // The check/test group fuses check then test jobs, in that order.
  const ct = plan.groups.find((g) => g.stage === "check/test");
  assertEquals(ct?.jobs.map((j) => j.label), [
    "lint",
    "lint#2",
    "typecheck",
    "test",
  ]);
  assert(plan.mergeCheck);
});

Deno.test("buildGatePlan: empty stages produce no group (a no-op gate has no groups)", () => {
  const bare = parseConfigOrThrow('[project]\nslug = "x"\n');
  const plan = buildGatePlan(bare, []);
  assertEquals(plan.groups, []);
  assert(plan.mergeCheck);
});

Deno.test("buildGateReport: serializes plan+results into the ADR-0004 shape", () => {
  const plan = buildGatePlan(FULL, ["widget"]);
  // Simulate: fix+build+check/test all passed; widget gate passed; gadget skipped.
  const results = new Map<string, JobResult>();
  const ok = (label: string): void => {
    results.set(label, { label, status: "ok", code: 0, durationS: 1 });
  };
  for (
    const l of ["format", "build", "lint", "lint#2", "typecheck", "test"]
  ) {
    ok(l);
  }
  ok("scope:widget");
  const report = buildGateReport(plan, results, null);

  assertEquals(report.ok, true);
  assertEquals(report.failed_stage, null);
  // jobs[] is the non-scope jobs in fix→build→check→test order.
  assertEquals(report.jobs.map((j) => j.name), [
    "format",
    "build",
    "lint",
    "lint#2",
    "typecheck",
    "test",
  ]);
  assertEquals(report.jobs.find((j) => j.name === "format")?.stage, "fix");
  assertEquals(report.jobs.find((j) => j.name === "test")?.kind, "capability");
  // scope_gates[] lists every configured gate; the unchanged one is skipped.
  const widget = report.scope_gates.find((g) => g.scope === "widget");
  const gadget = report.scope_gates.find((g) => g.scope === "gadget");
  assertEquals(widget?.status, "ok");
  assertEquals(gadget?.status, "skipped");
});

Deno.test("buildGateReport: a stage that aborted leaves later jobs skipped", () => {
  const plan = buildGatePlan(FULL, []);
  // Only the fix job ran and failed; nothing else has a result.
  const results = new Map<string, JobResult>([
    ["format", { label: "format", status: "failed", code: 1, durationS: 0 }],
  ]);
  const report = buildGateReport(plan, results, "fix");
  assertEquals(report.ok, false);
  assertEquals(report.failed_stage, "fix");
  assertEquals(report.jobs.find((j) => j.name === "format")?.status, "failed");
  // A later-stage job that never ran is "skipped", not absent.
  assertEquals(report.jobs.find((j) => j.name === "test")?.status, "skipped");
});

Deno.test("gatePlanToEngine: firing job is run, unchanged scope gate is skip, merge-check is a gate", () => {
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
  assertEquals(
    engine.steps.find((s) => s.kind === "merge-check")?.disposition,
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

Deno.test("planToJson: round-trips the plan shape", () => {
  const plan = gatePlanToEngine(buildGatePlan(FULL, ["widget"]));
  const json = planToJson(plan);
  assertEquals(json.title, "Gate plan");
  const widget = json.steps.find((s) => s.label === "scope:widget");
  assertEquals(widget?.disposition, "run");
  assertEquals(widget?.kind, "scope-gate");
});
