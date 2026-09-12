/** The immutable subject one `done` proves: a source tip against the trunk it was checked on. */
import { z } from "@zod/zod";
import {
  DigestSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";

export const CandidateSchema = z.strictObject({
  /** The attempt that recorded this candidate. */
  attempt_id: RecordIdSchema,
  source: SourceRevisionSchema,
  /** The trunk commit the source was proven against. */
  predecessor: ObjectIdSchema,
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  /** The trunk's committed configuration identity at the predecessor. */
  policy: DigestSchema,
  requirement_set: DigestSchema,
}).refine(
  (value) => value.head === value.source.head,
  "a candidate is its source tip",
);
export type Candidate = z.infer<typeof CandidateSchema>;

/** The trunk commit the candidate was proven against. */
export function candidatePredecessor(candidate: Candidate): string {
  return candidate.predecessor;
}
