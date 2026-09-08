/** Retirement execution and presentation select the same durable decision. */
import { assertEquals } from "@std/assert";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
} from "../src/engine/completion/records.ts";
import type { CompletionRetirement } from "../src/engine/completion/outcomes.ts";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import { planQueueRetirement } from "../src/engine/landing_queue/retirement.ts";
import {
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("retirement projection preserves settled cleanup across every earlier outcome and record order", () => {
  const fixtures = completionFixtures();
  const sourceLanding = COMPLETION_FAMILIES.landing.schema.parse(
    fixtures.landing,
  );
  const landing = {
    ...sourceLanding,
    data: {
      ...sourceLanding.data,
      outcome: {
        kind: "landed" as const,
        at: 100,
        transition_marker: completionId(30),
      },
      authority_settlement: "consumed" as const,
    },
  };
  const sourceRetirement = COMPLETION_FAMILIES.retirement.schema.parse(
    fixtures.retirement,
  );
  const capture = COMPLETION_FAMILIES.presentation.schema.parse(
    fixtures.presentation,
  ).data.artifact;
  const outcomes: {
    [K in CompletionRetirement["outcome"]["kind"]]: Extract<
      CompletionRetirement["outcome"],
      { kind: K }
    >;
  } = {
    pending: { kind: "pending" },
    retained: { kind: "retained", reason: "dirty" },
    recovery: {
      kind: "recovery",
      recovery: RecoverySchema.parse(COMPLETION_RECOVERY),
    },
    retired: { kind: "retired", at: 110 },
  };
  const retired = {
    ...sourceRetirement,
    id: completionId(31),
    data: { ...sourceRetirement.data, capture, outcome: outcomes.retired },
  };
  for (const outcome of Object.values(outcomes)) {
    const earlier = {
      ...sourceRetirement,
      data: { ...sourceRetirement.data, capture, outcome },
    };
    for (const records of [[earlier, retired], [retired, earlier]]) {
      const plan = planQueueRetirement(landing, records);
      assertEquals(plan.kind, "settled");
      if (plan.kind === "settled") {
        assertEquals(plan.outcome.kind, "retired");
      }
    }
  }
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    fixtures.environment,
  );
  const held = {
    ...environment,
    data: { ...environment.data, release: { kind: "held" as const } },
  };
  assertEquals(planQueueRetirement(landing, [held]), {
    kind: "settled",
    outcome: { kind: "retained", reason: "unreleased" },
  });
  assertEquals(planQueueRetirement(landing, [environment]).kind, "inspect");
  const unrelated: CompletionRecord = {
    ...retired,
    data: { ...retired.data, landing_id: completionId(32) },
  };
  assertEquals(planQueueRetirement(landing, [unrelated, held]), {
    kind: "settled",
    outcome: { kind: "retained", reason: "unreleased" },
  });
});
