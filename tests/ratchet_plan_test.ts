/**
 * Fast unit coverage for the ratchets verb's PURE planning core
 * (`src/engine/gate/ratchet_plan.ts`). These run with NO subprocess and NO git —
 * the whole "which ratchets, with what direction/limit/metric/command" decision is
 * exercised in microseconds, the speed payoff of splitting planning from execution
 * (ADR 0027). The end-to-end behaviour is pinned by the subprocess-driven
 * `engine_ratchets_test.ts`; this pins the decision directly.
 */

import { assert, assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  buildRatchetPlan,
  ratchetPlanToEngine,
} from "../src/engine/gate/ratchet_plan.ts";

const CFG = parseConfigOrThrow(`
[ratchets.coverage]
direction = "up"
limit = 85
run = "echo 'DISCERN_METRIC coverage 90'"

[ratchets.bundle]
metric = "bundle_bytes"
direction = "down"
limit = 100
run = "echo 'DISCERN_METRIC bundle_bytes 50'"
`);

Deno.test("buildRatchetPlan: one PlannedRatchet per [ratchets.*], fields resolved", () => {
  const plan = buildRatchetPlan(CFG);
  assertEquals(plan.ratchets.map((r) => r.name), ["coverage", "bundle"]);

  const coverage = plan.ratchets.find((r) => r.name === "coverage");
  // metric defaults to the ratchet name; command is the flattened run.
  assertEquals(coverage?.metric, "coverage");
  assertEquals(coverage?.direction, "up");
  assertEquals(coverage?.limit, 85);
  assertEquals(coverage?.command, "echo 'DISCERN_METRIC coverage 90'");
  assertEquals(coverage?.limitKey, "ratchets.coverage.limit");

  const bundle = plan.ratchets.find((r) => r.name === "bundle");
  // an explicit metric overrides the name; direction "down" is a ceiling.
  assertEquals(bundle?.metric, "bundle_bytes");
  assertEquals(bundle?.direction, "down");
  assertEquals(bundle?.limit, 100);
  assertEquals(bundle?.limitKey, "ratchets.bundle.limit");
});

Deno.test("buildRatchetPlan: no [ratchets.*] tables → an empty plan", () => {
  const bare = parseConfigOrThrow('[project]\nslug = "x"\n');
  assertEquals(buildRatchetPlan(bare).ratchets, []);
});

Deno.test("ratchetPlanToEngine: each ratchet is a run step noting direction + limit", () => {
  const engine = ratchetPlanToEngine(buildRatchetPlan(CFG));
  assertEquals(engine.title, "Ratchets plan");
  assertEquals(engine.details, ["2 ratchet(s) configured"]);

  assertEquals(engine.steps.map((s) => s.label), ["coverage", "bundle"]);
  assert(engine.steps.every((s) => s.kind === "ratchet"));
  assert(engine.steps.every((s) => s.disposition === "run"));

  const coverage = engine.steps.find((s) => s.label === "coverage");
  assertEquals(coverage?.note, "up, limit 85");
  const bundle = engine.steps.find((s) => s.label === "bundle");
  assertEquals(bundle?.note, "down, limit 100");
});

Deno.test("ratchetPlanToEngine: an empty plan projects to zero steps", () => {
  const bare = parseConfigOrThrow('[project]\nslug = "x"\n');
  const engine = ratchetPlanToEngine(buildRatchetPlan(bare));
  assertEquals(engine.steps, []);
  assertEquals(engine.details, ["0 ratchet(s) configured"]);
});
