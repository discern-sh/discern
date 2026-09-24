/** Recorded decisions are input to re-verification, never a substitute for it. */
import { z } from "@zod/zod";
import {
  AuthorizedVarianceSchema,
  StandardLimitProposalSchema,
} from "../../shared/landing_decision_schemas.ts";
import { DigestSchema, NameSchema } from "./identity.ts";

export { ExceptionClaimSchema } from "./exception_claim.ts";

const JudgmentSchema = z.strictObject({
  checkpoint: NameSchema,
  subject: DigestSchema,
  declaration: DigestSchema,
});
/** Grants and machine evidence cannot supply these independently checked decisions. */
export const DecisionsSchema = z.strictObject({
  judgments: z.array(JudgmentSchema),
  variances: z.array(AuthorizedVarianceSchema),
  proposals: z.array(StandardLimitProposalSchema),
});
export type CandidateDecisions = z.infer<typeof DecisionsSchema>;
