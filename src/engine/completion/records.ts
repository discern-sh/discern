/** Canonical family membership, validated shapes, and lifetime policy. */
import { z } from "@zod/zod";
import { AttemptSchema } from "./attempt.ts";
import { CandidateSchema } from "./candidate.ts";
import {
  ArtifactSchema,
  CandidateProofSchema,
  EvidenceSchema,
} from "./evidence.ts";
import { ExceptionRecordSchema } from "./exception.ts";
import { RecordIdSchema } from "./identity.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

const header = {
  version: z.literal(ON_DISK_FORMATS.completionRecord.version),
  id: RecordIdSchema,
  revision: z.number().int().positive(),
};
/** New families enroll validation, store addressing, and registry-driven tests here. */
export const COMPLETION_FAMILIES = {
  candidate: {
    lifetime: "immutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("candidate"),
      data: CandidateSchema,
    }),
  },
  attempt: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("attempt"),
      data: AttemptSchema,
    }).refine(
      (record) => record.id === record.data.identity.id,
      "attempt id must match its durable coordinate",
    ),
  },
  evidence: {
    lifetime: "immutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("evidence"),
      data: EvidenceSchema,
    }),
  },
  proof: {
    lifetime: "immutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("proof"),
      data: CandidateProofSchema,
    }),
  },
  presentation: {
    lifetime: "immutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("presentation"),
      data: z.strictObject({
        candidate_id: RecordIdSchema,
        artifact: ArtifactSchema,
      }).refine(
        (value) => value.candidate_id === value.artifact.candidate_id,
        "presentation receipt must belong to its candidate",
      ),
    }),
  },
  exception: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("exception"),
      data: ExceptionRecordSchema,
    }).refine(
      (record) => record.id === record.data.claim.authorization_id,
      "exception id must match the approved authorization",
    ),
  },
} as const;

export const CompletionRecordSchema = z.union(
  Object.values(COMPLETION_FAMILIES).map((family) => family.schema),
);
export type CompletionRecord = z.infer<typeof CompletionRecordSchema>;
export type CompletionFamily = keyof typeof COMPLETION_FAMILIES;
export interface RecordSelector {
  readonly kind: CompletionFamily;
  readonly id: string;
}

/** Fields whose identity survives every compare-and-swap revision. */
function fixedRecordIdentity(record: CompletionRecord): unknown {
  switch (record.kind) {
    case "attempt":
      return {
        identity: record.data.identity,
        purpose: record.data.purpose,
        mode: record.data.mode,
      };
    case "exception":
      return {
        claim: record.data.claim,
        executor: record.data.executor,
        expected_trunk: record.data.expected_trunk,
        target: record.data.target,
      };
    default:
      return record.data;
  }
}

/** Reject identity replacement, terminal-state rollback, and immutable rewrites. */
export function recordTransitionAllowed(
  previous: CompletionRecord,
  next: CompletionRecord,
): boolean {
  if (
    previous.kind !== next.kind || previous.id !== next.id ||
    next.revision !== previous.revision + 1 ||
    COMPLETION_FAMILIES[previous.kind].lifetime === "immutable" ||
    JSON.stringify(fixedRecordIdentity(previous)) !==
      JSON.stringify(fixedRecordIdentity(next))
  ) return false;
  if (previous.kind === "attempt" && next.kind === "attempt") {
    // One explicit binding sets the subjects while the same claim is held;
    // a bound claim's subjects and token never change again.
    const binding = previous.data.state.kind === "planning" &&
      next.data.state.kind === "claimed" &&
      JSON.stringify(previous.data.state.claim) ===
        JSON.stringify(next.data.state.claim);
    if (
      JSON.stringify(previous.data.subjects) !==
        JSON.stringify(next.data.subjects) && !binding
    ) return false;
    if (previous.data.state.kind === "finished") return false;
    if (
      previous.data.state.kind === "claimed" &&
      next.data.state.kind === "planning"
    ) return false;
    if (
      previous.data.state.kind === "claimed" &&
      next.data.state.kind === "claimed" &&
      previous.data.state.claim.token !== next.data.state.claim.token
    ) return false;
  }
  if (previous.kind === "exception" && next.kind === "exception") {
    // A recorded transition outcome is final; only the note may still settle.
    if (
      previous.data.outcome.kind !== "planned" &&
      JSON.stringify(previous.data.outcome) !==
        JSON.stringify(next.data.outcome)
    ) return false;
    if (previous.data.note === "published" && next.data.note !== "published") {
      return false;
    }
  }
  return true;
}

/** Lease heartbeats are current liveness, not semantic attempt history. */
export function isAttemptClaimRenewal(
  previous: CompletionRecord,
  next: CompletionRecord,
): boolean {
  if (previous.kind !== "attempt" || next.kind !== "attempt") return false;
  const before = previous.data.state;
  const after = next.data.state;
  if (
    before.kind === "finished" || after.kind === "finished" ||
    after.kind !== before.kind
  ) return false;
  const withoutLease = (
    claim: typeof before.claim,
  ): Omit<typeof claim, "renewed_at" | "expires_at"> => {
    const { renewed_at: _renewedAt, expires_at: _expiresAt, ...identity } =
      claim;
    return identity;
  };
  return JSON.stringify(withoutLease(before.claim)) ===
    JSON.stringify(withoutLease(after.claim));
}
