/** One `done` run's durable claim over its candidate: planned, bound, then finished. */
import { z } from "@zod/zod";
import { openVocabulary } from "../../shared/result_vocabulary.ts";
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

/**
 * Bound every stored claim to the current renewable-lease contract. Outside
 * this module the expiry is only ever reported: a takeover is decided by
 * {@link claimTakeoverPermitted}, and ownership never reads the lease.
 */
export function effectiveClaimExpiry(claim: AttemptClaim): number {
  return Math.min(
    claim.expires_at,
    (claim.renewed_at ?? claim.acquired_at) + ATTEMPT_CLAIM_LEASE_MS,
  );
}

/** The lease timestamps a claim carries once acquired or renewed at `now`. */
export function claimLease(now: number): {
  readonly renewed_at: number;
  readonly expires_at: number;
} {
  return { renewed_at: now, expires_at: now + ATTEMPT_CLAIM_LEASE_MS };
}

/**
 * Whether another run may retire this claim: its lease lapsed with nothing
 * renewed. Permission is not loss. The claim stays its owner's until a
 * retirement actually lands on the attempt record.
 */
export function claimTakeoverPermitted(
  claim: AttemptClaim,
  now: number,
): boolean {
  return effectiveClaimExpiry(claim) <= now;
}

/** An attempt whose record still carries a live claim. */
export type HeldAttempt = CompletionAttempt & {
  readonly state: Exclude<CompletionAttempt["state"], { kind: "finished" }>;
};

/** The abort reason a run receives once its attempt record proves the claim gone. */
export class AttemptClaimLost extends Error {
  constructor() {
    super(
      "Another discern run closed this run's completion attempt after its claim stopped renewing, so this run did not complete.",
    );
    this.name = "AttemptClaimLost";
  }
}

/**
 * What a run reports once a step proves its claim gone, whichever step found
 * it: the retirement cancelled the run.
 */
export function claimLossBlocker(): {
  readonly kind: "cancelled";
  readonly reason: string;
} {
  return { kind: "cancelled", reason: new AttemptClaimLost().message };
}

/** Why a run was cancelled, naming the claim loss when that is what stopped it. */
export function cancellationReason(
  signal: AbortSignal,
  fallback: string,
): string {
  return signal.reason instanceof AttemptClaimLost
    ? signal.reason.message
    : fallback;
}

/** Why a claim-dependent step refused: the record proves the claim is gone. */
export const CLAIM_NOT_HELD =
  "the attempt record no longer names this claim: another run retired it or it has already settled";

/**
 * The one ownership test: the attempt record still names this fencing token
 * on an unfinished claim. Only a transition written to the record ends a
 * claim — another run's retirement or the attempt's own settlement. A lapsed
 * lease does not, so an owner that stalled while nobody retired it still owns
 * its attempt.
 */
export function attemptHoldsClaim(
  attempt: CompletionAttempt,
  token: string,
): attempt is HeldAttempt {
  return attempt.state.kind !== "finished" &&
    attempt.state.claim.token === token;
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
      outcome: openVocabulary("x-discern-attempt-outcomes"),
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
