/** Canonical family membership, validated shapes, and lifetime policy. */
import { z } from "@zod/zod";
import { AuthoritySchema } from "./authority.ts";
import { CandidateSchema } from "./candidate.ts";
import { AttemptSchema, EnvironmentSchema } from "./environment.ts";
import {
  ArtifactSchema,
  CandidateProofSchema,
  EvidenceSchema,
} from "./evidence.ts";
import { RecordIdSchema } from "./identity.ts";
import { LandingSchema, QueueSchema, RetirementSchema } from "./outcomes.ts";
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
  environment: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("environment"),
      data: EnvironmentSchema,
    }),
  },
  authority: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("authority"),
      data: AuthoritySchema,
    }),
  },
  queue: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("queue"),
      data: QueueSchema,
    }),
  },
  landing: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("landing"),
      data: LandingSchema,
    }),
  },
  retirement: {
    lifetime: "mutable",
    schema: z.strictObject({
      ...header,
      kind: z.literal("retirement"),
      data: RetirementSchema,
    }),
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
        environment_id: record.data.environment_id,
        purpose: record.data.purpose,
        mode: record.data.mode,
      };
    case "environment":
      return {
        path: record.data.path,
        declaration: record.data.declaration,
        ownership: record.data.ownership,
      };
    case "authority":
      return { ...record.data, state: undefined };
    case "landing":
      return {
        ...record.data,
        outcome: undefined,
        authority_settlement: undefined,
        note: undefined,
        note_result: undefined,
        convergence_result: undefined,
      };
    case "retirement":
      return { ...record.data, outcome: undefined, effects: undefined };
    case "queue":
      return null;
    default:
      return record.data;
  }
}

/** A landed transition cannot be made pending by a later cleanup or note failure. */
export function landingAdvanced(record: CompletionRecord): boolean {
  return record.kind === "landing" && (record.data.outcome.kind === "landed" ||
    (record.data.outcome.kind === "recovery" &&
      record.data.outcome.ref_advanced));
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
  if (
    previous.kind === "retirement" && next.kind === "retirement" &&
    Object.entries(previous.data.effects ?? {}).some(([field, value]) =>
      value && Reflect.get(next.data.effects ?? {}, field) !== true
    )
  ) return false;
  if (landingAdvanced(previous) && !landingAdvanced(next)) return false;
  if (previous.kind === "attempt" && next.kind === "attempt") {
    // ADR 0380: one explicit binding precedes producer execution; normal claims remain immutable.
    const binding = previous.data.state.kind === "composing" &&
      next.data.state.kind === "claimed" &&
      previous.data.subjects.length === 0 &&
      JSON.stringify(previous.data.state.claim) ===
        JSON.stringify(next.data.state.claim);
    if (
      JSON.stringify(previous.data.subjects) !==
        JSON.stringify(next.data.subjects) && !binding
    ) return false;
    if (
      previous.data.state.kind === "composing" &&
      next.data.state.kind === "claimed" && !binding
    ) return false;
    if (
      next.data.state.kind === "composing" &&
      (previous.data.state.kind !== "composing" ||
        JSON.stringify(previous.data.state.claim) !==
          JSON.stringify(next.data.state.claim))
    ) return false;
    if (previous.data.state.kind === "finished") return false;
    if (
      previous.data.state.kind !== "planned" &&
      next.data.state.kind === "planned"
    ) return false;
    if (
      previous.data.state.kind === "recovery" &&
      next.data.state.kind === "claimed"
    ) return false;
    if (
      previous.data.state.kind === "claimed" &&
      next.data.state.kind === "claimed" &&
      previous.data.state.claim.token !== next.data.state.claim.token
    ) return false;
  }
  if (previous.kind === "authority" && previous.data.state.kind !== "granted") {
    return false;
  }
  if (
    previous.kind === "environment" && previous.data.state.kind === "disposed"
  ) return false;
  if (
    previous.kind === "retirement" && previous.data.outcome.kind === "retired"
  ) return false;
  return true;
}
