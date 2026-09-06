/** Recorded authority is input to re-verification, never a substitute for it. */
import { z } from "@zod/zod";
import {
  AuthorizedVarianceSchema,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import {
  DigestSchema,
  InstantSchema,
  NameSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";
import { RequirementSchema } from "./evidence.ts";

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

/** Reserved data contract only; no command in 1A issues an exception or authority. */
export const ExceptionClaimSchema = z.strictObject({
  kind: z.literal("exception"),
  authorization_id: RecordIdSchema,
  authorized_at: InstantSchema,
  actual_trunk: ObjectIdSchema,
  source: SourceRevisionSchema,
  candidate_id: RecordIdSchema,
  candidate_head: ObjectIdSchema,
  policy: DigestSchema,
  reason: z.string().min(1),
  exceptions: z.array(z.strictObject({
    requirement: RequirementSchema,
    state: z.enum(["failed", "unrun", "stale"]),
    evidence_id: RecordIdSchema.nullable(),
  })).min(1),
});
export const CompletionClaimSchema = z.discriminatedUnion("kind", [
  NormalClaimSchema,
  ExceptionClaimSchema,
]);
