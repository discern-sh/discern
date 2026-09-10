/** Invocation-scoped advisory facts; observers have no validation or publication capability. */
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import type { Clock } from "../../shared/clock.ts";
import type {
  CompletionCapacity,
  CompletionEvent,
  ValidationSubject,
} from "./protocol.ts";
import type { CompletionRecovery } from "./environment.ts";
import type { ComponentEvidence } from "./evidence.ts";

/** The next piece of work or the exact reason it is pending, without output-log payloads. */
export interface CompletionProgress {
  readonly phase: "producer" | "environment" | "queue" | "pending";
  readonly state: string;
  readonly candidate_id: string | null;
  readonly reason: string;
  readonly capacity?: CompletionCapacity;
  readonly environment_id?: string;
  readonly attempt_id?: string;
  readonly recovery?: CompletionRecovery;
}
export type CompletionObservationFact =
  | { readonly kind: "event"; readonly event: CompletionEvent }
  | { readonly kind: "progress"; readonly progress: CompletionProgress };
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
  return {
    id,
    at,
    effort_id: execution.candidate.source.effort_id,
    source_head: execution.candidate.source.head,
    candidate_id: execution.candidate_id,
    environment_id: execution.environment_id,
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
