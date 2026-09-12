/** Tolerant metadata projection of the canonical completion event contract. */
import { z } from "@zod/zod";
import {
  COMPLETION_TIMING_CATEGORIES,
  type CompletionEvent,
} from "../completion/protocol.ts";
import { EvidenceSchema } from "../completion/evidence.ts";
import { InvalidationReasonSchema } from "../completion/outcomes.ts";

const facts = {
  proven: z.looseObject({
    kind: z.literal("proven"),
    proof_id: z.string(),
    mode: z.enum(["strict", "report"]),
  }),
  "validation-summary": z.looseObject({
    kind: z.literal("validation-summary"),
    demand: z.enum([
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
  }),
  timing: z.looseObject({
    kind: z.literal("timing"),
    interval_id: z.string(),
    category: z.enum(COMPLETION_TIMING_CATEGORIES),
    started_at: z.number(),
    finished_at: z.number(),
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
  attempt_id: z.string().nullable(),
  executor_operation: z.string(),
  at: z.number(),
  fact: z.discriminatedUnion("kind", [
    facts.producer,
    ...Object.values(facts).filter((schema) => schema !== facts.producer),
  ]),
}) satisfies z.ZodType<CompletionEvent>;
