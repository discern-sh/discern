import { readCandidateReview } from "./candidate_review.ts";
/** Resolve indispensable complete evidence from common storage, independent of the source checkout. */
import {
  type CompleteProofEvidence,
  CompleteProofEvidenceSchema,
  type CompletionProofPointer,
} from "../../shared/completion_proof.ts";
import { readCompletionRecord } from "../completion/store.ts";
import type {
  CompletionRecord,
  RecordSelector,
} from "../completion/records.ts";

/** A locator is not evidence: read every referenced immutable receipt and executor. */
export async function readCompleteProof(
  root: string,
  pointer: CompletionProofPointer,
): Promise<CompleteProofEvidence> {
  const read = async (selector: RecordSelector): Promise<CompletionRecord> => {
    const result = await readCompletionRecord(root, selector);
    if (result.kind !== "recorded" || result.record.kind !== selector.kind) {
      throw new Error(
        `Complete evidence ${selector.kind}/${selector.id} is ${result.kind}.`,
      );
    }
    return result.record;
  };
  const candidate = await read({ kind: "candidate", id: pointer.candidate_id });
  const proof = await read({ kind: "proof", id: pointer.proof_id });
  if (candidate.kind !== "candidate" || proof.kind !== "proof") {
    throw new Error("Complete Proof record kinds differ.");
  }
  await readCandidateReview(root, candidate.data, proof.data);
  const components = await Promise.all(
    [...new Set(proof.data.receipts.map((receipt) => receipt.evidence_id))].map(
      async (id) => {
        const evidence = await read({ kind: "evidence", id });
        if (evidence.kind !== "evidence") {
          throw new Error("Completion receipt has another record kind.");
        }
        return { id, evidence: evidence.data };
      },
    ),
  );
  const attempts = await Promise.all(
    [
      ...new Set([
        proof.data.attempt_id,
        candidate.data.attempt_id,
        ...(proof.data.review === undefined
          ? []
          : [proof.data.review.attempt_id]),
        ...components.map((component) => component.evidence.attempt_id),
      ]),
    ].map(async (id) => {
      const attempt = await read({ kind: "attempt", id });
      if (attempt.kind !== "attempt") {
        throw new Error("Complete Proof executor has another record kind.");
      }
      return attempt.data;
    }),
  );
  return CompleteProofEvidenceSchema.parse({
    ...pointer,
    candidate: candidate.data,
    validation: proof.data,
    components,
    attempts,
    executors: [
      ...new Map(
        attempts.map((
          attempt,
        ) => [
          attempt.identity.executor.operation_id,
          attempt.identity.executor,
        ]),
      )
        .values(),
    ],
  });
}
