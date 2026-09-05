/** Demand-driven producer closure; scope and stage labels never suppress requirements. */
import type {
  CompletionObservation,
  ProducerDemand,
  ValidationDemand,
  ValidationPlan,
} from "../completion/protocol.ts";
import { requirementKey, type ValidationSnapshot } from "./catalog.ts";
import { selectEvidence } from "./selection.ts";
import { standardHeld } from "./metrics.ts";

/** Resolve required consumers and dependency demand before producer execution. */
export function planValidation(
  snapshot: ValidationSnapshot,
  observation: CompletionObservation,
  demand: ValidationDemand,
  audited: ReadonlySet<string> = new Set(),
  rerunOf?: string,
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
  if (
    !snapshot.conditions.some((condition) =>
      condition.context === demand.context
    )
  ) throw new Error(`unknown validation context '${demand.context}'`);
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
  let selected = snapshot.obligations.filter((o) =>
    o.requirement.context === demand.context
  );
  if (
    demand.kind === "done" || demand.kind === "standards" ||
    demand.kind === "pin" || demand.kind === "proposal"
  ) {
    const requested = new Set(demand.requirements.map(requirementKey));
    if (
      requested.size !== demand.requirements.length ||
      demand.requirements.some((r) =>
        !snapshot.requirements.some((known) =>
          requirementKey(known) === requirementKey(r)
        )
      ) ||
      (demand.kind === "done" &&
        requested.size !== snapshot.requirements.length)
    ) throw new Error("demand does not name the declared requirements");
    selected = selected.filter((o) =>
      requested.has(requirementKey(o.requirement))
    );
  } else if (demand.kind === "diagnostic") {
    if (
      JSON.stringify(demand.source) !==
        JSON.stringify(snapshot.candidate.source) ||
      demand.base !== snapshot.candidate.expected_predecessor.head ||
      snapshot.candidate.dependencies.length !== 0
    ) {
      throw new Error(
        "diagnostic comparison needs the same source/base and cannot remove a real dependency",
      );
    }
    selected = selected.filter((o) =>
      requirementKey(o.requirement) ===
        requirementKey(demand.failing_requirement)
    );
    if (selected.length !== 1) {
      throw new Error("unknown diagnostic requirement");
    }
  }
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
    if (demand.kind !== "test" && demand.kind !== "diagnostic") {
      const prior = selectEvidence(
        obligation,
        snapshot.candidate_id,
        records,
        demand.mode,
        "completion",
        audited,
      );
      if (
        prior.kind === "selected" && prior.record.data.attempt_id !== rerunOf
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
          continue;
        }
        plan.reused.push({
          requirement: obligation.requirement,
          evidence_id: prior.record.id,
        });
        continue;
      }
      if (
        prior.kind === "blocked" && prior.blocker.kind !== "stale-evidence" &&
        (prior.attempt_id !== rerunOf ||
          prior.blocker.kind === "waiting-for-operation")
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
