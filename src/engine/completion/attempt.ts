/** One `done` run's durable claim over its candidate: planned, bound, then finished. */
import { z } from "@zod/zod";
import { CompletionModeSchema, EvidencePurposeSchema } from "./evidence.ts";
import {
  AttemptIdentitySchema,
  DigestSchema,
  ExecutorSchema,
  InstantSchema,
  RecordIdSchema,
} from "./identity.ts";

export const ClaimSchema = z.strictObject({
  token: RecordIdSchema,
  executor: ExecutorSchema,
  acquired_at: InstantSchema,
  expires_at: InstantSchema,
}).refine(
  (claim) => claim.expires_at > claim.acquired_at,
  "claim ownership must have a finite positive lifetime",
);

export const AttemptSchema = z.strictObject({
  identity: AttemptIdentitySchema,
  /** Planned Applicability hashes; one attempt may execute many producers. */
  subjects: z.array(DigestSchema).refine(
    (subjects) => new Set(subjects).size === subjects.length,
    "attempt subjects must be distinct",
  ),
  purpose: EvidencePurposeSchema,
  mode: CompletionModeSchema,
  state: z.discriminatedUnion("kind", [
    /** The attempt holds its claim while the demand is still being planned. */
    z.strictObject({ kind: z.literal("planning"), claim: ClaimSchema }),
    /** The demand is bound; evidence and Proof may be published under it. */
    z.strictObject({ kind: z.literal("claimed"), claim: ClaimSchema }),
    z.strictObject({
      kind: z.literal("finished"),
      outcome: z.enum(["passed", "failed", "cancelled"]),
      finished_at: InstantSchema,
    }),
  ]),
}).refine(
  (attempt) =>
    attempt.state.kind === "finished" ||
    JSON.stringify(attempt.state.claim.executor) ===
      JSON.stringify(attempt.identity.executor),
  "attempt and claim must name the same executor",
).refine(
  (attempt) =>
    attempt.state.kind !== "planning" || attempt.subjects.length === 0,
  "a planning attempt has not bound its validation subjects yet",
);
export type CompletionAttempt = z.infer<typeof AttemptSchema>;
