import { ExceptionClaimSchema } from "./exception_claim.ts";
export { ExceptionClaimSchema } from "./exception_claim.ts";
/** Recorded authority is input to re-verification, never a substitute for it. */
import { z } from "@zod/zod";
import {
  AuthorizedVarianceSchema,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import { DigestSchema, NameSchema, RecordIdSchema } from "./identity.ts";

export { AuthoritySchema } from "./source_authority.ts";

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

export const NormalClaimSchema = z.strictObject({
  kind: z.literal("normal"),
  proof_id: RecordIdSchema,
  authority_id: RecordIdSchema,
  decisions: DecisionsSchema,
});

export const CompletionClaimSchema = z.discriminatedUnion("kind", [
  NormalClaimSchema,
  ExceptionClaimSchema,
]);
