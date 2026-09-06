/**
 * Acceptance's irreversible effect state, shared by result envelopes and the
 * local logbook without pulling either subsystem through the other's module
 * graph.
 */

import { z } from "@zod/zod";

/** The runtime shape every acceptance effect-state consumer derives from. */
export const ACCEPT_LANDING_STATE_SHAPE = {
  /** An interrupted transaction was mutated or reconciled during this call. */
  recovery_performed: z.boolean(),
  /** The trunk ref reached the accepted commit and was not rolled back. */
  trunk_landed: z.boolean(),
  /** The linked worktree directory and registration were removed. */
  worktree_removed: z.boolean(),
  /** The now-merged local branch was deleted. */
  branch_deleted: z.boolean(),
} satisfies z.ZodRawShape;

/** Which irreversible acceptance effects happened before the result returned. */
export const AcceptLandingStateSchema = z.strictObject(
  ACCEPT_LANDING_STATE_SHAPE,
);
/** Monotonic cleanup effects recorded separately from landing and authority. */
export const RetirementEffectsSchema = AcceptLandingStateSchema.pick({
  worktree_removed: true,
  branch_deleted: true,
});
export type RetirementEffects = z.infer<typeof RetirementEffectsSchema>;

export type AcceptLandingState = z.infer<typeof AcceptLandingStateSchema>;

/** Canonical field names derived from {@link ACCEPT_LANDING_STATE_SHAPE}. */
export const ACCEPT_LANDING_STATE_FIELDS: readonly string[] = Object.freeze(
  Object.keys(ACCEPT_LANDING_STATE_SHAPE),
);
