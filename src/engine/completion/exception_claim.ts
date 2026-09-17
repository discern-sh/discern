/** The emergency claim has no dependency on public Proof schemas. */
import { z } from "@zod/zod";
import { decisionVocabulary } from "../../shared/result_vocabulary.ts";
import {
  DigestSchema,
  InstantSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";
import { ArtifactSchema, RequirementSchema } from "./evidence.ts";
/** Fresh exact emergency authority is permanently distinct from passing Proof. */
export const ExceptionClaimSchema = z.strictObject({
  kind: z.literal("exception"),
  authorization_id: RecordIdSchema,
  authorized_at: InstantSchema,
  actual_trunk: ObjectIdSchema,
  source: SourceRevisionSchema,
  candidate_id: RecordIdSchema,
  candidate_head: ObjectIdSchema,
  policy: DigestSchema,
  review: ArtifactSchema.optional(),
  reason: z.string().min(1),
  exceptions: z.array(z.strictObject({
    requirement: RequirementSchema,
    state: decisionVocabulary("x-discern-exception-states"),
    evidence_id: RecordIdSchema.nullable(),
  })).min(1),
}).refine(
  (claim) =>
    claim.review === undefined ||
    (claim.review.candidate_id === claim.candidate_id &&
      claim.review.path === "environment/emergency-review.json"),
  "Emergency review must name this candidate and its preparation artifact.",
);
