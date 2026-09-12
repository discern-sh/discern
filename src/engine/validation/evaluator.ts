/** The complete 1A port, instantiated for one immutable candidate snapshot. */
import type {
  CompletionObservation,
  ProducerEvaluator,
} from "../completion/protocol.ts";
import type { Clock } from "../../shared/clock.ts";
import type { ValidationSnapshot } from "./catalog.ts";
import { executeValidation, type ValidationRuntime } from "./execute.ts";
import { planValidation } from "./plan.ts";
import {
  artifactAuditEvidence,
  assembleCandidate,
  type EvidenceIndex,
  indexEvidence,
} from "./selection.ts";
import { auditArtifacts } from "./artifacts.ts";

/** The run supplies candidate observation, an explicit rerun, and its claimed attempt. */
export function createProducerEvaluator(options: {
  readonly snapshot: ValidationSnapshot;
  readonly root: string;
  readonly observe: () => Promise<CompletionObservation>;
  readonly runtime?: ValidationRuntime;
  readonly rerun_of?: string;
  readonly clock?: Clock;
}): ProducerEvaluator {
  const indexes = new WeakMap<CompletionObservation, EvidenceIndex>();
  const evidenceFor = (observation: CompletionObservation): EvidenceIndex => {
    let index = indexes.get(observation);
    if (index === undefined) {
      index = indexEvidence(
        observation.records.flatMap(({ reading }) =>
          reading.kind === "recorded" ? [reading.record] : []
        ),
      );
      indexes.set(observation, index);
    }
    return index;
  };
  let audited: ReadonlySet<string> = new Set();
  return {
    observe: async (candidateId): Promise<CompletionObservation> => {
      if (candidateId !== options.snapshot.candidate_id) {
        throw new Error("evaluator targets another candidate");
      }
      const observation = await options.observe();
      audited = await auditArtifacts(
        options.root,
        artifactAuditEvidence(
          options.snapshot,
          evidenceFor(observation),
        ),
      );
      return observation;
    },
    plan: (observation, demand, candidateId) => {
      if (candidateId !== options.snapshot.candidate_id) {
        throw new Error("evaluator targets another candidate");
      }
      return planValidation(
        options.snapshot,
        observation,
        demand,
        audited,
        options.rerun_of,
        evidenceFor(observation),
      );
    },
    execute: (plan, execution) => {
      if (options.runtime === undefined) {
        throw new Error(
          "Read-only candidate assessment cannot execute producers.",
        );
      }
      if (execution.attempt.identity.rerun_of !== (options.rerun_of ?? null)) {
        throw new Error("execution does not bind the explicit rerun decision");
      }
      return executeValidation(
        options.snapshot,
        plan,
        execution,
        options.runtime,
        options.clock,
      );
    },
    assemble: (
      candidateId,
      candidate,
      requirements,
      evidence,
      mode,
      assembler,
    ) =>
      assembleCandidate(
        options.snapshot,
        candidateId,
        candidate,
        requirements,
        evidence,
        mode,
        assembler,
        audited,
        options.clock,
      ),
  };
}
