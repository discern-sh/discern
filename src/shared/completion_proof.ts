/** Public Proof projects the domain records without upgrading old machine evidence. */
import { z } from "@zod/zod";
import { AttemptSchema } from "../engine/completion/attempt.ts";
import { CandidateSchema } from "../engine/completion/candidate.ts";
import {
  CandidateProofSchema,
  EvidenceSchema,
} from "../engine/completion/evidence.ts";
import {
  ExecutorSchema,
  RecordIdSchema,
} from "../engine/completion/identity.ts";

export const CompletionProofPointerSchema = z.strictObject({
  candidate_id: RecordIdSchema,
  proof_id: RecordIdSchema,
});
export type CompletionProofPointer = z.infer<
  typeof CompletionProofPointerSchema
>;

export const CompleteProofEvidenceSchema = CompletionProofPointerSchema.extend({
  candidate: CandidateSchema,
  validation: CandidateProofSchema,
  components: z.array(
    z.strictObject({ id: RecordIdSchema, evidence: EvidenceSchema }),
  ).min(1),
  attempts: z.array(AttemptSchema).min(1),
  executors: z.array(ExecutorSchema).min(1),
}).refine(
  (value) =>
    value.candidate_id === value.validation.candidate_id &&
    value.candidate.head === value.validation.head &&
    value.candidate.policy === value.validation.policy &&
    value.candidate.requirement_set === value.validation.requirement_set &&
    new Set(value.components.map((component) => component.id)).size ===
      value.components.length &&
    new Set(value.attempts.map((attempt) => attempt.identity.id)).size ===
      value.attempts.length &&
    [value.candidate.attempt_id, value.validation.attempt_id].every((id) =>
      value.attempts.some((attempt) =>
        attempt.identity.id === id && attempt.state.kind === "finished"
      )
    ) &&
    (value.validation.review === undefined || value.attempts.some((attempt) =>
      attempt.identity.id === value.validation.review?.attempt_id &&
      attempt.identity.candidate_id === value.candidate_id &&
      attempt.mode === value.validation.mode &&
      attempt.purpose === "completion" &&
      attempt.state.kind === "finished" && attempt.state.outcome === "passed"
    )) &&
    value.components.every(({ evidence }) =>
      value.attempts.some((attempt) =>
        attempt.identity.id === evidence.attempt_id &&
        attempt.identity.candidate_id === evidence.candidate_id &&
        attempt.identity.sequence === evidence.sequence &&
        attempt.mode === evidence.mode &&
        attempt.purpose === evidence.purpose &&
        attempt.state.kind === "finished" &&
        value.executors.some((executor) =>
          JSON.stringify(executor) === JSON.stringify(attempt.identity.executor)
        )
      )
    ) &&
    value.validation.receipts.every((receipt) =>
      value.components.some((component) =>
        component.id === receipt.evidence_id &&
        component.evidence.purpose === "completion" &&
        component.evidence.applicability.context ===
          receipt.requirement.context &&
        (value.validation.mode === "report" ||
          component.evidence.mode === "strict") &&
        component.evidence.outcome.kind === "passed"
      )
    ),
  "Complete Proof must retain every successful completion receipt for its candidate",
);
export type CompleteProofEvidence = z.infer<typeof CompleteProofEvidenceSchema>;
