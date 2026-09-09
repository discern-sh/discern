import { assertEquals } from "@std/assert";
import type { CompletionEvent } from "../src/engine/completion/protocol.ts";
import { EvidenceSchema } from "../src/engine/completion/evidence.ts";
import {
  completionEconomics,
  intervalEconomics,
} from "../src/engine/logbook/completion_economics.ts";
import { completionObservationSchema } from "../src/engine/logbook/completion_schema.ts";
import { CompletionEconomicsSchema } from "../src/shared/patterns_vocabulary.ts";

/** One canonical observation with explicit source and executor coordinates. */
function event(
  id: string,
  fact: CompletionEvent["fact"],
  over: Partial<CompletionEvent> = {},
): CompletionEvent {
  return {
    id,
    at: 1000,
    effort_id: "source",
    source_head: "source-head",
    candidate_id: "candidate",
    environment_id: "environment",
    attempt_id: "attempt",
    executor_operation: "executor",
    fact,
    ...over,
  };
}

Deno.test("completion economics keeps overlapping wall spans separate from work sums and unknown clocks", () => {
  assertEquals(intervalEconomics([]), {
    observations: 0,
    unknown: 0,
    sum_ms: null,
    elapsed_ms: null,
  });
  const intervals = [
    { started_at: 10, finished_at: 110 },
    { started_at: 20, finished_at: 70 },
    { started_at: 90, finished_at: 200 },
    { started_at: 230, finished_at: 230 },
    { started_at: 9, finished_at: 3 },
    { started_at: NaN, finished_at: 20 },
  ];
  assertEquals(intervalEconomics(intervals), {
    observations: 4,
    unknown: 2,
    sum_ms: 260,
    elapsed_ms: 190,
  });
  const ledger = completionEconomics(
    intervals.slice(0, 3).map((interval, i) =>
      event(`span-${i}`, {
        kind: "timing",
        category: i === 0 ? "execution" : "environment",
        interval_id: `interval-${i}`,
        ...interval,
      })
    ),
  );
  assertEquals(ledger.observed_wall.elapsed_ms, 190);
  assertEquals(ledger.timing.environment?.elapsed_ms, 160);
});

Deno.test("completion economics counts receipts and reuse without inventing physical executions or failures", () => {
  const outcomes = EvidenceSchema.shape.outcome.options.map((schema) =>
    schema.shape.kind.value
  );
  const receipts = outcomes.map((outcome, i) =>
    event(`receipt-${i}`, {
      kind: "producer",
      producer: "job:shared",
      use: "executed",
      evidence_id: `evidence-${i}`,
      outcome,
      duration_ms: 500,
    })
  );
  const reuse = event("reuse", {
    kind: "producer",
    producer: "job:shared",
    use: "reused",
    evidence_id: "evidence-0",
    outcome: "passed",
    duration_ms: 0,
  }, {
    attempt_id: "consumer",
    candidate_id: "new-candidate",
    executor_operation: "cooperative-actor",
  });
  const result = completionEconomics([...receipts, reuse, reuse]);
  for (const receipt of receipts) {
    assertEquals<CompletionEvent>(
      completionObservationSchema.parse(receipt),
      receipt,
    );
  }
  assertEquals(CompletionEconomicsSchema.parse(result), result);
  assertEquals(
    result.component_receipts,
    Object.fromEntries(outcomes.map((outcome) => [outcome, 1])),
  );
  assertEquals(result.executed_component_groups, 1);
  assertEquals(result.producer_executions, null);
  assertEquals(result.reused_receipts, 1);
  assertEquals(result.duplicate_observations, 1);
  assertEquals(result.efforts, 1);
  assertEquals(result.executor_operations, 2);
  assertEquals(result.candidates, 2);
});

Deno.test("completion economics deduplicates resumed landing and return observations independently of cleanup", () => {
  const returning = event("return", {
    kind: "restoration",
    outcome: "recovery-incomplete",
  });
  const restored = event(
    "return",
    { kind: "restoration", outcome: "restored" },
    { at: 1500 },
  );
  const landing = event("landing:2", {
    kind: "landing",
    landing_id: "transaction",
    outcome: "landed",
    claim_kind: "exception",
  });
  const later = event("landing:3", landing.fact, { at: 2000 });
  const retirement = event("retired", {
    kind: "retirement",
    retirement_id: "cleanup",
    outcome: "retired",
  });
  const unrelated = event("retained", {
    kind: "retirement",
    retirement_id: "historical-cleanup",
    outcome: "retained",
  });
  const result = completionEconomics([
    returning,
    returning,
    restored,
    restored,
    landing,
    later,
    retirement,
    unrelated,
  ]);
  assertEquals(result.returns, { restored: 1 });
  assertEquals(result.landings, 1);
  assertEquals(result.emergency_landings, 1);
  assertEquals(result.retirements, { retired: 1, retained: 1 });
  assertEquals(result.component_receipts, {});
  assertEquals(result.observed_wall.elapsed_ms, null);
});

Deno.test("completion economics never treats a whole-effort withdrawal rate as prediction accuracy", () => {
  const withdrawals = [true, false].map((eligible_prediction, i) =>
    event(`withdraw-${i}`, {
      kind: "invalidated",
      reason: "withdrawn",
      affected_candidate_ids: ["a", "b"],
      eligible_prediction,
    }, { candidate_id: i === 0 ? "a" : "b" })
  );
  const result = completionEconomics([...withdrawals, ...withdrawals]);
  assertEquals(result.invalidations, { withdrawn: 2 });
  assertEquals(result.invalidated_predictions, 1);
  assertEquals(result.withdrawals_after_prediction, 1);
  assertEquals(result.withdrawals_without_prediction_evidence, 1);
  assertEquals(result.prediction_denominator, null);
  assertEquals(result.prediction_miss_rate, null);
});

Deno.test("completion economics preserves sparse and conflicting evidence as unknown", () => {
  const first = event("receipt", {
    kind: "producer",
    producer: "future:independent",
    use: "executed",
    evidence_id: "receipt",
    outcome: "passed",
    duration_ms: 0,
  });
  const conflicting = event("receipt", {
    ...first.fact,
    kind: "producer",
    producer: "future:independent",
    use: "executed",
    evidence_id: "receipt",
    outcome: "failed",
    duration_ms: 0,
  });
  const result = completionEconomics([
    first,
    conflicting,
    event("unknown-return", { kind: "restoration", outcome: "restored" }, {
      environment_id: null,
      attempt_id: null,
    }),
  ]);
  assertEquals(result.conflicting_identities, 1);
  assertEquals(result.component_receipts, {});
  assertEquals(result.unknown_return_identity, 1);
  assertEquals(completionEconomics([]).window, {
    first_at: null,
    last_at: null,
  });
});

Deno.test("completion economics rejects contradictory immutable receipts across consuming attempts", () => {
  const producer = event("produced", {
    kind: "producer",
    producer: "job:test",
    use: "executed",
    evidence_id: "receipt",
    outcome: "passed",
    duration_ms: 500,
  });
  const reused = event("reused", {
    kind: "producer",
    producer: "job:test",
    use: "reused",
    evidence_id: "receipt",
    outcome: "failed",
    duration_ms: 0,
  }, { attempt_id: "consumer", candidate_id: "next" });
  for (const events of [[producer, reused], [reused, producer]]) {
    const result = completionEconomics(events);
    assertEquals(result.conflicting_component_receipts, 1);
    assertEquals(result.component_receipts, {});
    assertEquals(result.reused_receipts, 0);
    assertEquals(result.executed_component_groups, 0);
  }
});
