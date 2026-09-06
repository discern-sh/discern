/** Identities shared by completion domains; none implies approval or readiness. */
import { z } from "@zod/zod";
import { CANDIDATE_REF_PREFIX } from "../../shared/git_conventions.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";

export const RecordIdSchema = z.uuid().refine(
  (id) => id === id.toLowerCase(),
  "record ids use canonical lowercase UUIDs",
);
export const ObjectIdSchema = z.string().regex(
  /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
);
export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const NameSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/u);
export const InstantSchema = z.number().int().nonnegative();
export const SourceRevisionSchema = z.strictObject({
  effort_id: NameSchema,
  branch: z.string().regex(/^refs\/heads\/[^\s~^:?*\[\\]+$/u).refine(
    (ref) =>
      !ref.includes("..") && !ref.includes("@{") && !ref.endsWith(".") &&
      ref.split("/").every((part) =>
        part !== "" && !part.startsWith(".") && !part.endsWith(".lock")
      ),
    "source branch must be a canonical branch ref",
  ),
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
});
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;

export const ExecutorSchema = z.strictObject({
  operation_id: RecordIdSchema,
  originating_effort: NameSchema,
  started_at: InstantSchema,
});
export type Executor = z.infer<typeof ExecutorSchema>;

export const AttemptIdentitySchema = z.strictObject({
  id: RecordIdSchema,
  candidate_id: RecordIdSchema,
  executor: ExecutorSchema,
  /** Repository-wide reservation order; evidence compares only applicable subjects. */
  sequence: z.number().int().positive(),
  /** Observed finished predecessor; its sequence bounds an explicit retry of failed subjects. */
  rerun_of: RecordIdSchema.nullable(),
  started_at: InstantSchema,
});
export type AttemptIdentity = z.infer<typeof AttemptIdentitySchema>;

/** Allocate identities through the existing injected entropy and clock. */
export function newAttemptIdentity(
  input: Pick<
    AttemptIdentity,
    "candidate_id" | "executor" | "sequence" | "rerun_of"
  >,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): AttemptIdentity {
  return AttemptIdentitySchema.parse({
    ...input,
    id: entropy.uuid(),
    started_at: clock.wallNow(),
  });
}

/** A candidate ref never aliases a mutable source branch or another attempt. */
export function candidateRef(candidateId: string, attemptId: string): string {
  return `${CANDIDATE_REF_PREFIX}/${RecordIdSchema.parse(candidateId)}/${
    RecordIdSchema.parse(attemptId)
  }`;
}
