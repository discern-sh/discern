/** Advisory accounting over emitted completion facts, never an ownership reader. */
import type { CompletionEvent } from "../completion/protocol.ts";
import { canonicalJson } from "./validation.ts";
import type {
  CompletionEconomics,
  CompletionIntervalEconomics,
} from "../../shared/patterns_vocabulary.ts";
export type { CompletionEconomics } from "../../shared/patterns_vocabulary.ts";

type TimingFact = Extract<CompletionEvent["fact"], { kind: "timing" }>;

export interface ObservedInterval {
  readonly started_at: number;
  readonly finished_at: number;
}

export type IntervalEconomics = CompletionIntervalEconomics;

/** Invalid or omitted clocks cannot create negative costs or fabricated zeros. */
export function intervalEconomics(
  intervals: readonly ObservedInterval[],
): IntervalEconomics {
  const valid = intervals.filter((interval) =>
    Number.isFinite(interval.started_at) &&
    Number.isFinite(interval.finished_at) &&
    interval.started_at >= 0 && interval.finished_at >= interval.started_at
  ).toSorted((a, b) => a.started_at - b.started_at);
  let sum = 0;
  let elapsed = 0;
  let end = -Infinity;
  for (const interval of valid) {
    sum += interval.finished_at - interval.started_at;
    elapsed += Math.max(
      0,
      interval.finished_at - Math.max(end, interval.started_at),
    );
    end = Math.max(end, interval.finished_at);
  }
  return {
    observations: valid.length,
    unknown: intervals.length - valid.length,
    sum_ms: valid.length === 0 ? null : sum,
    elapsed_ms: valid.length === 0 ? null : elapsed,
  };
}

/** Coordinates bind the fact being observed, not the caller's checkout or branch. */
function observationIdentity(event: CompletionEvent): string {
  const fact = event.fact;
  switch (fact.kind) {
    case "producer":
      if (event.attempt_id === null) return event.id;
      return canonicalJson([
        fact.kind,
        event.attempt_id,
        fact.use,
        fact.evidence_id,
      ]);
    case "timing":
      return canonicalJson([
        fact.kind,
        event.executor_operation,
        fact.category,
        fact.interval_id,
      ]);
    case "restoration":
      if (event.environment_id === null || event.attempt_id === null) {
        return event.id;
      }
      return canonicalJson([
        fact.kind,
        event.environment_id,
        event.attempt_id,
        fact.outcome,
      ]);
    case "invalidated":
    case "landing":
    case "retirement":
      return event.id;
  }
}

/** Repeated delivery contributes once. Contradictory facts retain an explicit gap. */
function uniqueObservations(events: readonly CompletionEvent[]): {
  events: CompletionEvent[];
  duplicates: number;
  conflicts: number;
} {
  const unique = new Map<string, CompletionEvent>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  for (const event of events) {
    const key = observationIdentity(event);
    const prior = unique.get(key);
    if (prior === undefined) unique.set(key, event);
    else if (
      canonicalJson(prior.fact) !== canonicalJson(event.fact) ||
      prior.effort_id !== event.effort_id ||
      prior.source_head !== event.source_head ||
      prior.candidate_id !== event.candidate_id
    ) conflicts.add(key);
    else duplicates += 1;
  }
  return {
    events: [...unique.entries()].filter(([key]) => !conflicts.has(key)).map((
      [, event],
    ) => event)
      .toSorted((a, b) => a.at - b.at),
    duplicates,
    conflicts: conflicts.size,
  };
}

/** Count a recorded outcome without adding unobserved categories. */
function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Read the historical contract at its actual resolution; absent newer facts stay unknown. */
export function completionEconomics(
  observations: readonly CompletionEvent[],
): CompletionEconomics {
  const unique = uniqueObservations(observations);
  const events = unique.events;
  const timings = new Map<TimingFact["category"], ObservedInterval[]>();
  const components = new Map<string, string>();
  const executions = new Set<string>();
  const reused = new Set<string>();
  const invalidations = new Map<string, Set<string>>();
  const predictions = new Set<string>();
  const withdrawnPredictions = new Set<string>();
  const otherWithdrawals = new Set<string>();
  const landed = new Map<
    string,
    Extract<CompletionEvent["fact"], { kind: "landing" }>["claim_kind"]
  >();
  const retirements = new Map<string, string>();
  const returns = new Map<string, string>();
  let unknownReturnIdentity = 0;
  for (const event of events) {
    const fact = event.fact;
    switch (fact.kind) {
      case "producer":
        components.set(fact.evidence_id, fact.outcome);
        if (fact.use === "reused") {
          reused.add(canonicalJson([event.attempt_id, fact.evidence_id]));
        } else if (event.attempt_id !== null) {
          executions.add(canonicalJson([event.attempt_id, fact.producer]));
        }
        break;
      case "timing": {
        const intervals = timings.get(fact.category) ?? [];
        intervals.push(fact);
        timings.set(fact.category, intervals);
        break;
      }
      case "invalidated": {
        const ids = invalidations.get(fact.reason) ?? new Set<string>();
        // One emitted row describes its own candidate. The affected list is
        // context shared by every row, not another set of independent events.
        if (event.candidate_id !== null) {
          ids.add(event.candidate_id);
          if (fact.eligible_prediction) predictions.add(event.candidate_id);
          if (fact.reason === "withdrawn") {
            (fact.eligible_prediction ? withdrawnPredictions : otherWithdrawals)
              .add(event.candidate_id);
          }
        }
        invalidations.set(fact.reason, ids);
        break;
      }
      case "landing":
        if (fact.outcome === "landed") {
          landed.set(fact.landing_id, fact.claim_kind);
        }
        break;
      case "retirement":
        retirements.set(fact.retirement_id, fact.outcome);
        break;
      case "restoration":
        if (event.environment_id === null || event.attempt_id === null) {
          unknownReturnIdentity += 1;
        } else {returns.set(
            canonicalJson([event.environment_id, event.attempt_id]),
            fact.outcome,
          );}
        break;
    }
  }
  const counts = (values: Iterable<string>): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const value of values) increment(result, value);
    return result;
  };
  const distinct = (read: (event: CompletionEvent) => string | null): number =>
    new Set(events.map(read).filter((value) => value !== null)).size;
  const times = events.map((event) => event.at).filter(Number.isFinite);
  return {
    window: { first_at: times[0] ?? null, last_at: times.at(-1) ?? null },
    observations: events.length,
    duplicate_observations: unique.duplicates,
    conflicting_identities: unique.conflicts,
    efforts: distinct((event) => event.effort_id),
    candidates: distinct((event) => event.candidate_id),
    attempts: distinct((event) => event.attempt_id),
    executor_operations: distinct((event) => event.executor_operation),
    component_receipts: counts(components.values()),
    executed_component_groups: executions.size,
    reused_receipts: reused.size,
    producer_executions: null,
    timing: Object.fromEntries(
      [...timings].map((
        [category, intervals],
      ) => [category, intervalEconomics(intervals)]),
    ),
    observed_wall: intervalEconomics([...timings.values()].flat()),
    invalidations: Object.fromEntries(
      [...invalidations].map(([reason, ids]) => [reason, ids.size]),
    ),
    invalidated_predictions: predictions.size,
    prediction_denominator: null,
    prediction_miss_rate: null,
    withdrawals_after_prediction: withdrawnPredictions.size,
    withdrawals_without_prediction_evidence: otherWithdrawals.size,
    landings: landed.size,
    emergency_landings:
      [...landed.values()].filter((kind) => kind === "exception").length,
    retirements: counts(retirements.values()),
    returns: counts(returns.values()),
    unknown_return_identity: unknownReturnIdentity,
    limitations: [
      "This advisory window cannot establish ownership, child quiescence, recovery permission, or Proof.",
      "Component receipts do not identify physical process starts; their durations must not be summed as producer work.",
      "Invalidations do not supply all eligible predictions; a miss rate needs observed admission and resolved outcomes.",
      "A missing return duration or recovery executor identity is unknown; an interrupted attempt has no inferred failed verdict.",
      "Category spans can overlap. Their sums are separate work observations, not additive elapsed completion time or CPU time.",
      "Retirement outcomes do not establish storage reclamation or a leak; retained historical references remain valid.",
    ],
  };
}
