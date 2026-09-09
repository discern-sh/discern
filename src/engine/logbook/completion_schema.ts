/** Tolerant metadata projection of the canonical completion event contract. */
import { z } from "@zod/zod";
import type { CompletionEvent } from "../completion/protocol.ts";
import { EvidenceSchema } from "../completion/evidence.ts";
import { CompletionClaimSchema } from "../completion/authority.ts";
import {
  InvalidationReasonSchema,
  LandingSchema,
  RetirementSchema,
} from "../completion/outcomes.ts";

const facts = {
  producer: z.looseObject({
    kind: z.literal("producer"),
    producer: z.string(),
    use: z.enum(["executed", "reused"]),
    evidence_id: z.string(),
    outcome: z.enum(
      EvidenceSchema.shape.outcome.options.map((schema) =>
        schema.shape.kind.value
      ),
    ),
    duration_ms: z.number().nonnegative(),
  }),
  invalidated: z.looseObject({
    kind: z.literal("invalidated"),
    reason: InvalidationReasonSchema,
    affected_candidate_ids: z.array(z.string()),
    eligible_prediction: z.boolean(),
  }),
  timing: z.looseObject({
    kind: z.literal("timing"),
    interval_id: z.string(),
    category: z.enum([
      "approval",
      "queue",
      "compute",
      "execution",
      "environment",
    ]),
    started_at: z.number(),
    finished_at: z.number(),
  }),
  restoration: z.looseObject({
    kind: z.literal("restoration"),
    outcome: z.enum(["restored", "reset", "disposed", "recovery-incomplete"]),
  }),
  landing: z.looseObject({
    kind: z.literal("landing"),
    landing_id: z.string(),
    outcome: z.enum(
      LandingSchema.shape.outcome.options.map((schema) =>
        schema.shape.kind.value
      ),
    ),
    claim_kind: z.enum(
      CompletionClaimSchema.options.map((schema) => schema.shape.kind.value),
    ),
  }),
  retirement: z.looseObject({
    kind: z.literal("retirement"),
    retirement_id: z.string(),
    outcome: z.enum(
      RetirementSchema.shape.outcome.options.map((schema) =>
        schema.shape.kind.value
      ),
    ),
  }),
} satisfies {
  [Kind in CompletionEvent["fact"]["kind"]]: z.ZodType<
    Extract<CompletionEvent["fact"], { kind: Kind }>
  >;
};

/** New canonical fact kinds must join this checked projection before they can be recorded. */
export const completionObservationSchema = z.looseObject({
  id: z.string(),
  effort_id: z.string(),
  source_head: z.string(),
  candidate_id: z.string().nullable(),
  environment_id: z.string().nullable(),
  attempt_id: z.string().nullable(),
  executor_operation: z.string(),
  at: z.number(),
  fact: z.discriminatedUnion("kind", [
    facts.producer,
    ...Object.values(facts).filter((schema) => schema !== facts.producer),
  ]),
}) satisfies z.ZodType<CompletionEvent>;
