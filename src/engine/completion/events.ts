/** Invocation-scoped advisory facts; observers have no validation or publication capability. */
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import type { Clock } from "../../shared/clock.ts";
import { candidateAuthor } from "./candidate.ts";
import type { CompletionEvent, ValidationSubject } from "./protocol.ts";
import type { ComponentEvidence } from "./evidence.ts";

/**
 * Counts one producer reported about its own current run. Every field is an
 * observed fact: an absent field is unknown, and `total: null` is a valid
 * unknown total. Consumers present the counts as counts — unequal units mean
 * no percentage or time estimate can be derived from them.
 */
export interface ProducerWork {
  /** The reporting producer's selector; one shared producer counts once. */
  readonly producer: string;
  readonly units?: {
    /** What the producer's units are, in its own words (e.g. "partitions"). */
    readonly kind: string;
    readonly completed: number;
    readonly total: number | null;
  };
  /** Only counts the producer actually reported; an absent count is unknown. */
  readonly results?: {
    readonly passed?: number;
    readonly failed?: number;
    readonly skipped?: number;
  };
  /** Labels of the work currently running, in the producer's own vocabulary. */
  readonly active?: readonly string[];
  /** The producer's own elapsed time — not the command's, budget's, or return's. */
  readonly elapsed_ms?: number;
  /** True when the reported counts cover only part of the completed units. */
  readonly partial?: boolean;
  /** Engine-observed path of the settled producer's full captured output. */
  readonly output_path?: string;
}

/**
 * One failure a still-running producer has already established. Advisory: the
 * producer's final verdict comes from its component evidence, never from this
 * projection, and a running producer with reported failures is still running.
 */
export interface CompletionFailure {
  readonly producer: string;
  /** The failing test or obligation, named exactly. */
  readonly name: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  /** Focused reproduction carrying the recorded seed and instrumentation. */
  readonly reproduce_cmd?: string;
  /** True when the report this failure came from is itself incomplete. */
  readonly partial: boolean;
}

/** The next piece of work or the exact reason it is pending, without output-log payloads. */
export interface CompletionProgress {
  /** `queue` is the test-run slot queue a producer may wait in. */
  readonly phase: "producer" | "queue" | "pending" | "operation";
  readonly state: string;
  readonly candidate_id: string | null;
  readonly reason: string;
  /** The running operation's reconnect handle, announced once at its start. */
  readonly operation_handle?: string;
  /** What happens after the current work, when the transition is known. */
  readonly next?: string;
  /** True only when no actor can proceed until the owner decides something. */
  readonly owner_must_act?: boolean;
  /** Producer-reported counts, present only where a producer supplies them. */
  readonly work?: ProducerWork;
  readonly attempt_id?: string;
}
export type CompletionObservationFact =
  | { readonly kind: "event"; readonly event: CompletionEvent }
  | { readonly kind: "progress"; readonly progress: CompletionProgress }
  | { readonly kind: "failure"; readonly failure: CompletionFailure };
interface ObservationScope {
  readonly sink: (fact: CompletionObservationFact) => void | Promise<void>;
  readonly deliveries: Promise<void>[];
  readonly parent: ObservationScope | undefined;
}
const OBSERVERS = new AsyncLocalStorage<ObservationScope>();

/** Keep concurrent calls separate and settle every delivery without changing the operation's result. */
export async function withCompletionObserver<T>(
  sink: ObservationScope["sink"],
  operation: () => Promise<T>,
): Promise<T> {
  const scope: ObservationScope = {
    sink,
    deliveries: [],
    parent: OBSERVERS.getStore(),
  };
  return await OBSERVERS.run(scope, async () => {
    try {
      return await operation();
    } finally {
      // Delivery is advisory. A failed observer cannot undo or repeat a durable effect.
      await Promise.allSettled(scope.deliveries);
    }
  });
}

/** Observers receive a detached value after the emitter has decided the fact. */
function emit(fact: CompletionObservationFact): void {
  for (
    let scope = OBSERVERS.getStore();
    scope !== undefined;
    scope = scope.parent
  ) {
    const observer = scope;
    const copy = structuredClone(fact);
    const delivery = Promise.resolve().then(() => observer.sink(copy));
    // Each observer receives its own copy; presentation cannot consume recorder facts.
    observer.deliveries.push(Promise.allSettled([delivery]).then(() => {}));
  }
}

/** Expose the current phase or pending reason without starting any work. */
export function emitCompletionProgress(progress: CompletionProgress): void {
  emit({ kind: "progress", progress });
}
/** Report a failure the moment it is known, ahead of the producer's verdict. */
export function emitCompletionFailure(failure: CompletionFailure): void {
  emit({ kind: "failure", failure });
}
/** Deliver an advisory projection of an established outcome. */
export function emitCompletionEvent(event: CompletionEvent): void {
  emit({ kind: "event", event });
}

/** Build attribution from an actual execution, not the observing process's current checkout. */
export function executionEvent(
  execution: ValidationSubject,
  id: string,
  at: number,
  fact: CompletionEvent["fact"],
  executorOperation = execution.attempt.identity.executor.operation_id,
): CompletionEvent {
  const author = candidateAuthor(execution.candidate);
  return {
    id,
    at,
    effort_id: author.effort_id,
    source_head: author.head,
    candidate_id: execution.candidate_id,
    attempt_id: execution.attempt.identity.id,
    executor_operation: executorOperation,
    fact,
  };
}

/** Measure an actual phase, including interrupted work, without deriving a verdict. */
export async function withExecutionTiming<T>(
  execution: ValidationSubject,
  category: Extract<CompletionEvent["fact"], { kind: "timing" }>["category"],
  intervalId: string,
  clock: Clock,
  operation: () => Promise<T>,
  executorOperation = execution.attempt.identity.executor.operation_id,
): Promise<T> {
  const startedAt = clock.wallNow();
  try {
    return await operation();
  } finally {
    const finishedAt = clock.wallNow();
    emitCompletionEvent(
      executionEvent(execution, `${intervalId}:${category}`, finishedAt, {
        kind: "timing",
        interval_id: intervalId,
        category,
        started_at: startedAt,
        finished_at: finishedAt,
      }, executorOperation),
    );
  }
}

/** Every event references an existing component receipt; it is never a replacement for that receipt. */
export function emitComponentUse(
  execution: ValidationSubject,
  component: ComponentEvidence,
  evidenceId: string,
  use: "executed" | "reused",
  durationMs: number,
  at: number,
): void {
  emitCompletionEvent(executionEvent(
    execution,
    `${execution.attempt.identity.id}:${use}:${evidenceId}`,
    at,
    {
      kind: "producer",
      producer: component.applicability.producer,
      use,
      evidence_id: evidenceId,
      duration_ms: durationMs,
      outcome: component.outcome.kind,
    },
  ));
}
