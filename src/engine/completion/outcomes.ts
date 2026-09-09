import { RetirementEffectsSchema } from "../../shared/accept_landing_state.ts";
/** Durable queue and terminal outcomes; no executor runs from these definitions. */
import { z } from "@zod/zod";
import { CompletionClaimSchema } from "./authority.ts";
import { ArtifactSchema } from "./evidence.ts";
import { RecoverySchema } from "./environment.ts";
import {
  DigestSchema,
  ExecutorSchema,
  InstantSchema,
  NameSchema,
  ObjectIdSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";

export const InvalidationReasonSchema = z.enum([
  "source-replaced",
  "withdrawn",
  "authority-revoked",
  "predecessor-changed",
  "policy-changed",
  "judgment-changed",
  "candidate-failed",
  "reprioritized",
  "external-trunk",
  "producer-changed",
  "extractor-changed",
  "inputs-changed",
  "toolchain-changed",
  "environment-changed",
  "seed-changed",
  "denominator-changed",
  "context-missing",
  "artifact-unavailable",
  "newer-rerun",
  "claim-lost",
]);
export type InvalidationReason = z.infer<typeof InvalidationReasonSchema>;

export const QueueSchema = z.strictObject({
  trunk: ObjectIdSchema,
  entries: z.array(z.strictObject({
    source: SourceRevisionSchema,
    provisional_order: z.number().int().nonnegative(),
    eligible_order: z.number().int().nonnegative().nullable(),
    approval_batch: RecordIdSchema.nullable(),
    candidate_id: RecordIdSchema.nullable(),
    authority_id: RecordIdSchema.nullable(),
    dependencies: z.array(NameSchema),
    state: z.enum([
      "provisional",
      "eligible",
      "active",
      "failed",
      "withdrawn",
      "landed",
    ]),
    held: z.boolean().optional(),
    revoked_grant: RecordIdSchema.nullable().optional(),
    invalidation: InvalidationReasonSchema.nullable(),
  })),
}).refine(
  (queue) =>
    new Set(queue.entries.map((entry) => entry.source.effort_id)).size ===
      queue.entries.length,
  "queue must retain one current entry per effort",
);
export type CompletionQueue = z.infer<typeof QueueSchema>;

export const LandingSchema = z.strictObject({
  attempt_id: RecordIdSchema,
  candidate_id: RecordIdSchema,
  source: SourceRevisionSchema,
  executor: ExecutorSchema,
  expected_trunk: ObjectIdSchema,
  target: ObjectIdSchema,
  policy: DigestSchema,
  claim: CompletionClaimSchema,
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("planned") }),
    z.strictObject({
      kind: z.literal("landed"),
      at: InstantSchema,
      transition_marker: RecordIdSchema,
    }),
    z.strictObject({
      kind: z.literal("not-landed"),
      reason: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("recovery"),
      ref_advanced: z.boolean(),
      recovery: RecoverySchema,
    }),
  ]),
  authority_settlement: z.enum(["pending", "consumed", "restored"]),
  note: z.enum(["pending", "published", "recovery"]),
  note_result: ArtifactSchema.optional(),
  convergence_result: ArtifactSchema.optional(),
}).refine((landing) => {
  if (
    landing.claim.kind === "exception" &&
    (landing.claim.actual_trunk !== landing.expected_trunk ||
      landing.claim.candidate_id !== landing.candidate_id ||
      landing.claim.candidate_head !== landing.target ||
      landing.claim.policy !== landing.policy ||
      JSON.stringify(landing.claim.source) !== JSON.stringify(landing.source))
  ) return false;
  const advanced = landing.outcome.kind === "landed" ||
    (landing.outcome.kind === "recovery" && landing.outcome.ref_advanced);
  return (!advanced || landing.authority_settlement !== "restored") &&
    (advanced ||
      (landing.authority_settlement !== "consumed" &&
        landing.note !== "published"));
}, "landing settlement and exception must agree with the exact ref transition");
export type CompletionLanding = z.infer<typeof LandingSchema>;

export const RetirementSchema = z.strictObject({
  effects: RetirementEffectsSchema.optional(),
  landing_id: RecordIdSchema.nullable(),
  external_integration_id: RecordIdSchema.optional(),
  source: SourceRevisionSchema,
  environment_id: RecordIdSchema,
  release_id: RecordIdSchema.nullable(),
  /** Frozen release, complete checkout capture, and exact environment reservation. */
  capture: ArtifactSchema.optional(),
  reservation: z.number().int().positive().optional(),
  ownership: DigestSchema,
  frozen_cleanup: z.array(z.string().min(1)),
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({
      kind: z.literal("retained"),
      reason: z.enum([
        "unreleased",
        "moved-branch",
        "dirty",
        "active-use",
        "ownership-uncertain",
      ]),
    }),
    z.strictObject({ kind: z.literal("retired"), at: InstantSchema }),
    z.strictObject({ kind: z.literal("recovery"), recovery: RecoverySchema }),
  ]),
}).refine(
  (retirement) =>
    retirement.outcome.kind !== "retired" || retirement.release_id !== null,
  "retirement needs a recorded release",
).refine(
  (retirement) =>
    (retirement.landing_id !== null) !==
      (retirement.external_integration_id !== undefined),
  "retirement names either a governed landing or an observed external integration",
);
export type CompletionRetirement = z.infer<typeof RetirementSchema>;
