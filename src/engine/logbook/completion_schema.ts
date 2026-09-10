/** Tolerant metadata projection of the canonical completion event contract. */
import { z } from "@zod/zod";
import {
  COMPLETION_TIMING_CATEGORIES,
  type CompletionEvent,
} from "../completion/protocol.ts";
import { EvidenceSchema } from "../completion/evidence.ts";
import { CompletionClaimSchema } from "../completion/authority.ts";
import {
  InvalidationReasonSchema,
  LandingSchema,
  RetirementSchema,
} from "../completion/outcomes.ts";

const facts = {
  admitted: z.looseObject({
    kind: z.literal("admitted"),
    proof_id: z.string(),
    mode: z.enum(["strict", "report"]),
    eligible_prediction: z.boolean(),
    expected_predecessor_candidate_id: z.string().nullable(),
  }),
  withdrawn: z.looseObject({
    kind: z.literal("withdrawn"),
    admission: z.enum(["before-green", "after-green", "unknown"]),
  }),
  "validation-summary": z.looseObject({
    kind: z.literal("validation-summary"),
    demand: z.enum([
      "compose",
      "done",
      "test",
      "standards",
      "pin",
      "proposal",
      "standalone",
      "prepare",
      "diagnostic",
    ]),
    producer_executions: z.number().int().nonnegative(),
    reused_receipts: z.number().int().nonnegative(),
  }),
  "command-started": z.looseObject({
    kind: z.literal("command-started"),
    execution_id: z.string(),
    producer: z.string(),
    role: z.enum(["producer", "extractor"]),
  }),
  "command-finished": z.looseObject({
    kind: z.literal("command-finished"),
    execution_id: z.string(),
    producer: z.string(),
    role: z.enum(["producer", "extractor"]),
    outcome: z.enum(["passed", "failed", "cancelled"]),
    started_at: z.number(),
    finished_at: z.number(),
    duration_ms: z.number().nonnegative(),
  }),
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
    category: z.enum(COMPLETION_TIMING_CATEGORIES),
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
