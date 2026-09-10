/** Run the minimal dependency graph inside an already claimed candidate environment. */
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type ComponentEvidence,
  EvidenceSchema,
} from "../completion/evidence.ts";
import type {
  ClaimedExecution,
  DiagnosticExecution,
  ProducerDemand,
  ValidationExecution,
  ValidationPlan,
  ValidationSubject,
} from "../completion/protocol.ts";
import { validationPurpose } from "../completion/protocol.ts";
import {
  commands,
  requirementKey,
  type ResolvedObligation,
  type ValidationSnapshot,
} from "./catalog.ts";
import { readMetrics, standardHeld, standardReading } from "./metrics.ts";
import type { JobResult } from "../jobs/types.ts";

export interface ProducerCapture {
  readonly outcome: "passed" | "failed" | "cancelled" | "unrun";
  readonly complete: boolean;
  readonly output: Uint8Array;
  readonly artifacts: readonly ComponentEvidence["artifacts"][number][];
  readonly reason?: string;
  /** Transient process diagnostics, never serialized as component evidence. */
  readonly result?: JobResult;
}

/** Gate observers can hold a logical dependency boundary until its checks settle. */
export interface ProducerBoundary {
  before(producer: ProducerDemand, plan: ValidationPlan): Promise<void>;
  after(producer: ProducerDemand, capture: ProducerCapture): Promise<void>;
}

/** Host effects are supplied separately from the pure demand/evidence decisions. */
export interface ValidationRuntime {
  verify(
    execution: ValidationSubject,
    options?: { readonly allowCancelled?: boolean },
  ): Promise<void>;
  /** Observe each logical producer after physical coalescing, without executing it again. */
  onCapture?(
    producer: ProducerDemand,
    capture: ProducerCapture,
  ): void | Promise<void>;
  produce(
    producer: ProducerDemand,
    execution: ValidationSubject,
  ): Promise<ProducerCapture>;
  extract(
    obligation: ResolvedObligation,
    capture: ProducerCapture,
    execution: ValidationSubject,
  ): Promise<ProducerCapture>;
}

/** Retain a concrete runtime failure reason in component evidence. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reject caller drift, substituted plans and incomplete claims before any process starts. */
export function verifyValidationClaim(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  execution: ClaimedExecution,
  clock: Clock,
): void {
  const attempt = execution.attempt;
  if (
    plan.blockers.length > 0 || plan.candidate_id !== snapshot.candidate_id ||
    execution.candidate_id !== plan.candidate_id ||
    JSON.stringify(plan.candidate) !== JSON.stringify(snapshot.candidate) ||
    JSON.stringify(execution.candidate) !== JSON.stringify(plan.candidate) ||
    execution.fence.attempt_id !== attempt.identity.id ||
    attempt.identity.candidate_id !== plan.candidate_id ||
    attempt.environment_id !== execution.environment_id ||
    attempt.mode !== plan.demand.mode ||
    attempt.purpose !==
      validationPurpose(plan.demand) ||
    attempt.state.kind !== "claimed" ||
    attempt.state.claim.token !== execution.fence.token ||
    attempt.state.claim.expires_at <= clock.wallNow() ||
    execution.environment.state.kind !== "executing" ||
    execution.environment.state.phase !== "validate" ||
    execution.environment.state.attempt_id !== attempt.identity.id ||
    execution.environment.state.candidate_id !== plan.candidate_id ||
    execution.environment.state.claim.token !== execution.fence.token
  ) throw new Error("validation plan does not match a live candidate claim");
  verifyValidationBinding(snapshot, plan, execution);
}

/** All executions bind the exact immutable plan, regardless of publication capability. */
function verifyValidationBinding(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  execution: ValidationSubject,
): void {
  const attempt = execution.attempt;
  if (
    plan.blockers.length > 0 || plan.candidate_id !== snapshot.candidate_id ||
    execution.candidate_id !== plan.candidate_id ||
    JSON.stringify(plan.candidate) !== JSON.stringify(snapshot.candidate) ||
    JSON.stringify(execution.candidate) !== JSON.stringify(plan.candidate) ||
    attempt.identity.candidate_id !== plan.candidate_id ||
    attempt.mode !== plan.demand.mode ||
    attempt.purpose !== validationPurpose(plan.demand)
  ) {
    throw new Error("validation plan differs from its execution subject");
  }
  const planned = new Set(plan.producers.map((producer) => producer.selector));
  const visit = (selector: string, trail: ReadonlySet<string>): void => {
    if (trail.has(selector)) {
      throw new Error(
        "producer dependencies conflict with gate stage ordering",
      );
    }
    const dependencies = [
      ...(snapshot.producers.get(selector)?.dependencies ?? []),
      ...(snapshot.ordering?.get(selector) ?? []).filter((dependency) =>
        planned.has(dependency)
      ),
    ];
    for (const dependency of dependencies) {
      visit(dependency, new Set([...trail, selector]));
    }
  };
  for (const selector of planned) visit(selector, new Set());
  const expectedSubjects: string[] = [];
  for (const producer of plan.producers) {
    const node = snapshot.producers.get(producer.selector);
    if (
      node === undefined ||
      JSON.stringify(node.recipe) !== JSON.stringify(producer.recipe) ||
      node.dependencies.some((d) =>
        !plan.producers.some((p) => p.selector === d)
      )
    ) {
      throw new Error(
        "validation producer differs from its frozen recipe or dependencies",
      );
    }
    const consumers = producer.consumers.map((consumer) => {
      const obligation = snapshot.obligations.find((o) =>
        requirementKey(o.requirement) === requirementKey(consumer.requirement)
      );
      if (
        obligation === undefined || obligation.producer !== producer.selector ||
        obligation.requirement.context !== plan.demand.context ||
        JSON.stringify(obligation.input) !== JSON.stringify(consumer.input)
      ) {
        throw new Error(
          "validation consumer differs from its frozen definition",
        );
      }
      expectedSubjects.push(obligation.subject);
      return obligation.applicability;
    });
    if (
      JSON.stringify(consumers) !== JSON.stringify(producer.evidence_subjects)
    ) {
      throw new Error(
        "validation applicability differs from its frozen subjects",
      );
    }
  }
  if (
    new Set(plan.producers.map((p) => p.selector)).size !==
      plan.producers.length ||
    JSON.stringify([...new Set(expectedSubjects)].sort()) !==
      JSON.stringify([...attempt.subjects].sort())
  ) throw new Error("attempt does not cover exactly the validation subjects");
}

/** Physical identity excludes consumer limits but retains every process-affecting recipe fact. */
function physicalKey(
  snapshot: ValidationSnapshot,
  selector: string,
  plan: ValidationPlan,
  execution: ValidationSubject,
): string {
  const node = snapshot.producers.get(selector);
  if (node === undefined) throw new Error(`missing producer '${selector}'`);
  return JSON.stringify([
    execution.environment.path,
    execution.environment_id,
    execution.candidate_id,
    plan.demand.context,
    snapshot.conditions.find((c) => c.context === plan.demand.context),
    [...(snapshot.ordering?.get(selector) ?? [])].sort(),
    {
      ...node.recipe,
      run: commands(node.recipe.run),
      needs: node.dependencies.map((need) =>
        physicalKey(snapshot, need, plan, execution)
      ),
    },
  ]);
}

/** Execute each physical producer once and release its consumers independently. */
export async function executeValidation(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  execution: ClaimedExecution,
  runtime: ValidationRuntime,
  clock: Clock = SYSTEM_CLOCK,
): Promise<ValidationExecution> {
  verifyValidationClaim(snapshot, plan, execution, clock);
  return await executeProducerGraph(snapshot, plan, execution, runtime, clock);
}

/** Diagnostic execution cannot acquire a publication fence, even on a clean checkout. */
export async function executeDiagnosticValidation(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  execution: DiagnosticExecution,
  runtime: ValidationRuntime,
  clock: Clock = SYSTEM_CLOCK,
): Promise<ValidationExecution> {
  if (
    !execution.diagnostic || "fence" in execution ||
    validationPurpose(plan.demand) !== "diagnostic" || plan.reused.length > 0
  ) {
    throw new Error("standalone execution cannot supply completion evidence");
  }
  verifyValidationBinding(snapshot, plan, execution);
  return await executeProducerGraph(snapshot, plan, execution, runtime, clock);
}

/** Both execution boundaries use the same physical producer and consumer evaluator. */
async function executeProducerGraph(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  execution: ValidationSubject,
  runtime: ValidationRuntime,
  clock: Clock,
): Promise<ValidationExecution> {
  await runtime.verify(execution);
  const physical = new Map<string, Promise<ProducerCapture>>();
  const captures = new Map<string, Promise<ProducerCapture>>();
  const failure = (error: unknown): ProducerCapture => ({
    outcome: execution.signal.aborted ? "cancelled" : "failed",
    complete: false,
    output: new Uint8Array(),
    artifacts: [],
    reason: errorText(error),
  });
  const run = (producer: ProducerDemand): Promise<ProducerCapture> => {
    const existing = captures.get(producer.selector);
    if (existing !== undefined) return existing;
    const key = physicalKey(snapshot, producer.selector, plan, execution);
    let work = physical.get(key);
    if (work === undefined) {
      work = (async (): Promise<ProducerCapture> => {
        const node = snapshot.producers.get(producer.selector);
        if (node === undefined) throw new Error("producer disappeared");
        const dependencies = await Promise.all(
          [
            ...new Set([
              ...node.dependencies,
              ...(snapshot.ordering?.get(producer.selector) ?? []).filter((
                selector,
              ) =>
                plan.producers.some((producer) =>
                  producer.selector === selector
                )
              ),
            ]),
          ].map((selector) => {
            const dependency = plan.producers.find((p) =>
              p.selector === selector
            );
            if (dependency === undefined) {
              throw new Error("dependency was not demanded");
            }
            return run(dependency);
          }),
        );
        if (dependencies.some((d) => d.outcome !== "passed" || !d.complete)) {
          return {
            outcome: "unrun",
            complete: false,
            output: new Uint8Array(),
            artifacts: [],
            reason:
              "Required producer dependencies did not complete successfully.",
          };
        }
        if (execution.signal.aborted) {
          throw new Error("validation was cancelled");
        }
        await runtime.verify(execution);
        return await runtime.produce(producer, execution);
      })().catch(failure);
      physical.set(key, work);
    }
    const logical = work.then(async (capture) => {
      await runtime.onCapture?.(producer, capture);
      return capture;
    }).catch(failure);
    captures.set(producer.selector, logical);
    return logical;
  };
  const evidence: ComponentEvidence[] = [];
  const blockers: ValidationExecution["blockers"][number][] = [];
  const consume = async (
    producer: ProducerDemand,
    obligation: ResolvedObligation,
  ): Promise<void> => {
    let capture = await run(producer);
    try {
      if (capture.outcome !== "passed" || !capture.complete) {
        throw new Error(
          capture.reason ?? "required producer failed or capture is incomplete",
        );
      }
      if (
        capture.artifacts.some((artifact) =>
          artifact.attempt_id !== execution.attempt.identity.id ||
          artifact.candidate_id !== execution.candidate_id ||
          artifact.context !== plan.demand.context
        )
      ) throw new Error("artifact names another attempt, candidate or context");
      if (obligation.input.extraction !== null) {
        await runtime.verify(execution);
        capture = await runtime.extract(obligation, capture, execution);
        if (capture.outcome !== "passed" || !capture.complete) {
          throw new Error(
            capture.reason ??
              "standard extraction failed or capture is incomplete",
          );
        }
      }
      const metrics = obligation.standard === null ? {} : readMetrics(
        new TextDecoder("utf-8", { fatal: true }).decode(capture.output),
      );
      const reading = obligation.standard === null
        ? null
        : standardReading(obligation.standard, metrics, obligation.extent);
      evidence.push(EvidenceSchema.parse({
        attempt_id: execution.attempt.identity.id,
        candidate_id: execution.candidate_id,
        sequence: execution.attempt.identity.sequence,
        purpose: execution.attempt.purpose,
        mode: plan.demand.mode,
        applicability: obligation.applicability,
        finished_at: clock.wallNow(),
        artifacts: capture.artifacts,
        outcome: { kind: "passed", capture_complete: true, metrics },
      }));
      if (
        obligation.standard !== null && reading !== null &&
        !standardHeld(obligation.standard, reading) &&
        plan.demand.kind !== "proposal" && plan.demand.kind !== "pin" &&
        plan.demand.kind !== "test"
      ) blockers.push({ kind: "validation-failed", evidence_ids: [] });
    } catch (error) {
      evidence.push(EvidenceSchema.parse({
        attempt_id: execution.attempt.identity.id,
        candidate_id: execution.candidate_id,
        sequence: execution.attempt.identity.sequence,
        purpose: execution.attempt.purpose,
        mode: plan.demand.mode,
        applicability: obligation.applicability,
        finished_at: clock.wallNow(),
        artifacts: capture.artifacts.filter((a) =>
          a.attempt_id === execution.attempt.identity.id &&
          a.candidate_id === execution.candidate_id &&
          a.context === plan.demand.context
        ),
        outcome: {
          kind: capture.outcome === "cancelled" || capture.outcome === "unrun"
            ? capture.outcome
            : "failed",
          reason: errorText(error),
        },
      }));
      blockers.push(
        capture.outcome === "cancelled"
          ? { kind: "cancelled", reason: errorText(error) }
          : capture.outcome === "unrun"
          ? { kind: "missing-evidence", requirements: [obligation.requirement] }
          : { kind: "validation-failed", evidence_ids: [] },
      );
    }
  };
  // Each consumer awaits only its producer. No stage-wide Promise.all precedes extraction.
  await Promise.all(plan.producers.flatMap((producer) => [
    run(producer),
    ...producer.consumers.map((consumer) => {
      const obligation = snapshot.obligations.find((o) =>
        requirementKey(o.requirement) === requirementKey(consumer.requirement)
      );
      if (obligation === undefined) throw new Error("missing consumer");
      return consume(producer, obligation);
    }),
  ]));
  for (const capture of await Promise.all(physical.values())) {
    if (capture.outcome === "cancelled") {
      blockers.push({
        kind: "cancelled",
        reason: capture.reason ?? "Validation was cancelled.",
      });
    } else if (
      capture.outcome === "failed" ||
      capture.outcome === "passed" && !capture.complete
    ) {
      blockers.push({ kind: "validation-failed", evidence_ids: [] });
    }
  }
  try {
    await runtime.verify(execution, { allowCancelled: true });
  } catch (error) {
    return {
      evidence: evidence.map((component) =>
        component.outcome.kind !== "passed" ? component : ({
          ...component,
          outcome: { kind: "stale", reason: errorText(error) },
        })
      ),
      blockers: [...blockers, {
        kind: "stale-evidence",
        evidence_ids: [],
        reason: "inputs-changed",
      }],
    };
  }
  return { evidence, blockers };
}
