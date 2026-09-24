/** Public emergency review and outstanding-validation projections share the recorded claim. */
import { z } from "@zod/zod";
import { openVocabulary } from "./result_vocabulary.ts";
import { ExceptionClaimSchema } from "../engine/completion/exception_claim.ts";
import { CandidateSchema } from "../engine/completion/candidate.ts";
import { CompletionProofPointerSchema } from "./completion_proof.ts";

export const EmergencyValidationSchema = z.strictObject({
  landing_id: z.string(),
  head: z.string(),
  reason: z.string(),
  exceptions: ExceptionClaimSchema.shape.exceptions,
  state: openVocabulary("x-discern-exception-validation-states"),
  resolved_by: CompletionProofPointerSchema.optional(),
  next_action: z.string(),
});
export type EmergencyValidation = z.infer<typeof EmergencyValidationSchema>;
export const EmergencyDataSchema = z.strictObject({
  candidate_id: z.string().optional(),
  candidate: CandidateSchema.optional(),
  reason: z.string().optional(),
  exceptions: ExceptionClaimSchema.shape.exceptions.optional(),
  /** The newest commits the repair lands beyond actual trunk, each with its
   * subject; `commits_total` counts them all. */
  commits: z.array(z.strictObject({ commit: z.string(), subject: z.string() }))
    .optional(),
  commits_total: z.number().optional(),
  /** Other tasks' unlanded work among those commits, each named by its task,
   * branch, and newest revision the repair holds. */
  carried: ExceptionClaimSchema.shape.carried,
  /** The loosened standard limits the emergency lands with, as their
   * recorded proposals. A preview serves each one's approval token in
   * `standard_approvals_required`. */
  standard_approvals: ExceptionClaimSchema.shape.standard_approvals,
  /** The declared-unmet checkpoint answers the emergency lands with, each
   * needing the owner's `--variance` at confirmation. */
  variances: ExceptionClaimSchema.shape.variances,
  confirmation: z.string().optional(),
  preparation: z.string().optional(),
  expires_at: z.number().optional(),
  landing_id: z.string().optional(),
  outcome: openVocabulary("x-discern-emergency-outcomes")
    .optional(),
  /** Whether the exception note reached the landed commit. */
  note: openVocabulary("x-discern-emergency-note-statuses").optional(),
  /** What became of the repair's checkout after the landing. */
  cleanup: openVocabulary("x-discern-emergency-cleanups").optional(),
});
