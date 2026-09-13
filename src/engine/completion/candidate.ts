/** The immutable subject one gate run proves: exact source revisions composed
 * against the trunk they were checked on. An ordinary `done` proves one source
 * tip; an integrated landing proves the composition of the submitted sources
 * with the trunk, and records that procedure explicitly. */
import { z } from "@zod/zod";
import {
  DigestSchema,
  ObjectIdSchema,
  RecordIdSchema,
  type SourceRevision,
  SourceRevisionSchema,
} from "./identity.ts";

/** How recorded sources became the tested head. The set is closed until a new
 * composition procedure earns a decision of its own. */
export const CandidateIntegrationSchema = z.strictObject({
  procedure: z.literal("merge-trunk"),
});

export const CandidateSchema = z.strictObject({
  /** The attempt that recorded this candidate. */
  attempt_id: RecordIdSchema,
  /** The canonical composition input: exact source revisions, in composition
   * order. One entry today; the list is the authority, so no writable singular
   * source can disagree with it. */
  sources: z.array(SourceRevisionSchema).min(1),
  /** The trunk commit the composition was proven against. */
  predecessor: ObjectIdSchema,
  /** The tested resulting commit — the source tip itself for an ordinary run. */
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  /** The trunk's committed configuration identity at the predecessor. */
  policy: DigestSchema,
  requirement_set: DigestSchema,
  /** Present only on an integrated result, naming the declared composition
   * procedure that produced `head` from `sources` and `predecessor`. */
  integration: CandidateIntegrationSchema.optional(),
}).refine(
  (value) =>
    value.integration !== undefined ||
    (value.sources.length === 1 && value.head === value.sources[0]?.head),
  "an ordinary candidate is its single source tip",
);
export type Candidate = z.infer<typeof CandidateSchema>;

/** The trunk commit the candidate was proven against. */
export function candidatePredecessor(candidate: Candidate): string {
  return candidate.predecessor;
}

/** The authoring source revision — the first composition input. */
export function candidateAuthor(candidate: Candidate): SourceRevision {
  const author = candidate.sources[0];
  if (author === undefined) {
    throw new Error("a candidate records at least one source revision");
  }
  return author;
}

/** Whether the candidate records an integrated composition rather than a
 * source tip. */
export function candidateIsIntegrated(candidate: Candidate): boolean {
  return candidate.integration !== undefined;
}

/**
 * Migrate a stored pre-list candidate payload — `{ source }` — to the current
 * `{ sources: [source] }` shape, in memory only (the registered format keeps
 * one version; bytes on disk are never rewritten). Every other value passes
 * through untouched, so validation still owns the verdict.
 */
export function migrateSingularSourceCandidate(value: unknown): unknown {
  if (
    typeof value !== "object" || value === null || Array.isArray(value)
  ) return value;
  const record = value as Record<string, unknown>;
  if (record.kind !== "candidate") return value;
  const data = record.data;
  if (
    typeof data !== "object" || data === null || Array.isArray(data)
  ) return value;
  const fields = data as Record<string, unknown>;
  const migrated = migrateSingularSourceFields(fields);
  if (migrated === fields) return value;
  return { ...record, data: migrated };
}

/** The field-level singular→list rewrite every embedding shares. */
function migrateSingularSourceFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (!("source" in fields) || "sources" in fields) return fields;
  const { source, ...rest } = fields;
  return { ...rest, sources: [source] };
}

/** Migrate the candidate a retained Proof presentation embeds at
 * `completion.candidate`. Retained artifacts written before the list shape
 * carry the singular field there too, and the presentation must keep
 * reproducing its complete evidence byte-for-byte after both sides migrate.
 * Anything that is not that exact embedding passes through untouched. */
export function migrateProofEmbeddedCandidate(value: unknown): unknown {
  if (
    typeof value !== "object" || value === null || Array.isArray(value)
  ) return value;
  const proof = value as Record<string, unknown>;
  const completion = proof.completion;
  if (
    typeof completion !== "object" || completion === null ||
    Array.isArray(completion)
  ) return value;
  const complete = completion as Record<string, unknown>;
  const candidate = complete.candidate;
  if (
    typeof candidate !== "object" || candidate === null ||
    Array.isArray(candidate)
  ) return value;
  const migrated = migrateSingularSourceFields(
    candidate as Record<string, unknown>,
  );
  if (migrated === candidate) return value;
  return { ...proof, completion: { ...complete, candidate: migrated } };
}
