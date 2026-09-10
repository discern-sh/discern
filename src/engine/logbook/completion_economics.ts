/** Advisory accounting over emitted completion facts, never an ownership reader. */
import type { CompletionEvent } from "../completion/protocol.ts";
import { canonicalJson } from "./validation.ts";
import type {
  CompletionEconomics,
  CompletionIntervalEconomics,
} from "../../shared/patterns_vocabulary.ts";

type TimingFact = Extract<CompletionEvent["fact"], { kind: "timing" }>;

interface ObservedInterval {
  readonly started_at: number;
  readonly finished_at: number;
}

/** Invalid or omitted clocks cannot create negative costs or fabricated zeros. */
export function intervalEconomics(
  intervals: readonly ObservedInterval[],
): CompletionIntervalEconomics {
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
    case "command-started":
    case "command-finished":
      return canonicalJson([fact.kind, fact.execution_id]);
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
        event.executor_operation,
        fact.outcome,
      ]);
    case "invalidated":
    case "landing":
    case "retirement":
      return event.id;
  }
}

/** Native starts count executions; missing completion observations never supply a verdict. */
function commandObservations(events: readonly CompletionEvent[]): {
  producer_executions: number | null;
  extractor_executions: number | null;
  producer_results: Record<string, number>;
  producer_result_missing: number;
  unknown_command_identity: number;
  conflicting_command_identities: number;
  unmatched_command_results: number;
  producer_work_ms: number | null;
  intervals: {
    category: "producer" | "extraction";
    interval: ObservedInterval;
  }[];
} {
  type Finished = Extract<
    CompletionEvent["fact"],
    { kind: "command-finished" }
  >;
  const commands = new Map<string, {
    signature: string;
    role: "producer" | "extractor";
    started: boolean;
    finished?: Finished;
  }>();
  const conflicts = new Set<string>();
  let unknown = 0;
  for (const event of events) {
    const fact = event.fact;
    if (fact.kind !== "command-started" && fact.kind !== "command-finished") {
      continue;
    }
    if (
      event.attempt_id === null || event.environment_id === null ||
      fact.execution_id === ""
    ) {
      unknown++;
      continue;
    }
    const signature = canonicalJson([
      event.effort_id,
      event.source_head,
      event.candidate_id,
      event.attempt_id,
      event.environment_id,
      event.executor_operation,
      fact.producer,
      fact.role,
    ]);
    const command = commands.get(fact.execution_id) ??
      { signature, role: fact.role, started: false };
    if (command.signature !== signature) conflicts.add(fact.execution_id);
    if (fact.kind === "command-started") command.started = true;
    else command.finished = fact;
    commands.set(fact.execution_id, command);
  }
  const known = [...commands].filter(([id]) => !conflicts.has(id)).map((
    [, value],
  ) => value);
  const started = known.filter((command) => command.started);
  const producers = started.filter((command) => command.role === "producer");
  const finished = producers.flatMap((command) =>
    command.finished === undefined ? [] : [command.finished]
  );
  const results: Record<string, number> = {};
  const durations = finished.map((result) => result.duration_ms).filter((
    value,
  ) => Number.isFinite(value) && value >= 0);
  for (const result of finished) increment(results, result.outcome);
  return {
    producer_executions: producers.length === 0 ? null : producers.length,
    extractor_executions:
      started.some((command) => command.role === "extractor")
        ? started.filter((command) => command.role === "extractor").length
        : null,
    producer_results: results,
    producer_result_missing: producers.length - finished.length,
    unknown_command_identity: unknown,
    conflicting_command_identities: conflicts.size,
    unmatched_command_results:
      known.filter((command) =>
        !command.started && command.finished !== undefined
      ).length,
    producer_work_ms: durations.length === 0
      ? null
      : durations.reduce((sum, duration) => sum + duration, 0),
    intervals: started.flatMap((command) =>
      command.finished === undefined ? [] : [{
        category: command.role === "producer"
          ? "producer" as const
          : "extraction" as const,
        interval: command.finished,
      }]
    ),
  };
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
      prior.candidate_id !== event.candidate_id ||
      prior.environment_id !== event.environment_id ||
      prior.attempt_id !== event.attempt_id ||
      ((event.fact.kind === "command-started" ||
        event.fact.kind === "command-finished") &&
        prior.executor_operation !== event.executor_operation)
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

/** An immutable receipt keeps its producer and verdict across every consumer. */
function conflictingReceipts(events: readonly CompletionEvent[]): Set<string> {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const { fact } of events) {
    if (fact.kind !== "producer") continue;
    const signature = canonicalJson([fact.producer, fact.outcome]);
    const prior = seen.get(fact.evidence_id);
    if (prior !== undefined && prior !== signature) {
      conflicts.add(fact.evidence_id);
    }
    seen.set(fact.evidence_id, signature);
  }
  return conflicts;
}

/** Read the historical contract at its actual resolution; absent newer facts stay unknown. */
export function completionEconomics(
  observations: readonly CompletionEvent[],
): CompletionEconomics {
  const unique = uniqueObservations(observations);
  const receiptConflicts = conflictingReceipts(observations);
  const events = unique.events;
  const { intervals: commandIntervals, ...commands } = commandObservations(
    events,
  );
  const timings = new Map<TimingFact["category"], ObservedInterval[]>();
  for (const { category, interval } of commandIntervals) {
    const prior = timings.get(category) ?? [];
    prior.push(interval);
    timings.set(category, prior);
  }
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
  let unknownComponentUseIdentity = 0;
  for (const event of events) {
    const fact = event.fact;
    switch (fact.kind) {
      case "command-started":
      case "command-finished":
        break;
      case "producer":
        if (receiptConflicts.has(fact.evidence_id)) break;
        components.set(fact.evidence_id, fact.outcome);
        if (event.attempt_id === null) {
          unknownComponentUseIdentity += 1;
          break;
        }
        if (fact.use === "reused") {
          reused.add(canonicalJson([event.attempt_id, fact.evidence_id]));
        } else {
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
    conflicting_component_receipts: receiptConflicts.size,
    efforts: distinct((event) => event.effort_id),
    candidates: distinct((event) => event.candidate_id),
    attempts: distinct((event) => event.attempt_id),
    executor_operations: distinct((event) => event.executor_operation),
    component_receipts: counts(components.values()),
    executed_component_groups: executions.size,
    reused_receipts: reused.size,
    unknown_component_use_identity: unknownComponentUseIdentity,
    ...commands,
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
      "Producer executions count only observed native starts. Missing starts, results or older events make the window incomplete; an unmatched start establishes neither activity nor death.",
      "Producer work is summed command-to-captured-result elapsed duration, not CPU time. Component receipts and extractor processes do not multiply producer executions.",
      "Invalidations do not supply all eligible predictions; a miss rate needs observed admission and resolved outcomes.",
      "A missing return duration or recovery executor identity is unknown; an interrupted attempt has no inferred failed verdict.",
      "Category spans can overlap. Their sums are separate work observations, not additive elapsed completion time or CPU time.",
      "Retirement outcomes do not establish storage reclamation or a leak; retained historical references remain valid.",
    ],
  };
}
