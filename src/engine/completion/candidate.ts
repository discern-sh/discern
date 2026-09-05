/** Immutable composition facts. Ref publication and composition belong to the queue. */
import { z } from "@zod/zod";
import {
  DigestSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";

export const CompositionSchema = z.strictObject({
  procedure: DigestSchema,
  generated_ownership: DigestSchema,
  generators: DigestSchema,
  merge_commit: ObjectIdSchema.nullable(),
  regeneration_commit: ObjectIdSchema.nullable(),
}).refine(
  (value) =>
    value.regeneration_commit === null ||
    (value.merge_commit !== null &&
      value.merge_commit !== value.regeneration_commit),
  "generated convergence requires a separate merge commit",
);

export const CandidateSchema = z.strictObject({
  attempt_id: RecordIdSchema,
  source: SourceRevisionSchema,
  dependencies: z.array(SourceRevisionSchema),
  expected_predecessor: z.strictObject({
    head: ObjectIdSchema,
    candidate_id: RecordIdSchema.nullable(),
  }),
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  policy: DigestSchema,
  requirement_set: DigestSchema,
  composition: CompositionSchema,
}).refine(
  (value) =>
    new Set([
      value.source.effort_id,
      ...value.dependencies.map((source) => source.effort_id),
    ]).size === value.dependencies.length + 1,
  "each authored effort has one source revision",
);
export type Candidate = z.infer<typeof CandidateSchema>;
