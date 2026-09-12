/** Why recorded evidence stopped applying; no executor runs from these definitions. */
import { z } from "@zod/zod";

export const InvalidationReasonSchema = z.enum([
  "source-replaced",
  "predecessor-changed",
  "policy-changed",
  "judgment-changed",
  "external-trunk",
  "producer-changed",
  "extractor-changed",
  "inputs-changed",
  "toolchain-changed",
  "environment-changed",
  "seed-changed",
  "denominator-changed",
  "artifact-unavailable",
  "newer-rerun",
  "claim-lost",
]);
export type InvalidationReason = z.infer<typeof InvalidationReasonSchema>;
