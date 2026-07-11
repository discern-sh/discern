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
  pinnedLimit,
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

Deno.test("buildRatchetPlan: margin defaults to 0 and carries an explicit value", () => {
  const cfg = parseConfigOrThrow(`
[ratchets.plain]
direction = "up"
limit = 10
run = "echo x"

[ratchets.roomy]
direction = "down"
limit = 100
margin = 5
run = "echo x"
`);
  const plan = buildRatchetPlan(cfg);
  assertEquals(plan.ratchets.find((r) => r.name === "plain")?.margin, 0);
  assertEquals(plan.ratchets.find((r) => r.name === "roomy")?.margin, 5);
});

// ── pinnedLimit: the pure decision behind `ratchets --pin` ──────────────────────

Deno.test("pinnedLimit: tightens a floor up / a ceiling down to the measured value", () => {
  assertEquals(pinnedLimit("up", 95, 0, 80), 95); // floor rises to the measurement
  assertEquals(pinnedLimit("down", 50, 0, 100), 50); // ceiling falls to the measurement
});

Deno.test("pinnedLimit: margin leaves headroom in the loosening direction", () => {
  assertEquals(pinnedLimit("up", 95, 5, 80), 90); // floor = measured − margin
  assertEquals(pinnedLimit("down", 700000, 100000, 1000000), 800000); // ceiling = measured + margin
});

Deno.test("pinnedLimit: never loosens — returns undefined unless strictly tighter", () => {
  // A worse measurement than the current limit would loosen: refused.
  assertEquals(pinnedLimit("up", 70, 0, 80), undefined);
  assertEquals(pinnedLimit("down", 150, 0, 100), undefined);
  // At equality there is nothing to tighten.
  assertEquals(pinnedLimit("up", 80, 0, 80), undefined);
  assertEquals(pinnedLimit("down", 100, 0, 100), undefined);
});

Deno.test("pinnedLimit: an improvement inside the margin is not worth pinning", () => {
  // measured 950, ceiling 1000, margin 100 → target 1050 is not below 1000.
  assertEquals(pinnedLimit("down", 950, 100, 1000), undefined);
  // measured 82, floor 80, margin 5 → target 77 is not above 80.
  assertEquals(pinnedLimit("up", 82, 5, 80), undefined);
});

Deno.test("pinnedLimit: rounds a rate in the SAFE direction so the measurement still holds", () => {
  // A floor rounds DOWN (so measured ≥ pinned floor); a ceiling rounds UP.
  assertEquals(pinnedLimit("up", 89.317, 0, 80), 89.31);
  assertEquals(pinnedLimit("down", 18.311, 0, 40), 18.32);
});

Deno.test("pinnedLimit: a negative margin never pins a limit the measurement fails (B31)", () => {
  // The class: a pin that records a failing-by-construction limit. A negative
  // margin flips the headroom, tightening PAST the measured value — a floor pinned
  // ABOVE, or a ceiling BELOW, the number just measured, which then fails the very
  // next check. The plan-time guard refuses it: nothing safe to pin ⇒ undefined.
  assertEquals(pinnedLimit("up", 90, -5, 80), undefined); // would have been floor 95
  assertEquals(pinnedLimit("down", 50, -5, 100), undefined); // would have been ceiling 45

  // The invariant, checked over a grid of directions/values/margins/limits: any
  // limit pinnedLimit RETURNS must be one the measured value still satisfies — a
  // floor never above the measurement, a ceiling never below it. Covers negative,
  // zero, and positive margins so the guard is the invariant, not three examples.
  const values = [0, 12.5, 50, 100, 1000];
  const margins = [-100, -5, -0.01, 0, 0.01, 5, 100];
  const currents = [0, 40, 80, 500, 2000];
  for (const direction of ["up", "down"] as const) {
    for (const value of values) {
      for (const margin of margins) {
        for (const current of currents) {
          const pinned = pinnedLimit(direction, value, margin, current);
          if (pinned === undefined) {
            continue;
          }
          const satisfied = direction === "up"
            ? value + 1e-9 >= pinned
            : value - 1e-9 <= pinned;
          assert(
            satisfied,
            `pinnedLimit(${direction}, ${value}, ${margin}, ${current}) = ${pinned} is NOT satisfied by the measured value ${value}`,
          );
          // And it is genuinely tighter than the current limit (pin only tightens).
          const tighter = direction === "up" ? pinned > current : pinned < current;
          assert(
            tighter,
            `pinnedLimit(${direction}, ${value}, ${margin}, ${current}) = ${pinned} did not tighten past ${current}`,
          );
        }
      }
    }
  }
});
