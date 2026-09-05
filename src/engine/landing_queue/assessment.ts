/** Compose existing machine, source, policy, environment, and judgment evaluators. */
import type {
  CompletionBlocker,
  CompletionObservation,
  EnvironmentExecutor,
  ProducerEvaluator,
  ValidationDemand,
} from "../completion/protocol.ts";
import type { Candidate } from "../completion/candidate.ts";
import { CandidateProofSchema } from "../completion/evidence.ts";
import type { CompletionRecord } from "../completion/records.ts";
import { candidateRef } from "../completion/identity.ts";
import type { PlannedStandard } from "../gate/standard_plan.ts";
import {
  type AuthorityRecord,
  type CandidateDecisions,
  resolveSourceAuthority,
  type SourceGrantFacts,
  verifyCandidateDecisions,
} from "./authority.ts";
import type { CompositionRecipe } from "./generation.ts";
import {
  discoverSourceDependencies,
  gitValue,
  observeSource,
  verifyComposition,
} from "./composition.ts";
import { evaluatePredecessorPolicy } from "./policy.ts";
import { observedRecords, REPOSITORY_QUEUE_ID } from "./repository.ts";
import { sameSource } from "./model.ts";
import type { CandidateAssessment } from "./planner.ts";

/** Walk exact recorded predecessor links and independently settled landing authority. */
function predecessorChain(
  candidate: Candidate,
  records: readonly CompletionRecord[],
): {
  readonly chain: {
    readonly candidate: Candidate;
    readonly authority: AuthorityRecord;
    readonly landed: boolean;
  }[];
  readonly blockers: CompletionBlocker[];
} {
  const chain = [];
  const blockers: CompletionBlocker[] = [];
  const queue = records.find((record) =>
    record.kind === "queue" && record.id === REPOSITORY_QUEUE_ID
  );
  let next = candidate.expected_predecessor;
  const seen = new Set<string>();
  while (next.candidate_id !== null) {
    if (seen.has(next.candidate_id)) {
      blockers.push({
        kind: "missing-judgment",
        subjects: ["candidate-predecessor-cycle"],
      });
      break;
    }
    seen.add(next.candidate_id);
    const predecessor = records.find((record) =>
      record.kind === "candidate" && record.id === next.candidate_id
    );
    if (
      predecessor?.kind !== "candidate" || predecessor.data.head !== next.head
    ) {
      blockers.push({ kind: "missing-evidence", requirements: [] });
      break;
    }
    const entry = queue?.kind === "queue"
      ? queue.data.entries.find((entry) =>
        entry.candidate_id === predecessor.id
      )
      : undefined;
    const landing = records.find((record) =>
      record.kind === "landing" &&
      record.data.candidate_id === predecessor.id &&
      record.data.outcome.kind === "landed"
    );
    const authorityId =
      landing?.kind === "landing" && landing.data.claim.kind === "normal"
        ? landing.data.claim.authority_id
        : entry?.authority_id;
    const authority = records.find((record) =>
      record.kind === "authority" && record.id === authorityId
    );
    if (authority?.kind !== "authority") {
      blockers.push({
        kind: "missing-authority",
        sources: [predecessor.data.source],
      });
      break;
    }
    const landed = landing?.kind === "landing" &&
      landing.data.target === predecessor.data.head &&
      sameSource(landing.data.source, predecessor.data.source) &&
      authority.data.state.kind === "consumed" &&
      authority.data.state.landing_id === landing.id;
    chain.push({ candidate: predecessor.data, authority, landed });
    next = predecessor.data.expected_predecessor;
  }
  return { chain, blockers };
}

/** Inputs requiring public config/consent adapters remain explicit, bounded observations for 4A. */
export async function assessQueueCandidate(input: {
  readonly root: string;
  readonly observation: CompletionObservation;
  readonly candidate_id: string;
  readonly recipe: CompositionRecipe;
  readonly grants: readonly SourceGrantFacts[];
  readonly current_decisions: CandidateDecisions;
  readonly authorized_decisions: CandidateDecisions;
  readonly judgment_blockers: readonly CompletionBlocker[];
  readonly standards: readonly PlannedStandard[];
  readonly evaluator: ProducerEvaluator;
  readonly environment: EnvironmentExecutor;
  readonly demand: Extract<ValidationDemand, { kind: "done" }>;
}): Promise<CandidateAssessment> {
  const records = observedRecords(input.observation);
  const record = records.find((record) =>
    record.kind === "candidate" && record.id === input.candidate_id
  );
  const queue = records.find((record) =>
    record.kind === "queue" && record.id === REPOSITORY_QUEUE_ID
  );
  if (record?.kind !== "candidate" || queue?.kind !== "queue") {
    throw new Error("Candidate and queue records are required for assessment.");
  }
  const candidate = record.data;
  const entry = queue.data.entries.find((entry) =>
    entry.candidate_id === input.candidate_id
  );
  const blockers: CompletionBlocker[] = [...input.judgment_blockers];
  const source = await observeSource(
    input.root,
    candidate.source.effort_id,
    candidate.source.branch,
  );
  if (!sameSource(source, candidate.source)) {
    blockers.push({
      kind: "stale-evidence",
      evidence_ids: [],
      reason: "source-replaced",
    });
  }
  if (
    await gitValue(input.root, [
        "rev-parse",
        candidateRef(record.id, candidate.attempt_id),
      ]) !== candidate.head ||
    !await verifyComposition(input.root, candidate, input.recipe)
  ) {
    blockers.push({
      kind: "missing-judgment",
      subjects: ["candidate-composition"],
    });
  }
  const dependencies = await discoverSourceDependencies(
    input.root,
    candidate.source,
    input.observation.trunk,
    [
      ...queue.data.entries.map((entry) => entry.source),
      ...records.flatMap((record) =>
        record.kind === "candidate"
          ? [record.data.source, ...record.data.dependencies]
          : record.kind === "authority"
          ? record.data.sources
          : []
      ),
    ],
  );
  if (
    dependencies.some((source) =>
      !candidate.dependencies.some((dependency) =>
        sameSource(source, dependency)
      )
    )
  ) {
    blockers.push({ kind: "missing-authority", sources: dependencies });
  }
  const predecessors = predecessorChain(candidate, records);
  blockers.push(...predecessors.blockers);
  const authority = records.find((record) =>
    record.kind === "authority" && record.id === entry?.authority_id
  );
  if (authority?.kind !== "authority") {
    blockers.push({ kind: "missing-authority", sources: [candidate.source] });
  } else {
    const resolution = resolveSourceAuthority({
      candidate,
      authority,
      facts: input.grants,
      predecessors: predecessors.chain,
    });
    if (resolution.kind !== "authorized") blockers.push(resolution);
  }
  const decisions = verifyCandidateDecisions(
    input.current_decisions,
    input.authorized_decisions,
  );
  if (decisions !== undefined) blockers.push(decisions);
  blockers.push(
    ...await evaluatePredecessorPolicy({
      root: input.root,
      candidate,
      standards: input.standards,
      current: input.current_decisions,
      authorized: input.authorized_decisions,
    }),
  );
  await input.evaluator.observe(record.id);
  const plan = input.evaluator.plan(input.observation, input.demand, record.id);
  blockers.push(...plan.blockers);
  const receipts = new Map(
    plan.reused.map((
      item,
    ) => [JSON.stringify(item.requirement), item.evidence_id]),
  );
  const proofs = records.filter((
    proof,
  ): proof is Extract<CompletionRecord, { kind: "proof" }> =>
    proof.kind === "proof" && proof.data.candidate_id === record.id
  );
  const proof =
    proofs.find((proof) =>
      CandidateProofSchema.safeParse(proof.data).success &&
      proof.data.head === candidate.head &&
      proof.data.policy === candidate.policy &&
      proof.data.requirement_set === candidate.requirement_set &&
      proof.data.mode === "strict" &&
      JSON.stringify(
          proof.data.requirements.map((item) => JSON.stringify(item)).sort(),
        ) === JSON.stringify(
          input.demand.requirements.map((item) => JSON.stringify(item)).sort(),
        ) &&
      proof.data.receipts.every((receipt) =>
        receipts.get(JSON.stringify(receipt.requirement)) ===
          receipt.evidence_id
      ) &&
      plan.producers.length === 0 && plan.blockers.length === 0
    ) ?? null;
  const environment = input.environment.plan(input.observation, plan);
  const refresh = "kind" in environment ? null : { plan, environment };
  if (proof === null && refresh === null && "kind" in environment) {
    blockers.push(environment);
  }
  return {
    candidate_id: record.id,
    candidate,
    blockers,
    proof,
    authority_id: authority?.kind === "authority" ? authority.id : null,
    decisions: input.authorized_decisions,
    refresh,
  };
}
