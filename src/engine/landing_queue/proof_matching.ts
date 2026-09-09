/** Exact retained Proof selection shared by acceptance and external integration observation. */
import {
  CandidateProofSchema,
  type Requirement,
} from "../completion/evidence.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { ValidationPlan } from "../completion/protocol.ts";
import { requirementKey } from "../validation/catalog.ts";

/** Require the current evaluator's receipts to match the exact strict aggregate. */
export function applicableCandidateProof(
  records: readonly CompletionRecord[],
  candidateId: string,
  candidate: Candidate,
  requirements: readonly Requirement[],
  plan: ValidationPlan,
  proofId?: string,
): Extract<CompletionRecord, { kind: "proof" }> | null {
  const receipts = new Map(
    plan.reused.map((
      item,
    ) => [requirementKey(item.requirement), item.evidence_id]),
  );
  const proofs = records.filter((
    proof,
  ): proof is Extract<CompletionRecord, { kind: "proof" }> =>
    proof.kind === "proof" && proof.data.candidate_id === candidateId &&
    (proofId === undefined || proof.id === proofId)
  );
  return proofs.find((proof) =>
    CandidateProofSchema.safeParse(proof.data).success &&
    proof.data.head === candidate.head &&
    proof.data.policy === candidate.policy &&
    proof.data.requirement_set === candidate.requirement_set &&
    proof.data.mode === "strict" &&
    JSON.stringify(
        proof.data.requirements.map(requirementKey).sort(),
      ) === JSON.stringify(
        requirements.map(requirementKey).sort(),
      ) &&
    proof.data.receipts.every((receipt) =>
      receipts.get(requirementKey(receipt.requirement)) ===
        receipt.evidence_id
    ) &&
    plan.producers.length === 0 && plan.blockers.length === 0
  ) ?? null;
}
