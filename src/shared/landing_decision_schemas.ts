/**
 * The owner's exact landing decisions, as durable shapes: a variance over one
 * declared-unmet checkpoint, and the standard limit proposal an owner
 * approves. Result envelopes, acceptance journals, and emergency exception
 * claims all record them, so they live apart from any one of those schemas.
 */
import { z } from "@zod/zod";
import { decisionVocabulary } from "./result_vocabulary.ts";
import { validateStandardLimitReason } from "./standard_limit_reason.ts";

/** One Standard limit proposal. It is bound to the measured source
 * commit, the immutable config-only proposal commit, the current descendant
 * commit whose measurement renews it, the trunk baseline, the complete Standard
 * definition, and the responsible changed paths. */
export const StandardLimitProposalSchema = z.strictObject({
  standard: z.string(),
  commit: z.string(),
  bound_commit: z.string(),
  measured_commit: z.string(),
  definition_fingerprint: z.string(),
  trunk: z.string(),
  trunk_commit: z.string(),
  direction: decisionVocabulary("x-discern-proposal-directions"),
  trunk_limit: z.number(),
  proposed_limit: z.number(),
  measurement: z.number(),
  delta: z.number(),
  reason: z.string().superRefine((reason, context) => {
    const validated = validateStandardLimitReason(reason);
    if (!validated.ok) {
      context.addIssue({ code: "custom", message: validated.message });
    }
  }),
  evidence_paths: z.array(z.string().min(1)).min(1).refine(
    (paths) => new Set(paths).size === paths.length,
    "responsible paths must be unique",
  ),
});

/**
 * One owner-authorized variance: permission to land one current declared-unmet
 * checkpoint without changing it. Bound to the exact declaration — checkpoint
 * id, resolved-definition hash, subject fingerprint, and rationale — and to
 * the landed commit it travels with; it changes no future policy.
 */
export const AuthorizedVarianceSchema = z.strictObject({
  checkpoint: z.string(),
  definition_hash: z.string(),
  subject: z.string(),
  /** The agent's rationale the owner authorized landing against. */
  why: z.string(),
}).meta({
  id: "DiscernAuthorizedVariance",
  description:
    "Owner authorization to land one declared-unmet checkpoint, bound to the " +
    "exact declaration (checkpoint, definition hash, subject fingerprint, " +
    "rationale) and the commit it landed with. Never a future policy.",
});
