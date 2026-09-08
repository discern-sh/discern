/** Release, exclusive execution, and recovery retain independent durable facts. */
import { z } from "@zod/zod";
import { isAbsolute } from "@std/path";
import {
  ArtifactSchema,
  CompletionModeSchema,
  EvidencePurposeSchema,
} from "./evidence.ts";
import {
  AttemptIdentitySchema,
  DigestSchema,
  ExecutorSchema,
  InstantSchema,
  NameSchema,
  RecordIdSchema,
  SourceRevisionSchema,
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

export const RecoverySchema = z.strictObject({
  phase: z.enum([
    "prepare",
    "install",
    "validate",
    "capture",
    "restore",
    "reset",
    "dispose",
    "publish",
    "settle",
    "retire",
  ]),
  reason: z.string().min(1),
  children_quiescent: z.boolean(),
  drift: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("captured"),
      artifacts: z.array(ArtifactSchema).min(1),
    }),
    z.strictObject({
      kind: z.literal("uncaptured"),
      reason: z.string().min(1),
    }),
  ]),
  retained_paths: z.array(z.string().min(1)),
  frozen_cleanup: z.array(z.string().min(1)),
});
export type CompletionRecovery = z.infer<typeof RecoverySchema>;

export const AttemptSchema = z.strictObject({
  identity: AttemptIdentitySchema,
  environment_id: RecordIdSchema,
  /** Planned Applicability hashes; one environment attempt may execute many producers. */
  subjects: z.array(DigestSchema).refine(
    (subjects) => new Set(subjects).size === subjects.length,
    "attempt subjects must be distinct",
  ),
  purpose: EvidencePurposeSchema,
  mode: CompletionModeSchema,
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("planned") }),
    z.strictObject({ kind: z.literal("composing"), claim: ClaimSchema }),
    z.strictObject({ kind: z.literal("claimed"), claim: ClaimSchema }),
    z.strictObject({
      kind: z.literal("finished"),
      outcome: z.enum(["passed", "failed", "cancelled"]),
      finished_at: InstantSchema,
    }),
    z.strictObject({ kind: z.literal("recovery"), recovery: RecoverySchema }),
  ]),
}).refine(
  (attempt) =>
    (attempt.state.kind !== "claimed" && attempt.state.kind !== "composing") ||
    JSON.stringify(attempt.state.claim.executor) ===
      JSON.stringify(attempt.identity.executor),
  "attempt and claim must name the same executor",
).refine(
  (attempt) =>
    attempt.state.kind !== "composing" || attempt.subjects.length === 0,
  "composition attempts cannot declare validation subjects",
);
export type CompletionAttempt = z.infer<typeof AttemptSchema>;

const EnvironmentOwnershipSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("borrowed"),
    source: SourceRevisionSchema,
    identity: z.strictObject({
      worktree_id: NameSchema,
      seed: z.number().int(),
      resources: z.record(NameSchema, z.string().min(1)),
    }),
  }),
  z.strictObject({
    kind: z.literal("isolated"),
    owner_operation: RecordIdSchema,
    disposable: z.boolean(),
  }),
]);

export const EnvironmentSchema = z.strictObject({
  path: z.string().refine(isAbsolute, "environment path must be absolute"),
  declaration: DigestSchema,
  ownership: EnvironmentOwnershipSchema,
  release: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("held") }),
    z.strictObject({
      kind: z.literal("released"),
      id: RecordIdSchema,
      at: InstantSchema,
      owner: NameSchema,
      subject: DigestSchema,
      retirement: z.boolean(),
    }),
  ]),
  state: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("idle"),
      returned_attempt_id: RecordIdSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("executing"),
      attempt_id: RecordIdSchema,
      candidate_id: RecordIdSchema,
      release_id: RecordIdSchema,
      claim: ClaimSchema,
      /** Latest retained capture; immutable revisions retain earlier captures. */
      capture: ArtifactSchema.optional(),
      phase: z.enum([
        "prepare",
        "install",
        "validate",
        "capture",
        "restore",
        "reset",
        "dispose",
      ]),
    }),
    z.strictObject({
      kind: z.literal("recovery"),
      attempt_id: RecordIdSchema,
      recovery: RecoverySchema,
    }),
    z.strictObject({ kind: z.literal("disposed"), at: InstantSchema }),
  ]),
}).refine(
  (environment) =>
    environment.state.kind !== "executing" ||
    (environment.release.kind === "released" &&
      environment.state.release_id === environment.release.id),
  "execution must bind the recorded release",
);
export type ExecutionEnvironment = z.infer<typeof EnvironmentSchema>;

/** Expiry never returns an environment to the pool; recovery must reconcile it. */
export function environmentAvailability(
  environment: ExecutionEnvironment,
  now: number,
):
  | { readonly kind: "available" }
  | {
    readonly kind: "environment-unavailable";
    readonly reason: "held" | "busy" | "disposed";
  }
  | {
    readonly kind: "recovery-incomplete";
    readonly reason: "recorded" | "claim-expired";
  } {
  if (environment.state.kind === "recovery") {
    return { kind: "recovery-incomplete", reason: "recorded" };
  }
  if (environment.state.kind === "executing") {
    return environment.state.claim.expires_at <= now
      ? { kind: "recovery-incomplete", reason: "claim-expired" }
      : { kind: "environment-unavailable", reason: "busy" };
  }
  if (environment.state.kind === "disposed") {
    return { kind: "environment-unavailable", reason: "disposed" };
  }
  return environment.release.kind === "released"
    ? { kind: "available" }
    : { kind: "environment-unavailable", reason: "held" };
}
