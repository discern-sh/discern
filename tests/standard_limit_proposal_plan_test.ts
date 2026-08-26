/** Pure state-machine coverage for proposed Standard limit planning. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  STANDARD_LIMIT_REASON_MAX_LENGTH,
  validateStandardLimitReason,
} from "../src/shared/standard_limit_reason.ts";
import { buildStandardLimitProposalPlan } from "../src/engine/gate/standard_proposal_plan.ts";
import {
  buildStandardPlan,
  type PlannedStandard,
} from "../src/engine/gate/standard_plan.ts";

/** Parse one fully resolved Standard fixture through the real config schema. */
function plannedStandard(
  direction: "up" | "down" = "down",
  inputs = '["src/**"]',
): PlannedStandard {
  const config = parseConfigOrThrow(`
[standards.size]
direction = "${direction}"
limit = 10
run = "echo DISCERN_METRIC size 11"
inputs = ${inputs}
`);
  const standard = buildStandardPlan(config).standards[0];
  assert(standard !== undefined);
  return standard;
}

/** Build one valid planning context with focused overrides. */
function context(
  overrides: Partial<Parameters<typeof buildStandardLimitProposalPlan>[0]> = {},
): Parameters<typeof buildStandardLimitProposalPlan>[0] {
  return {
    standard: plannedStandard(),
    reason: "The required feature adds one measured source.",
    head: "a".repeat(40),
    definitionFingerprint: "definition",
    trunk: "main",
    trunkCommit: "b".repeat(40),
    trunkLimit: 10,
    measurement: 12,
    changedPaths: ["docs/unrelated.md", "src/feature.ts", "src/feature.ts"],
    ...overrides,
  };
}

Deno.test("proposed Standard limit plan binds exact measurement, delta, reason, and responsible paths", () => {
  const decision = buildStandardLimitProposalPlan(context());
  assert(decision.ok);
  assertEquals(decision.plan.proposal, {
    standard: "size",
    measured_commit: "a".repeat(40),
    definition_fingerprint: "definition",
    trunk: "main",
    trunk_commit: "b".repeat(40),
    direction: "down",
    trunk_limit: 10,
    proposed_limit: 12,
    measurement: 12,
    delta: 2,
    reason: "The required feature adds one measured source.",
    evidence_paths: ["src/feature.ts"],
  });
  assertEquals(decision.plan.engine.steps.length, 2);
});

Deno.test("proposed Standard limit plan supports a regressed floor with a signed negative delta", () => {
  const decision = buildStandardLimitProposalPlan(context({
    standard: plannedStandard("up"),
    measurement: 8,
  }));
  assert(decision.ok);
  assertEquals(decision.plan.proposal.proposed_limit, 8);
  assertEquals(decision.plan.proposal.delta, -2);
});

Deno.test("proposed Standard limit plan refuses held values, improvements, and prior limit edits", () => {
  for (const measurement of [10, 9]) {
    const decision = buildStandardLimitProposalPlan(context({ measurement }));
    assert(!decision.ok);
    assertStringIncludes(decision.message, "does not breach");
  }
  const alreadyMoved = buildStandardLimitProposalPlan(context({
    standard: { ...plannedStandard(), limit: 11 },
  }));
  assert(!alreadyMoved.ok);
  assertStringIncludes(alreadyMoved.message, "already changes its limit");
});

Deno.test("proposed Standard limit plan requires configured inputs and attributable changed paths", () => {
  const { inputs: _inputs, ...standardWithoutInputs } = plannedStandard();
  const noInputs = buildStandardLimitProposalPlan(context({
    standard: standardWithoutInputs,
  }));
  assert(!noInputs.ok);
  assertEquals(noInputs.error, "invalid_config");

  const unrelated = buildStandardLimitProposalPlan(context({
    changedPaths: ["docs/only.md"],
  }));
  assert(!unrelated.ok);
  assertStringIncludes(unrelated.message, "no changed path matches");
});

Deno.test("proposed Standard limit reasons are verbatim, bounded, visible, and secret-free", () => {
  const verbatim = "  The product change requires this limit.  ";
  assertEquals(validateStandardLimitReason(verbatim), {
    ok: true,
    reason: verbatim,
  });
  for (
    const reason of [
      "   ",
      "line one\nline two",
      `api_key=${"x".repeat(24)}`,
      "x".repeat(STANDARD_LIMIT_REASON_MAX_LENGTH + 1),
    ]
  ) {
    assertEquals(validateStandardLimitReason(reason).ok, false);
  }
});
