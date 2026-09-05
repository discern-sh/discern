/** Recorded authority is input to re-verification, never a substitute for it. */
import { z } from "@zod/zod";
import { LANDING_CONSENT_SOURCES } from "../../shared/consent.ts";
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

const AuthoritySourceSchema = z.strictObject({
  source: z.enum(LANDING_CONSENT_SOURCES),
  record_id: RecordIdSchema,
  scopes: z.array(NameSchema),
}).refine(
  (source) =>
    source.source === "standing-grant"
      ? source.scopes.length > 0
      : source.scopes.length === 0,
  "only a standing grant carries a nonempty scope set",
);

export const AuthoritySchema = z.strictObject({
  source: AuthoritySourceSchema,
  approved_at: InstantSchema,
  sources: z.array(SourceRevisionSchema).min(1),
  composition_procedure: DigestSchema,
  policy: DigestSchema,
  predecessor_authorities: z.array(RecordIdSchema),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("granted") }),
    z.strictObject({ kind: z.literal("revoked"), at: InstantSchema }),
    z.strictObject({
      kind: z.literal("consumed"),
      landing_id: RecordIdSchema,
      at: InstantSchema,
    }),
  ]),
}).refine(
  (authority) =>
    new Set(authority.sources.map((source) => source.effort_id)).size ===
      authority.sources.length,
  "authority must identify one approved revision per effort",
);

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
