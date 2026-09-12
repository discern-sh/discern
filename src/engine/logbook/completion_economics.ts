/** Advisory accounting over emitted completion facts, never an ownership reader. */
import type { CompletionEvent } from "../completion/protocol.ts";
import { canonicalJson } from "./validation.ts";
import { median } from "./summary_math.ts";
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
    case "proven":
      return canonicalJson([fact.kind, fact.proof_id]);
    case "validation-summary":
      return canonicalJson([
        fact.kind,
        event.attempt_id ?? event.id,
        event.executor_operation,
      ]);
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
    case "invalidated":
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
    if (event.attempt_id === null || fact.execution_id === "") {
      unknown++;
      continue;
    }
    const signature = canonicalJson([
      event.effort_id,
      event.source_head,
      event.candidate_id,
      event.attempt_id,
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

/** Read each recorded contract at its declared resolution; absent facts stay unknown. */
export function completionEconomics(
  observations: readonly CompletionEvent[],
): CompletionEconomics {
  const unique = uniqueObservations(observations);
  const receiptConflicts = conflictingReceipts(observations);
  const events = unique.events;
  const summaries = events.filter((event) =>
    event.fact.kind === "validation-summary" && event.attempt_id !== null
  );
  const startedAttempts = new Set(
    events.filter((event) =>
      event.fact.kind === "command-started" && event.fact.role === "producer"
    )
      .map((event) => event.attempt_id),
  );
  const reuseOnly = summaries.filter((event) =>
    event.fact.kind === "validation-summary" &&
    event.fact.producer_executions === 0 &&
    !startedAttempts.has(event.attempt_id) && event.fact.reused_receipts > 0
  );
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
  const proofs = new Set<string>();
  let unknownComponentUseIdentity = 0;
  for (const event of events) {
    const fact = event.fact;
    switch (fact.kind) {
      case "proven":
        if (fact.mode === "strict") proofs.add(fact.proof_id);
        break;
      case "validation-summary":
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
        // One emitted row describes its own candidate. The affected list is
        // context shared by every row, not another set of independent events.
        const ids = invalidations.get(fact.reason) ?? new Set<string>();
        if (event.candidate_id !== null) ids.add(event.candidate_id);
        invalidations.set(fact.reason, ids);
        break;
      }
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
    producer_executions: commands.producer_executions ??
      (summaries.length > 0 &&
          summaries.every((event) =>
            event.fact.kind === "validation-summary" &&
            event.fact.producer_executions === 0
          ) &&
          commands.unknown_command_identity === 0 &&
          commands.unmatched_command_results === 0 &&
          commands.conflicting_command_identities === 0 &&
          unique.conflicts === 0
        ? 0
        : null),
    validation_runs: summaries.length,
    reuse_only_runs: reuseOnly.length,
    proofs: proofs.size,
    latencies: Object.fromEntries(
      (["validation-feedback"] as const).map((category) => {
        const intervals = timings.get(category) ?? [];
        const durations = intervals.filter((span) =>
          Number.isFinite(span.started_at) &&
          Number.isFinite(span.finished_at) && span.started_at >= 0 &&
          span.finished_at >= span.started_at
        )
          .map((span) => span.finished_at - span.started_at);
        return [category, {
          observations: durations.length,
          unknown: intervals.length - durations.length,
          median_ms: durations.length === 0 ? null : median(durations),
          min_ms: durations.length === 0
            ? null
            : durations.reduce((min, value) => Math.min(min, value), Infinity),
          max_ms: durations.length === 0
            ? null
            : durations.reduce((max, value) => Math.max(max, value), -Infinity),
        }];
      }),
    ),
    timing: Object.fromEntries(
      [...timings].map((
        [category, intervals],
      ) => [category, intervalEconomics(intervals)]),
    ),
    observed_wall: intervalEconomics([...timings.values()].flat()),
    invalidations: Object.fromEntries(
      [...invalidations].map(([reason, ids]) => [reason, ids.size]),
    ),
    limitations: [
      "This advisory window cannot establish ownership, child quiescence, or Proof.",
      "Producer executions count only observed native starts. Missing starts, results or older events make the window incomplete; an unmatched start establishes neither activity nor death.",
      "Producer work is summed command-to-captured-result elapsed duration, not CPU time. Component receipts and extractor processes do not multiply producer executions.",
      "Invalidated work may be reused and is not automatically discarded.",
      "Category spans can overlap. Their sums are separate work observations, not additive elapsed completion time or CPU time.",
    ],
  };
}
