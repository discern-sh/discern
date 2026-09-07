/** The emergency claim has no dependency on public Proof schemas. */
import { z } from "@zod/zod";
import {
  DigestSchema,
  InstantSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";
import { RequirementSchema } from "./evidence.ts";
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
  reason: z.string().min(1),
  exceptions: z.array(z.strictObject({
    requirement: RequirementSchema,
    state: z.enum(["failed", "unrun", "stale"]),
    evidence_id: RecordIdSchema.nullable(),
  })).min(1),
});
