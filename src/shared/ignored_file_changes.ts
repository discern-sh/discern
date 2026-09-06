/** Bounded ignored-output observations shared by plans, recovery and results. */
import { z } from "@zod/zod";
export const IgnoredFileChangeSummarySchema = z.strictObject({
  status: z.enum([
    "disabled",
    "baseline_missing",
    "newer",
    "unavailable",
    "unchanged",
    "changed",
  ]),
  changed_roots: z.array(z.string()),
  changed_total: z.number(),
  truncated: z.boolean(),
  reason: z.string().optional(),
});
export type IgnoredFileChangeSummary = z.infer<
  typeof IgnoredFileChangeSummarySchema
>;
