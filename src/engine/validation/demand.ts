/** One selection boundary for input observation and producer demand. */
import type { Candidate } from "../completion/candidate.ts";
import type { Requirement } from "../completion/evidence.ts";
import type { ValidationDemand } from "../completion/protocol.ts";
import { requirementKey, type ResolvedProducer } from "./catalog.ts";

/** Expand canonical dependency edges before observing inputs or scheduling commands. */
export function producerClosure(
  producers: ReadonlyMap<string, ResolvedProducer>,
  selectors: readonly string[],
): ReadonlyMap<string, ResolvedProducer> {
  const closure = new Map<string, ResolvedProducer>();
  const collect = (selector: string): void => {
    if (closure.has(selector)) return;
    const node = producers.get(selector);
    if (node === undefined) throw new Error(`missing producer '${selector}'`);
    closure.set(selector, node);
    node.dependencies.forEach(collect);
  };
  selectors.forEach(collect);
  return closure;
}

/** Validate requested requirements against the complete candidate authority. */
export function selectDemandObligations<
  T extends { requirement: Requirement; producer: string },
>(
  requirements: readonly Requirement[],
  obligations: readonly T[],
  producers: ReadonlyMap<string, ResolvedProducer>,
  demand: ValidationDemand,
  candidate: Candidate,
): T[] {
  if (demand.kind === "prepare") return [];
  let selected = [...obligations];
  if (
    demand.kind === "done" || demand.kind === "standards" ||
    demand.kind === "pin" || demand.kind === "proposal" ||
    demand.kind === "standalone"
  ) {
    const requested = new Set(demand.requirements.map(requirementKey));
    if (
      requested.size !== demand.requirements.length ||
      demand.requirements.some((r) =>
        !requirements.some((known) =>
          requirementKey(known) === requirementKey(r)
        )
      ) ||
      (demand.kind === "done" &&
        requested.size !== requirements.length)
    ) throw new Error("demand does not name the declared requirements");
    selected = selected.filter((o) =>
      requested.has(requirementKey(o.requirement))
    );
  } else if (demand.kind === "diagnostic") {
    if (
      JSON.stringify(demand.source) !==
        JSON.stringify(candidate.source) ||
      demand.base !== candidate.predecessor
    ) {
      throw new Error(
        "diagnostic comparison needs the same source and base",
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
  if (demand.kind === "test") {
    const closure = producerClosure(producers, demand.producers);
    selected = selected.filter((obligation) =>
      closure.has(obligation.producer)
    );
  }
  return selected;
}
