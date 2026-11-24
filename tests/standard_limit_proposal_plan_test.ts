/** Pure state-machine coverage for Standard limit proposal planning. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { StandardLimitProposalData } from "../src/shared/result_schemas.ts";
import {
  STANDARD_LIMIT_REASON_MAX_LENGTH,
  validateStandardLimitReason,
} from "../src/shared/standard_limit_reason.ts";
import {
  buildStandardLimitProposalPlan,
  buildStandardLimitProposalRebindPlan,
  proposedLimitRule,
} from "../src/engine/gate/standard_proposal_plan.ts";
import {
  movedProposalDiagnostics,
  sameStandardLimitProposalSet,
  standardLimitProposalIdentity,
} from "../src/engine/gate/standard_proposal_state.ts";
import {
  buildStandardPlan,
  pinnedLimit,
  type PlannedStandard,
} from "../src/engine/gate/standard_plan.ts";
import { standardLimitProposalFigures } from "../src/shared/standard_limit_proposal_text.ts";
import { assertNamedCases } from "./assert_cases.ts";
import { decodeWith } from "./decode_cli_result.ts";

/** Parse one fully resolved Standard fixture through the real config schema. */
function plannedStandard(
  direction: "up" | "down" = "down",
  inputs = '["src/**"]',
  margin = 0,
): PlannedStandard {
  const config = parseConfigOrThrow(`
[standards.size]
direction = "${direction}"
limit = 10
margin = ${margin}
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

/** One recorded proposal whose branch now carries the proposed limit. */
function recordedProposal(
  overrides: Partial<Parameters<typeof buildStandardLimitProposalPlan>[0]> = {},
): StandardLimitProposalData {
  const decision = buildStandardLimitProposalPlan(context(overrides));
  assert(decision.ok);
  return {
    ...decision.plan.proposal,
    commit: "c".repeat(40),
    bound_commit: "c".repeat(40),
  };
}

/** Build one eligible descendant-renewal context with focused overrides. */
function rebindContext(
  overrides: Partial<
    Parameters<typeof buildStandardLimitProposalRebindPlan>[0]
  > = {},
): Parameters<typeof buildStandardLimitProposalRebindPlan>[0] {
  return {
    standard: { ...plannedStandard(), limit: 12 },
    proposal: recordedProposal(),
    reason: "The required feature adds one measured source.",
    head: "d".repeat(40),
    definitionFingerprint: "definition",
    trunk: "main",
    trunkCommit: "e".repeat(40),
    trunkLimit: 10,
    measurement: 12,
    changedPaths: ["src/final.ts", "docs/unrelated.md"],
    originIsAncestor: true,
    trunkIsContained: true,
    ...overrides,
  };
}

Deno.test("standard limit proposal plan: contracts", () => {
  assertNamedCases({
    "Standard limit proposal plan binds exact measurement, delta, reason, and responsible paths":
      () => {
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
      },
    "Standard limit proposal plan supports a regressed floor with a signed negative delta":
      () => {
        const decision = buildStandardLimitProposalPlan(context({
          standard: plannedStandard("up"),
          measurement: 8,
        }));
        assert(decision.ok);
        assertEquals(decision.plan.proposal.proposed_limit, 8);
        assertEquals(decision.plan.proposal.delta, -2);
      },
    "Standard limit proposal plan without a margin proposes the measurement itself, unrounded":
      () => {
        for (const direction of ["down", "up"] as const) {
          const measurement = direction === "down" ? 12.3456 : 8.1234;
          const decision = buildStandardLimitProposalPlan(context({
            standard: plannedStandard(direction),
            measurement,
          }));
          assert(decision.ok);
          const proposal = decision.plan.proposal;
          assertEquals(proposal.proposed_limit, measurement);
          assertEquals(proposal.measurement, measurement);
          assertEquals(proposal.delta, measurement - 10);
          assert(
            !("margin" in proposal),
            "a proposal without headroom keeps the record it has always had",
          );
        }
      },
    "Standard limit proposal plan keeps the configured margin as headroom and records each figure":
      () => {
        const ceiling = buildStandardLimitProposalPlan(context({
          standard: plannedStandard("down", '["src/**"]', 0.5),
        }));
        assert(ceiling.ok);
        assertEquals(ceiling.plan.proposal.measurement, 12);
        assertEquals(ceiling.plan.proposal.margin, 0.5);
        assertEquals(ceiling.plan.proposal.proposed_limit, 12.5);
        assertEquals(ceiling.plan.proposal.delta, 2.5);
        const move = ceiling.plan.engine.steps[1]?.note ?? "";
        assertStringIncludes(move, "10 → 12.5");
        assertStringIncludes(move, "measured 12 with margin 0.5");

        const floor = buildStandardLimitProposalPlan(context({
          standard: plannedStandard("up", '["src/**"]', 0.5),
          measurement: 8,
        }));
        assert(floor.ok);
        assertEquals(floor.plan.proposal.measurement, 8);
        assertEquals(floor.plan.proposal.margin, 0.5);
        assertEquals(floor.plan.proposal.proposed_limit, 7.5);
        assertEquals(floor.plan.proposal.delta, -2.5);
      },
    "A proposed limit is the pin target for the same measurement, so a later pin leaves it alone":
      () => {
        for (const direction of ["down", "up"] as const) {
          for (const margin of [0.01, 0.5, 3, 250]) {
            for (const breach of [0.004, 1.337, 2, 4096]) {
              const measurement = direction === "down"
                ? 10 + breach
                : 10 - Math.min(breach, 9);
              const decision = buildStandardLimitProposalPlan(context({
                standard: plannedStandard(direction, '["src/**"]', margin),
                measurement,
              }));
              assert(decision.ok);
              const proposed = decision.plan.proposal.proposed_limit;
              const farLimit = direction === "down" ? 1e9 : -1e9;
              assertEquals(
                proposed,
                pinnedLimit(direction, measurement, margin, farLimit),
                "one definition of a limit with headroom",
              );
              assertEquals(
                pinnedLimit(direction, measurement, margin, proposed),
                undefined,
                "the approved limit is already where a pin would put it",
              );
              assert(
                direction === "down"
                  ? measurement <= proposed
                  : measurement >= proposed,
                "the measurement holds under its own proposed limit",
              );
            }
          }
        }
      },
    "A proposal states its limit rule before any measurement exists": () => {
      assertEquals(
        proposedLimitRule({ direction: "down", margin: 0 }),
        "the measured value",
      );
      assertEquals(
        proposedLimitRule({ direction: "down", margin: 50 }),
        "the measured value plus its margin 50",
      );
      assertEquals(
        proposedLimitRule({ direction: "up", margin: 0.5 }),
        "the measured value less its margin 0.5",
      );
    },
    "Proposal figures name the measurement, margin, and limit separately":
      () => {
        assertEquals(
          standardLimitProposalFigures({
            trunk_limit: 1000,
            proposed_limit: 1090,
            measurement: 1040,
            margin: 50,
            delta: 90,
          }),
          "1000 → 1090 (measured 1040; margin 50; delta +90)",
        );
        assertEquals(
          standardLimitProposalFigures({
            trunk_limit: 1000,
            proposed_limit: 1040,
            measurement: 1040,
            delta: 40,
          }),
          "1000 → 1040 (measured 1040; delta +40)",
        );
        assertEquals(
          standardLimitProposalFigures({
            trunk_limit: 90,
            proposed_limit: 87.5,
            measurement: 88,
            margin: 0.5,
            delta: -2.5,
          }),
          "90 → 87.5 (measured 88; margin 0.5; delta -2.5)",
        );
      },
    "Standard limit proposal plan refuses held values, improvements, and prior limit edits":
      () => {
        for (const measurement of [10, 9]) {
          const decision = buildStandardLimitProposalPlan(
            context({ measurement }),
          );
          assert(!decision.ok);
          assertStringIncludes(decision.message, "does not breach");
        }
        const alreadyMoved = buildStandardLimitProposalPlan(context({
          standard: { ...plannedStandard(), limit: 11 },
        }));
        assert(!alreadyMoved.ok);
        assertStringIncludes(alreadyMoved.message, "already changes its limit");
      },
    "Standard limit proposal plan requires configured inputs and attributable changed paths":
      () => {
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
      },
    "Standard limit proposal reasons are verbatim, bounded, visible, and secret-free":
      () => {
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
        const long = validateStandardLimitReason("x".repeat(523));
        assertEquals(long.ok, false);
        if (!long.ok) {
          assertEquals(
            long.message,
            "--reason is 523 characters; remove at least 23 to meet the 500-character maximum.",
          );
        }
        for (
          const authorityClaim of [
            "Owner approved this increase.",
            "Approved by the maintainer after review.",
            "Consent has been granted for this limit.",
          ]
        ) {
          const result = validateStandardLimitReason(authorityClaim);
          assertEquals(result.ok, false);
          if (!result.ok) {
            assertStringIncludes(result.message, "technical justification");
          }
        }
      },
    "Standard proposal renewal changes only its descendant binding and current evidence":
      () => {
        const original = recordedProposal();
        const decision = buildStandardLimitProposalRebindPlan(rebindContext({
          proposal: original,
        }));
        assert(decision.ok);
        assertEquals(decision.plan.proposal, {
          ...original,
          bound_commit: "d".repeat(40),
          trunk_commit: "e".repeat(40),
          evidence_paths: ["src/final.ts"],
        });
        assertEquals(decision.plan.engine.steps.length, 2);
        assertEquals(decision.plan.engine.steps[0]?.kind, "standard");
        assertEquals(decision.plan.engine.steps[1]?.label, "rebind-size");
      },
    "Standard proposal renewal accepts an unchanged measurement under a limit that keeps a margin":
      () => {
        const standard = plannedStandard("down", '["src/**"]', 0.5);
        const original = recordedProposal({ standard });
        assertEquals(original.proposed_limit, 12.5);
        const decision = buildStandardLimitProposalRebindPlan(rebindContext({
          standard: { ...standard, limit: 12.5 },
          proposal: original,
        }));
        assert(decision.ok, decision.ok ? "" : decision.message);
        assertEquals(decision.plan.proposal, {
          ...original,
          bound_commit: "d".repeat(40),
          trunk_commit: "e".repeat(40),
          evidence_paths: ["src/final.ts"],
        });
      },
    "Standard proposal renewal refuses a changed margin, a broken limit, and a moved reading":
      () => {
        const standard = plannedStandard("down", '["src/**"]', 0.5);
        const original = recordedProposal({ standard });
        const live = { ...standard, limit: 12.5 };
        const cases: Parameters<
          typeof buildStandardLimitProposalRebindPlan
        >[0][] = [
          // The configured margin moved after the owner's limit was recorded.
          rebindContext({
            standard: { ...live, margin: 1 },
            proposal: original,
          }),
          rebindContext({
            standard: { ...live, margin: 0 },
            proposal: original,
          }),
          // A record whose limit no longer follows from its own figures.
          rebindContext({
            standard: live,
            proposal: { ...original, measurement: 12.25 },
          }),
          // A reading that still fits under the headroom is still a new fact.
          rebindContext({
            standard: live,
            proposal: original,
            measurement: 12.2,
          }),
        ];
        for (const candidate of cases) {
          const decision = buildStandardLimitProposalRebindPlan(candidate);
          assert(!decision.ok);
          assertEquals(decision.error, "proposal_stale");
          assertStringIncludes(decision.message, "obtain fresh agreement");
        }
        const moved = buildStandardLimitProposalRebindPlan(
          rebindContext({
            standard: live,
            proposal: original,
            measurement: 13,
          }),
        );
        assert(!moved.ok);
        assertStringIncludes(
          moved.message,
          "Present the new limit 13.5 (measured 13 with margin 0.5 kept as headroom), delta 3.5",
        );
      },
    "Standard proposal renewal requires origin and trunk ancestry": () => {
      for (
        const overrides of [
          { originIsAncestor: false },
          { trunkIsContained: false },
          { originShapeError: "its proposal commit changes another file" },
        ]
      ) {
        const decision = buildStandardLimitProposalRebindPlan(
          rebindContext(overrides),
        );
        assert(!decision.ok);
        assertEquals(decision.error, "proposal_stale");
      }
    },
    "Standard proposal renewal refuses every material tuple change": () => {
      const original = recordedProposal();
      const cases: Parameters<
        typeof buildStandardLimitProposalRebindPlan
      >[0][] = [
        rebindContext({ reason: "A different owner decision." }),
        rebindContext({ definitionFingerprint: "different-definition" }),
        rebindContext({ standard: { ...plannedStandard(), limit: 13 } }),
        rebindContext({ trunkLimit: 9 }),
        rebindContext({ measurement: 13 }),
        rebindContext({
          proposal: { ...original, delta: original.delta + 1 },
        }),
      ];
      for (const candidate of cases) {
        const decision = buildStandardLimitProposalRebindPlan(candidate);
        assert(!decision.ok);
        assertEquals(decision.error, "proposal_stale");
        assertStringIncludes(decision.message, "obtain fresh agreement");
      }
    },
    "Standard proposal renewal recomputes attributable paths": () => {
      const decision = buildStandardLimitProposalRebindPlan(rebindContext({
        changedPaths: ["docs/only.md"],
      }));
      assert(!decision.ok);
      assertEquals(decision.error, "proposal_stale");
      assertStringIncludes(decision.message, "no current changed path");
    },
    "Standard proposal authority includes the renewable bound commit": () => {
      const proposal = recordedProposal();
      assert(
        !sameStandardLimitProposalSet(
          [proposal],
          [{ ...proposal, bound_commit: "d".repeat(40) }],
        ),
      );
      assert(sameStandardLimitProposalSet([proposal], [{ ...proposal }]));
    },
    "A proposal is stale when a run reads its standard at another value, even inside the headroom":
      () => {
        const proposal = recordedProposal({
          standard: plannedStandard("down", '["src/**"]', 3),
        });
        assertEquals(proposal.proposed_limit, 15);
        const live = new Map([[proposal.standard, proposal]]);
        const moved = movedProposalDiagnostics(live, [
          { name: "size", value: 13 },
        ]);
        assertEquals(moved.length, 1);
        assertEquals(moved[0]?.tool, "standard:size");
        assertStringIncludes(
          moved[0]?.message ?? "",
          "this run measured 13, not the recorded 12",
        );
        // The recorded reading, a standard without a proposal, and a standard
        // this run did not read all leave the proposal alone.
        assertEquals(
          movedProposalDiagnostics(live, [
            { name: "size", value: 12 },
            { name: "other", value: 99 },
            { name: "size" },
          ]),
          [],
        );
      },
    "Standard proposal authority includes a kept margin and leaves other identities alone":
      () => {
        const exact = recordedProposal();
        assertEquals(
          decodeWith(
            z.array(z.unknown()),
            standardLimitProposalIdentity(exact),
          ).length,
          14,
          "a proposal without headroom keeps the identity it has always had",
        );
        const withMargin = recordedProposal({
          standard: plannedStandard("down", '["src/**"]', 0.5),
        });
        assert(
          !sameStandardLimitProposalSet(
            [withMargin],
            [{ ...withMargin, margin: 0.25 }],
          ),
        );
        assert(sameStandardLimitProposalSet([withMargin], [{ ...withMargin }]));
      },
  });
});
