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

/** A dead owner can delay an unlinked retry by at most this bounded lease. */
export const ATTEMPT_CLAIM_LEASE_MS = 60_000;

export const ClaimSchema = z.strictObject({
  token: RecordIdSchema,
  executor: ExecutorSchema,
  acquired_at: InstantSchema,
  /** Last successful renewal; absent on records written before renewable claims. */
  renewed_at: InstantSchema.optional(),
  expires_at: InstantSchema,
}).refine(
  (claim) => claim.expires_at > claim.acquired_at,
  "claim ownership must have a finite positive lifetime",
);
export type AttemptClaim = z.infer<typeof ClaimSchema>;

/** Lease timestamps describe current liveness, not the claim's owner identity. */
export function sameClaimIdentity(
  left: AttemptClaim,
  right: AttemptClaim,
): boolean {
  const stable = (claim: AttemptClaim): unknown => ({
    token: claim.token,
    executor: claim.executor,
    acquired_at: claim.acquired_at,
  });
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

/** Bound every stored claim to the current renewable-lease contract. */
export function effectiveClaimExpiry(
  claim: AttemptClaim,
  leaseMs = ATTEMPT_CLAIM_LEASE_MS,
): number {
  return Math.min(
    claim.expires_at,
    (claim.renewed_at ?? claim.acquired_at) + leaseMs,
  );
}

/** Compare the immutable binding while allowing lease timestamps to renew. */
export function sameClaimedAttemptBinding(
  current: CompletionAttempt,
  bound: CompletionAttempt,
): boolean {
  if (current.state.kind !== "claimed" || bound.state.kind !== "claimed") {
    return false;
  }
  return JSON.stringify({
        identity: current.identity,
        subjects: current.subjects,
        purpose: current.purpose,
        mode: current.mode,
      }) === JSON.stringify({
        identity: bound.identity,
        subjects: bound.subjects,
        purpose: bound.purpose,
        mode: bound.mode,
      }) && sameClaimIdentity(current.state.claim, bound.state.claim);
}

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
