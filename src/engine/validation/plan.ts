import { selectDemandObligations } from "./demand.ts";
/** Demand-driven producer closure; scope and stage labels never suppress requirements. */
import type {
  CompletionObservation,
  ProducerDemand,
  ValidationDemand,
  ValidationPlan,
} from "../completion/protocol.ts";
import { validationPurpose } from "../completion/protocol.ts";
import type { ValidationSnapshot } from "./catalog.ts";
import {
  type EvidenceIndex,
  finishedValidationAttempts,
  indexEvidence,
  selectEvidence,
} from "./selection.ts";
import { standardHeld } from "./metrics.ts";

/** Resolve required consumers and dependency demand before producer execution. */
export function planValidation(
  snapshot: ValidationSnapshot,
  observation: CompletionObservation,
  demand: ValidationDemand,
  audited: ReadonlySet<string> = new Set(),
  rerunOf?: string,
  indexed?: EvidenceIndex,
): ValidationPlan {
  const plan = {
    candidate_id: snapshot.candidate_id,
    candidate: snapshot.candidate,
    demand,
    producers: [] as ProducerDemand[],
    reused: [] as ValidationPlan["reused"][number][],
    blockers: [] as ValidationPlan["blockers"][number][],
  };
  if (demand.kind === "prepare") return plan;
  if (snapshot.conditions.length === 0) {
    throw new Error("validation conditions were not observed");
  }
  const records = observation.records.flatMap(({ reading }) =>
    reading.kind === "recorded" ? [reading.record] : []
  );
  if (
    observation.records.some(({ reading }) =>
      reading.kind !== "recorded" && reading.kind !== "missing"
    )
  ) {
    plan.blockers.push({
      kind: "missing-evidence",
      requirements: snapshot.requirements,
    });
    return plan;
  }
  let selected = selectDemandObligations(
    snapshot.requirements,
    snapshot.obligations,
    snapshot.producers,
    demand,
    snapshot.candidate,
  );
  const index = indexed ?? indexEvidence(records);
  const finished = finishedValidationAttempts(index);
  const boundary = finished.find((attempt) => attempt.id === rerunOf);
  const producers = new Map<string, ProducerDemand>();
  const demandProducer = (selector: string): ProducerDemand => {
    const existing = producers.get(selector);
    if (existing !== undefined) return existing;
    const node = snapshot.producers.get(selector);
    if (node === undefined) throw new Error(`missing producer '${selector}'`);
    for (const dependency of node.dependencies) demandProducer(dependency);
    const producer: ProducerDemand = {
      selector,
      recipe: node.recipe,
      consumers: [],
      evidence_subjects: [],
    };
    producers.set(selector, producer);
    return producer;
  };
  if (demand.kind === "test") {
    demand.producers.forEach(demandProducer);
    selected = selected.filter((o) => producers.has(o.producer));
  }
  for (const obligation of selected) {
    if (
      validationPurpose(demand) === "completion" && demand.kind !== "standards"
    ) {
      const prior = selectEvidence(
        obligation,
        snapshot.candidate_id,
        index,
        demand.mode,
        "completion",
        audited,
      );
      if (
        prior.kind === "selected" &&
        prior.record.data.attempt_id !== boundary?.id &&
        !(demand.kind === "pin" && obligation.standard !== null &&
          prior.reading !== null &&
          !standardHeld(obligation.standard, prior.reading))
      ) {
        if (
          obligation.standard !== null && prior.reading !== null &&
          !standardHeld(obligation.standard, prior.reading) &&
          demand.kind !== "pin" && demand.kind !== "proposal"
        ) {
          plan.blockers.push({
            kind: "validation-failed",
            evidence_ids: [prior.record.id],
          });
        }
        plan.reused.push({
          requirement: obligation.requirement,
          evidence_id: prior.record.id,
        });
        continue;
      }
      if (
        prior.kind === "blocked" && prior.blocker.kind !== "stale-evidence" &&
        prior.blocker.kind !== "report-only" &&
        (boundary === undefined ||
          !finished.some((attempt) =>
            attempt.id === prior.attempt_id &&
            attempt.data.identity.sequence <= boundary.data.identity.sequence
          ))
      ) {
        plan.blockers.push(prior.blocker);
        continue;
      }
    }
    const producer = demandProducer(obligation.producer);
    producers.set(producer.selector, {
      ...producer,
      consumers: [...producer.consumers, {
        requirement: obligation.requirement,
        input: obligation.input,
      }],
      evidence_subjects: [
        ...producer.evidence_subjects,
        obligation.applicability,
      ],
    });
  }
  plan.producers.push(...producers.values());
  return plan;
}
