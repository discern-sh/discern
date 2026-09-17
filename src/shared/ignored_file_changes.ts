/** Bounded ignored-output observations shared by plans, recovery and results. */
import { z } from "@zod/zod";
import { openVocabulary } from "./result_vocabulary.ts";
export const IgnoredFileChangeSummarySchema = z.strictObject({
  status: openVocabulary("x-discern-ignored-file-change-statuses"),
  changed_roots: z.array(z.string()),
  changed_total: z.number(),
  truncated: z.boolean(),
  reason: z.string().optional(),
});
export type IgnoredFileChangeSummary = z.infer<
  typeof IgnoredFileChangeSummarySchema
>;
