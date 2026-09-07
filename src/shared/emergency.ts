/** Public emergency review and outstanding-validation projections share the recorded claim. */
import { z } from "@zod/zod";
import { ExceptionClaimSchema } from "../engine/completion/exception_claim.ts";
import { CandidateSchema } from "../engine/completion/candidate.ts";
import { CompletionProofPointerSchema } from "./completion_proof.ts";

export const EmergencyValidationSchema = z.strictObject({
  landing_id: z.string(),
  head: z.string(),
  reason: z.string(),
  exceptions: ExceptionClaimSchema.shape.exceptions,
  state: z.enum(["outstanding", "resolved"]),
  resolved_by: CompletionProofPointerSchema.optional(),
  next_action: z.string(),
});
export type EmergencyValidation = z.infer<typeof EmergencyValidationSchema>;
export const EmergencyDataSchema = z.strictObject({
  candidate_id: z.string().optional(),
  candidate: CandidateSchema.optional(),
  reason: z.string().optional(),
  exceptions: ExceptionClaimSchema.shape.exceptions.optional(),
  confirmation: z.string().optional(),
  expires_at: z.number().optional(),
  landing_id: z.string().optional(),
  outcome: z.enum(["preview", "landed", "not-landed", "recovery"]).optional(),
  retirement: z.string().optional(),
});
