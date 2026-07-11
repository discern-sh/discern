/**
 * The desk's pure model: bucket the worktree fleet into decision order and map
 * each row's state to the actions that are legal for it (ADR 0119).
 *
 * The desk owns NO state of its own — every field here comes from the `status`
 * fleet survey plus the gate-receipt check, and every mutation it offers is one
 * of the existing lifecycle verbs. This module is the desk's only decision
 * logic, kept pure (time is a parameter) so `tests/engine_desk_model_test.ts`
 * can pin the whole classification table.
 */

import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import {
  idleDaysOf,
  relativeAge,
  STALE_WORKTREE_DAYS,
} from "../status/status.ts";

/** The decision-order buckets, most actionable first. */
export const DESK_BUCKETS = ["ready", "in_flight", "attention"] as const;
export type DeskBucket = (typeof DESK_BUCKETS)[number];

/** Every action the desk can offer on a row, in menu order. */
export const DESK_ACTIONS = [
  "accept",
  "integrate",
  "jump",
  "inspect",
  "drop",
] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

/** One selectable effort on the desk: a non-main fleet entry, classified. */
export interface DeskRow {
  readonly entry: StatusFleetEntry;
  /** Whether the row's clean HEAD holds a recorded gate pass. */
  readonly receiptHonored: boolean;
  readonly bucket: DeskBucket;
  /** The actions legal for this row's state, in menu order. */
  readonly actions: readonly DeskAction[];
  /** The plain-text state summary shown beside the branch name. */
  readonly summary: string;
}

/** The bucket headings as the desk renders them. */
export function bucketTitle(bucket: DeskBucket): string {
  switch (bucket) {
    case "ready":
      return "Ready to land";
    case "in_flight":
      return "In flight";
    case "attention":
      return "Needs attention";
  }
}

/** An unreadable or half-created checkout — state unknown, drop is the only move. */
function isUnhealthy(entry: StatusFleetEntry): boolean {
  return entry.broken === true || entry.git_unavailable === true;
}

/** Idle past the staleness threshold while still carrying work — the same
 * predicate `status` uses for its stale-worktree hint. */
function isStale(entry: StatusFleetEntry, nowMs: number): boolean {
  const idleDays = idleDaysOf(entry.last_activity, nowMs);
  return idleDays !== undefined && idleDays >= STALE_WORKTREE_DAYS &&
    (entry.clean === false || (entry.ahead ?? 0) > 0);
}

/** Classify one fleet entry into its decision-order bucket. */
export function classifyBucket(
  entry: StatusFleetEntry,
  receiptHonored: boolean,
  nowMs: number,
): DeskBucket {
  if (isUnhealthy(entry)) {
    return "attention";
  }
  if (entry.clean === true && (entry.ahead ?? 0) > 0 && receiptHonored) {
    return "ready";
  }
  if (isStale(entry, nowMs)) {
    return "attention";
  }
  return "in_flight";
}

/**
 * The actions legal for a row's state, in menu order. Advisory, not
 * authoritative: the desk offers only what can plausibly succeed, but every
 * action still runs the real verb core, whose own preconditions keep the final
 * word (a refusal renders; it is never bypassed). Accept is offered without
 * requiring a receipt — acceptance validates the tree at the landing boundary
 * itself, so a receiptless clean branch simply pays for a full gate run there.
 */
export function legalActions(entry: StatusFleetEntry): readonly DeskAction[] {
  if (isUnhealthy(entry)) {
    // The checkout can't be trusted (or entered): discarding is the only move
    // the desk can honestly offer. `worktree drop` still refuses unverifiable
    // work without an explicit typed confirmation.
    return ["drop"];
  }
  const actions: DeskAction[] = [];
  if (entry.clean === true && (entry.ahead ?? 0) > 0) {
    actions.push("accept");
  }
  if ((entry.behind ?? 0) > 0) {
    actions.push("integrate");
  }
  actions.push("jump", "inspect", "drop");
  return actions;
}

/** The plain-text state summary rendered beside a row's branch name. */
export function rowSummary(
  entry: StatusFleetEntry,
  receiptHonored: boolean,
  nowMs: number,
): string {
  if (entry.broken === true) {
    return "broken — setup never completed";
  }
  if (entry.git_unavailable === true) {
    return "state unreadable — git could not run here";
  }
  const parts: string[] = [];
  if (receiptHonored) {
    parts.push("gate green");
  }
  parts.push(
    entry.clean === true
      ? "clean"
      : `dirty (${entry.changed_files ?? "?"} file${
        entry.changed_files === 1 ? "" : "s"
      })`,
  );
  if ((entry.ahead ?? 0) > 0) {
    parts.push(`${entry.ahead} ahead`);
  }
  if ((entry.behind ?? 0) > 0) {
    parts.push(`${entry.behind} behind`);
  }
  parts.push(relativeAge(entry.last_activity, nowMs));
  return parts.join(" · ");
}

/** Most-recent-first by last activity; unknown activity sinks. */
function byActivityDesc(a: StatusFleetEntry, b: StatusFleetEntry): number {
  const at = a.last_activity === undefined ? 0 : Date.parse(a.last_activity);
  const bt = b.last_activity === undefined ? 0 : Date.parse(b.last_activity);
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

/**
 * Build the desk's rows from a fleet survey: the main checkout's own row is
 * excluded (the desk runs there — it is the vantage point, not an effort), and
 * the rest are classified and sorted into decision order — ready first, then in
 * flight, needs-attention last; within a bucket, most recently active first.
 */
export function buildDeskRows(
  fleet: readonly StatusFleetEntry[],
  receiptHonoredByPath: ReadonlyMap<string, boolean>,
  nowMs: number,
): DeskRow[] {
  const rows = fleet
    .filter((entry) => !entry.is_main)
    .map((entry): DeskRow => {
      const receiptHonored = receiptHonoredByPath.get(entry.path) ?? false;
      return {
        entry,
        receiptHonored,
        bucket: classifyBucket(entry, receiptHonored, nowMs),
        actions: legalActions(entry),
        summary: rowSummary(entry, receiptHonored, nowMs),
      };
    });
  return rows.sort((a, b) =>
    a.bucket === b.bucket
      ? byActivityDesc(a.entry, b.entry)
      : DESK_BUCKETS.indexOf(a.bucket) - DESK_BUCKETS.indexOf(b.bucket)
  );
}
