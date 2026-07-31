/**
 * The desk's tip machinery, pure (ADR 0234): the predicate evaluator, the
 * seen-state shape, and the deterministic selection engine. The desk stays a
 * renderer — it calls these and prints; state I/O lives in `tip_state.ts`.
 *
 * Determinism is the contract: no randomness anywhere, and identical inputs
 * pick the identical tip. `tests/engine_desk_tips_test.ts` pins the whole
 * selection order.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import {
  type RegisteredTip,
  renderTipCli,
  type TipPredicate,
} from "../../shared/tips.ts";

/**
 * What a predicate may read: the status survey the desk already ran plus the
 * loaded config. Nothing here performs I/O — the desk holds both before it
 * first renders, so relevance evaluation is free.
 */
export interface TipContext {
  readonly data: StatusData;
  readonly config: DiscernConfig;
}

/** The non-main fleet rows — the efforts every fleet-shaped predicate reads. */
function efforts(ctx: TipContext): StatusFleetEntry[] {
  return (ctx.data.fleet ?? []).filter((entry) => !entry.is_main);
}

/**
 * Evaluate one relevance predicate. The `switch` is exhaustive with no
 * default: adding a {@link TipPredicate} kind fails the compile here until
 * the new kind is handled — the closed-set discipline.
 */
export function tipPredicateHolds(
  predicate: TipPredicate,
  ctx: TipContext,
): boolean {
  switch (predicate.kind) {
    case "standards-empty":
      return ctx.data.standards.length === 0;
    case "no-landing-authority":
      return efforts(ctx).length >= 2 &&
        efforts(ctx).every(
          (entry) => entry.landing_authority?.kind !== "authorized",
        );
    case "branch-behind-trunk":
      return efforts(ctx).some((entry) => (entry.behind ?? 0) > 0);
    case "fleet-min-size":
      return efforts(ctx).length >= predicate.min;
  }
}

// ── seen-state (the pure shape; `tip_state.ts` owns the file) ───────────────

/** How often and how recently one tip has been shown in this repository. */
export interface TipSeenEntry {
  readonly count: number;
  /** ISO 8601 UTC timestamp of the most recent showing. */
  readonly last_shown: string;
}

/** The per-repository seen-state: which tips have been shown, and the version
 * the state file was born at (the "New in" baseline). */
export interface TipSeenState {
  readonly schema_version: number;
  /**
   * The kit version current when this state file was first written. Entries
   * whose `since` post-dates it arrived by upgrade, so they render as new;
   * on a fresh install everything predates the baseline and nothing does.
   */
  readonly baseline_version: string;
  readonly tips: Readonly<Record<string, TipSeenEntry>>;
}

/** The seen-state format major this build writes and reads. */
export const TIP_STATE_SCHEMA_VERSION = 1;

/** The state a repository starts from: nothing seen, baselined at `version`. */
export function freshTipSeenState(version: string): TipSeenState {
  return {
    schema_version: TIP_STATE_SCHEMA_VERSION,
    baseline_version: version,
    tips: {},
  };
}

/** `state` with one showing of `id` recorded at `atIso`. */
export function markTipShown(
  state: TipSeenState,
  id: string,
  atIso: string,
): TipSeenState {
  const previous = state.tips[id];
  return {
    ...state,
    tips: {
      ...state.tips,
      [id]: { count: (previous?.count ?? 0) + 1, last_shown: atIso },
    },
  };
}

// ── selection ───────────────────────────────────────────────────────────────

/** The session's tip, with the release prefix when it applies. */
export interface SelectedTip {
  readonly tip: RegisteredTip;
  /** Present when the line renders with its "New in \<version\>:" prefix. */
  readonly newIn?: string;
}

/**
 * Compare two dotted-numeric versions; positive when `a` is newer. Missing or
 * non-numeric segments compare as zero, so a malformed tag orders low instead
 * of ever throwing at the desk. Exported so the registry's closed-set guard
 * holds `since` tags to the same semantics selection applies.
 */
export function compareTipVersions(a: string, b: string): number {
  const parse = (version: string): number[] =>
    version.split(".").map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Choose the session's tip. The total order over applicable tips (predicate
 * absent or holding), per the tips decision record:
 *
 *  1. unseen tips whose `since` post-dates the seen-state baseline, authored
 *     order — an upgrade surfaces what it brought;
 *  2. unseen tips whose predicate currently holds, authored order;
 *  3. unseen tips in authored order — the curriculum;
 *  4. the least-recently-shown applicable tip, ties in authored order.
 *
 * No tip repeats until the applicable pool exhausts, and an empty registry or
 * an all-filtered pool selects nothing.
 */
export function selectTip(
  tips: readonly RegisteredTip[],
  ctx: TipContext,
  state: TipSeenState,
): SelectedTip | undefined {
  const applicable = tips.filter(
    (tip) =>
      tip.predicate === undefined || tipPredicateHolds(tip.predicate, ctx),
  );
  const unseen = applicable.filter((tip) => state.tips[tip.id] === undefined);
  for (const tip of unseen) {
    if (
      tip.since !== undefined &&
      compareTipVersions(tip.since, state.baseline_version) > 0
    ) {
      return { tip, newIn: tip.since };
    }
  }
  const contextual = unseen.find((tip) => tip.predicate !== undefined);
  if (contextual !== undefined) {
    return { tip: contextual };
  }
  const first = unseen[0];
  if (first !== undefined) {
    return { tip: first };
  }
  let rotated: RegisteredTip | undefined;
  let rotatedShown = "";
  for (const tip of applicable) {
    const entry = state.tips[tip.id];
    if (entry === undefined) {
      continue;
    }
    if (rotated === undefined || entry.last_shown < rotatedShown) {
      rotated = tip;
      rotatedShown = entry.last_shown;
    }
  }
  return rotated === undefined ? undefined : { tip: rotated };
}

/** The selected tip's full line: the rendered text, release-prefixed when new. */
export function renderTipLine(selected: SelectedTip): string {
  const text = renderTipCli(selected.tip);
  return selected.newIn === undefined
    ? text
    : `New in ${selected.newIn}: ${text}`;
}
