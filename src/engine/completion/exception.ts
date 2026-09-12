/** An emergency landing's durable record: the exception the owner approved and how it settled. */
import { z } from "@zod/zod";
import { ExceptionClaimSchema } from "./exception_claim.ts";
import { ExecutorSchema, InstantSchema, ObjectIdSchema } from "./identity.ts";

export const ExceptionRecordSchema = z.strictObject({
  claim: ExceptionClaimSchema,
  executor: ExecutorSchema,
  /** The trunk commit the transition expected to advance from. */
  expected_trunk: ObjectIdSchema,
  /** The repair commit the transition advanced the trunk to. */
  target: ObjectIdSchema,
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("planned") }),
    z.strictObject({ kind: z.literal("landed"), at: InstantSchema }),
    z.strictObject({
      kind: z.literal("not-landed"),
      at: InstantSchema,
      reason: z.string().min(1),
    }),
  ]),
  /** Whether the exception note reached the landed commit. */
  note: z.enum(["pending", "published", "failed"]),
}).refine(
  (record) =>
    record.claim.actual_trunk === record.expected_trunk &&
    record.claim.candidate_head === record.target,
  "an exception record lands exactly the approved repair on the approved trunk",
);
export type ExceptionRecord = z.infer<typeof ExceptionRecordSchema>;
