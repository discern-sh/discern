/**
 * The identifiers of status's row-state vocabulary. Status owns every word,
 * glyph, and precedence rule for these states (`src/engine/status/row_states.ts`);
 * this leaf module holds only the ids, because structured results publish them
 * as open vocabularies and the result schemas must not import the engine.
 */

/** Every state a fleet row or retained branch can be in, one per decision. */
export const FLEET_ROW_STATE_IDS = [
  "broken",
  "unreadable",
  "setup-retry",
  "setup-manual",
  "setup-unknown",
  "landing",
  "exception",
  "interrupted",
  "checking",
  "updating",
  "running",
  "checks-failed",
  "land-failed",
  "failed",
  "awaiting-owner",
  "refused",
  "stale-proven",
  "stale",
  "editing",
  "queued",
  "approved",
  "ready",
  "behind",
  "proof-error",
  "proof-unknown",
  "recheck",
  "needs-checks",
  "contained",
  "empty",
  "idle-unknown",
  "parked",
  "landed",
] as const;

/** One row state ({@link FLEET_ROW_STATE_IDS}). */
export type FleetRowStateId = (typeof FLEET_ROW_STATE_IDS)[number];

/** Live tasks grouped by who moves next, in display order. */
export const FLEET_ROW_DECISIONS = [
  "review",
  "attention",
  "working",
  "approved",
  "idle",
] as const;

/** Branches without a checkout and recent landings, after the live groups. */
export const FLEET_BRANCH_GROUPS = ["parked", "landed"] as const;

/** One decision group ({@link FLEET_ROW_DECISIONS}). */
export type FleetRowDecision = (typeof FLEET_ROW_DECISIONS)[number];

/** One branch group ({@link FLEET_BRANCH_GROUPS}). */
export type FleetBranchGroup = (typeof FLEET_BRANCH_GROUPS)[number];

/** Every group, in display order. */
export const FLEET_ROW_GROUPS = [
  ...FLEET_ROW_DECISIONS,
  ...FLEET_BRANCH_GROUPS,
] as const;

/** One group a row state belongs to ({@link FLEET_ROW_GROUPS}). */
export type FleetRowGroup = (typeof FLEET_ROW_GROUPS)[number];
