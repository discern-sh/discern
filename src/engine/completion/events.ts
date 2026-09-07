/** Invocation-scoped advisory facts; observers have no validation or publication capability. */
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import type { CompletionEvent, ValidationSubject } from "./protocol.ts";
import type { ComponentEvidence } from "./evidence.ts";

/** The next piece of work or the exact reason it is pending, without output-log payloads. */
export interface CompletionProgress {
  readonly phase: "producer" | "environment" | "queue" | "pending";
  readonly state: string;
  readonly candidate_id: string | null;
  readonly reason: string;
}
export type CompletionObservationFact =
  | { readonly kind: "event"; readonly event: CompletionEvent }
  | { readonly kind: "progress"; readonly progress: CompletionProgress };
interface ObservationScope {
  readonly sink: (fact: CompletionObservationFact) => void | Promise<void>;
  readonly deliveries: Promise<void>[];
}
const OBSERVERS = new AsyncLocalStorage<ObservationScope>();

/** Keep concurrent calls separate and settle every delivery without changing the operation's result. */
export async function withCompletionObserver<T>(
  sink: ObservationScope["sink"],
  operation: () => Promise<T>,
): Promise<T> {
  const scope: ObservationScope = { sink, deliveries: [] };
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
  const scope = OBSERVERS.getStore();
  if (scope === undefined) return;
  const copy = structuredClone(fact);
  const delivery = Promise.resolve().then(() => scope.sink(copy));
  // Enroll the rejection immediately; final settlement still waits for every delivery.
  scope.deliveries.push(Promise.allSettled([delivery]).then(() => {}));
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
): CompletionEvent {
  return {
    id,
    at,
    effort_id: execution.candidate.source.effort_id,
    source_head: execution.candidate.source.head,
    candidate_id: execution.candidate_id,
    environment_id: execution.environment_id,
    attempt_id: execution.attempt.identity.id,
    executor_operation: execution.attempt.identity.executor.operation_id,
    fact,
  };
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
      outcome: component.outcome.kind === "passed"
        ? "passed"
        : component.outcome.kind === "cancelled"
        ? "cancelled"
        : "failed",
    },
  ));
}
