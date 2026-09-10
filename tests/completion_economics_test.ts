import { completionEconomicsLines } from "../src/shared/completion_economics_presentation.ts";
import { assert, assertEquals } from "@std/assert";
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

Deno.test("completion economics retains distinct return executors without multiplying recovery outcomes", () => {
  const first = event("return-first", {
    kind: "restoration",
    outcome: "recovery-incomplete",
  });
  const next = event("return-next", first.fact, {
    at: 1100,
    executor_operation: "recovery-caller",
  });
  const restored = event("return-restored", {
    kind: "restoration",
    outcome: "restored",
  }, {
    at: 1200,
    executor_operation: "recovery-caller",
  });
  const result = completionEconomics([
    first,
    first,
    next,
    next,
    restored,
    restored,
  ]);
  assertEquals(result.executor_operations, 2);
  assertEquals(result.returns, { restored: 1 });
  assertEquals(result.observations, 3);
  assertEquals(result.duplicate_observations, 3);
  assertEquals(result.component_receipts, {});
  assertEquals(result.observed_wall.elapsed_ms, null);
});

Deno.test("completion economics requires consumer identity before counting evidence uses", () => {
  const first = event("unidentified-use", {
    kind: "producer",
    producer: "job:test",
    use: "reused",
    evidence_id: "receipt",
    outcome: "passed",
    duration_ms: 0,
  }, { attempt_id: null });
  const result = completionEconomics([first, first]);
  assertEquals(result.component_receipts, { passed: 1 });
  assertEquals(result.reused_receipts, 0);
  assertEquals(result.unknown_component_use_identity, 1);
  assertEquals(result.executed_component_groups, 0);
  assertEquals(result.producer_executions, null);
});

Deno.test("completion economics rejects one observation claiming inconsistent execution coordinates", () => {
  const first = event("receipt", {
    kind: "producer",
    producer: "job:test",
    use: "executed",
    evidence_id: "receipt",
    outcome: "passed",
    duration_ms: 0,
  });
  const result = completionEconomics([first, {
    ...first,
    environment_id: "another-environment",
  }]);
  assertEquals(result.conflicting_identities, 1);
  assertEquals(result.component_receipts, {});
});

Deno.test("native producer economics deduplicates starts, distinguishes extractors and keeps missing results unknown", () => {
  const start = event("start", {
    kind: "command-started",
    execution_id: "p",
    producer: "jobs.test",
    role: "producer",
  });
  const finish = event("finish", {
    kind: "command-finished",
    execution_id: "p",
    producer: "jobs.test",
    role: "producer",
    outcome: "cancelled",
    started_at: 10,
    finished_at: 30,
    duration_ms: 20,
  });
  const extractor = event("extractor", {
    kind: "command-started",
    execution_id: "x",
    producer: "extract:coverage",
    role: "extractor",
  });
  assert(start.fact.kind === "command-started");
  assert(finish.fact.kind === "command-finished");
  const interrupted = event("interrupted", {
    ...start.fact,
    execution_id: "interrupted",
  });
  const orphan = event("orphan", { ...finish.fact, execution_id: "orphan" });
  const events = [start, start, finish, finish, extractor, interrupted, orphan];
  for (const observation of events) {
    assertEquals(completionObservationSchema.parse(observation), observation);
  }
  const result = completionEconomics(events);
  assertEquals(CompletionEconomicsSchema.parse(result), result);
  assertEquals(result.producer_executions, 2);
  assertEquals(result.extractor_executions, 1);
  assertEquals(result.producer_results, { cancelled: 1 });
  assertEquals(result.producer_result_missing, 1);
  assertEquals(result.unmatched_command_results, 1);
  assertEquals(result.producer_work_ms, 20);
  assertEquals(result.timing.producer, {
    observations: 1,
    unknown: 0,
    sum_ms: 20,
    elapsed_ms: 20,
  });
  const conflict = completionEconomics([start, {
    ...finish,
    executor_operation: "different",
  }]);
  assertEquals(conflict.conflicting_command_identities, 1);
  assertEquals(conflict.producer_executions, null);
  const repeatedConflict = completionEconomics([start, {
    ...start,
    executor_operation: "different",
  }]);
  assertEquals(repeatedConflict.conflicting_identities, 1);
  assertEquals(repeatedConflict.producer_executions, null);
  assertEquals(
    completionEconomics([start, {
      ...finish,
      fact: { ...finish.fact, duration_ms: -1 },
    }]).producer_work_ms,
    null,
  );
  const unknown = completionEconomics([{ ...start, attempt_id: null }, {
    ...finish,
    environment_id: null,
  }]);
  assertEquals(unknown.unknown_command_identity, 2);
  assertEquals(unknown.producer_executions, null);
});

Deno.test("prediction rates require observed eligible admission and resolved ordinary outcomes", () => {
  const admitted = (id: string): CompletionEvent =>
    event(`admit-${id}`, {
      kind: "admitted",
      proof_id: `proof-${id}`,
      mode: "strict",
      eligible_prediction: true,
      expected_predecessor_candidate_id: "prefix",
    }, { candidate_id: id, at: 1 });
  const hit = event("land-hit", {
    kind: "landing",
    landing_id: "transaction",
    outcome: "landed",
    claim_kind: "normal",
  }, { candidate_id: "hit", at: 3 });
  const miss = event("miss", {
    kind: "invalidated",
    reason: "withdrawn",
    affected_candidate_ids: ["miss", "pending"],
    eligible_prediction: true,
  }, { candidate_id: "miss", at: 4 });
  const input = [
    admitted("hit"),
    admitted("miss"),
    admitted("pending"),
    hit,
    hit,
    miss,
    miss,
    event("withdraw-before", { kind: "withdrawn", admission: "before-green" }, {
      candidate_id: null,
    }),
    event("old-miss", miss.fact, { candidate_id: "old" }),
  ];
  const result = completionEconomics(input);
  assertEquals(result.eligible_predictions, 3);
  assertEquals(result.prediction_denominator, 2);
  assertEquals(result.prediction_miss_rate, 0.5);
  assertEquals(result.successful_predictions, 1);
  assertEquals(result.unresolved_predictions, 1);
  assertEquals(result.withdrawals_after_prediction, 2);
  assertEquals(result.withdrawals_before_green, 1);
  assertEquals(result.landings, 1);
  assertEquals(result.invalidated_candidate_producer_work_ms, null);
  assertEquals(completionEconomics([miss]).prediction_denominator, null);
  for (const observation of input) {
    assertEquals(completionObservationSchema.parse(observation), observation);
  }
  assertEquals(CompletionEconomicsSchema.parse(result), result);
  const emergency = completionEconomics([
    admitted("hit"),
    event("emergency", {
      ...hit.fact,
      kind: "landing",
      landing_id: "exception",
      outcome: "landed",
      claim_kind: "exception",
    }, { candidate_id: "hit", at: 4 }),
  ]);
  assertEquals(emergency.prediction_denominator, 0);
  assertEquals(emergency.prediction_miss_rate, null);
  assertEquals(emergency.conflicting_prediction_outcomes, 1);
  const contradiction = completionEconomics([
    admitted("hit"),
    hit,
    event("invalidated-hit", miss.fact, { candidate_id: "hit", at: 5 }),
  ]);
  assertEquals(contradiction.prediction_denominator, 0);
  const report = completionEconomics([
    event("report", {
      ...admitted("report").fact,
      kind: "admitted",
      proof_id: "report",
      mode: "report",
      eligible_prediction: true,
      expected_predecessor_candidate_id: "prefix",
    }),
    hit,
  ]);
  assertEquals(report.eligible_predictions, 0);
});

Deno.test("completed validation summaries establish known reuse-only zero without rewriting older history", () => {
  const summary = event("summary", {
    kind: "validation-summary",
    demand: "done",
    producer_executions: 0,
    reused_receipts: 3,
  });
  const result = completionEconomics([summary, summary]);
  assertEquals(result.producer_executions, 0);
  assertEquals(result.validation_runs, 1);
  assertEquals(result.reuse_only_runs, 1);
  assertEquals(completionEconomics([]).producer_executions, null);
  assertEquals(
    completionEconomics([{ ...summary, attempt_id: null }]).producer_executions,
    null,
  );
  assertEquals(
    completionEconomics([
      summary,
      event("changed", {
        kind: "validation-summary",
        demand: "done",
        producer_executions: 1,
        reused_receipts: 3,
      }),
    ]).producer_executions,
    null,
  );
  assertEquals(completionObservationSchema.parse(summary), summary);
  const contradictory = completionEconomics([
    summary,
    event("started", {
      kind: "command-started",
      execution_id: "native",
      role: "producer",
      producer: "jobs.test",
    }),
  ]);
  assertEquals(contradictory.producer_executions, 1);
  assertEquals(contradictory.reuse_only_runs, 0);
});

Deno.test("latency summaries keep their observations separate from overlapping phase unions", () => {
  const facts = [
    event("feedback-a", {
      kind: "timing",
      interval_id: "a",
      category: "validation-feedback",
      started_at: 0,
      finished_at: 100,
    }),
    event("feedback-b", {
      kind: "timing",
      interval_id: "b",
      category: "validation-feedback",
      started_at: 20,
      finished_at: 60,
    }),
    event("invalid-clock", {
      kind: "timing",
      interval_id: "c",
      category: "approval-to-land",
      started_at: 10,
      finished_at: 9,
    }),
  ];
  const result = completionEconomics(facts);
  assertEquals(result.latencies?.["validation-feedback"], {
    observations: 2,
    unknown: 0,
    median_ms: 70,
    min_ms: 40,
    max_ms: 100,
  });
  assertEquals(result.timing["validation-feedback"]?.elapsed_ms, 100);
  assertEquals(result.latencies?.["approval-to-land"]?.median_ms, null);
  const lines = completionEconomicsLines(result).join("\n");
  assert(lines.includes("0.07s median across 2 observations"));
  assert(lines.includes("Native producer executions: unknown"));
  assert(lines.includes("denominator unknown"));
  assertEquals(CompletionEconomicsSchema.parse(result), result);
  assert(
    completionEconomicsLines({
      ...result,
      window: { first_at: 1e100, last_at: null },
    })[0]?.includes("unknown to unknown"),
  );
});
