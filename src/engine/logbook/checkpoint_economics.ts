/**
 * The **checkpoint economics reader** — one pure pass over the analyzed event
 * stream that tallies every checkpoint's observed lifecycle: servings (fired,
 * reopened, advise), declarations with their unchanged/revised split and
 * elapsed times, owner-authorized variances, and abandoned episodes.
 *
 * One reader, three consumers, so the numbers can never disagree: the
 * practice-stats card (`stats.ts`), the `checkpoints` verb's observed-history
 * section (`checkpoints/report.ts`), and the hygiene detectors
 * (`detectors.ts`). Everything here is an OBSERVATION about a checkpoint's
 * fit — local counts with their denominators, never a score, never a verdict
 * about an agent — and it reads recorded history only: nothing in this module
 * (or any logbook reader) can touch a verb's outcome.
 */

import {
  CHECKPOINT_ECONOMICS_ROWS_MAX,
  type CheckpointEconomics,
  type CheckpointEconomicsRow,
} from "../../shared/patterns_vocabulary.ts";
import { median, round1, type StreamFacts } from "./detectors.ts";
import type { VerbEvent } from "./schema.ts";

/** Everything observed about one checkpoint id across the analyzed stream. */
export interface CheckpointTally {
  id: string;
  /** Branches where the checkpoint was served at least once. */
  effortsFired: Set<string>;
  /** Servings: episode openings, reopenings, and advise deliveries. */
  fires: number;
  declared: number;
  declaredUnchanged: number;
  declaredRevised: number;
  declaredUnmet: number;
  reopened: number;
  /** Owner-authorized variances carried by completed landings. */
  variances: number;
  /** Branches whose landing carried a variance for this checkpoint. */
  varianceEfforts: Set<string>;
  abandoned: number;
  /** Elapsed serving-to-declaration times, where events recorded one. */
  declareElapsedMs: number[];
}

/** The stream's checkpoint observations, tallied once for every consumer. */
export interface CheckpointObservationsAnalysis {
  /** Distinct branches with at least one recorded gate run. */
  gateEfforts: Set<string>;
  /** Branches at least one successful `accept` landed. */
  landedEfforts: Set<string>;
  /** Per-checkpoint tallies, keyed by checkpoint id. */
  tallies: Map<string, CheckpointTally>;
}

/** A fresh, empty tally for one checkpoint id. */
function emptyTally(id: string): CheckpointTally {
  return {
    id,
    effortsFired: new Set(),
    fires: 0,
    declared: 0,
    declaredUnchanged: 0,
    declaredRevised: 0,
    declaredUnmet: 0,
    reopened: 0,
    variances: 0,
    varianceEfforts: new Set(),
    abandoned: 0,
    declareElapsedMs: [],
  };
}

/**
 * Tally every checkpoint observation in the analyzed population (CI runs and
 * previews already excluded). Events written before checkpoint observation
 * existed carry no block and simply contribute nothing — readers censor,
 * never break. A serving on an event whose branch is unknown still counts as
 * a serving but attributes to no effort.
 */
export function analyzeCheckpointObservations(
  facts: StreamFacts,
): CheckpointObservationsAnalysis {
  const gateEfforts = new Set<string>();
  const landedEfforts = new Set<string>();
  const tallies = new Map<string, CheckpointTally>();
  const tally = (id: string): CheckpointTally => {
    const existing = tallies.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = emptyTally(id);
    tallies.set(id, fresh);
    return fresh;
  };
  const effort = (event: VerbEvent): string | undefined =>
    event.branch ?? undefined;

  for (const event of facts.verbs) {
    const branch = effort(event);
    if (event.verb === "done" && branch !== undefined) {
      gateEfforts.add(branch);
    }
    if (event.verb === "accept" && event.outcome === "ok") {
      // Attribution survives the worktree's removal: accept events carry the
      // branch they landed.
      if (branch !== undefined) {
        landedEfforts.add(branch);
      }
    }
    const block = event.checkpoints;
    if (block === undefined) {
      continue;
    }
    for (const serving of block.fired ?? []) {
      const entry = tally(serving.id);
      entry.fires += 1;
      if (branch !== undefined) {
        entry.effortsFired.add(branch);
      }
    }
    for (const serving of block.reopened ?? []) {
      const entry = tally(serving.id);
      entry.fires += 1;
      entry.reopened += 1;
      if (branch !== undefined) {
        entry.effortsFired.add(branch);
      }
    }
    for (const serving of block.advise ?? []) {
      const entry = tally(serving.id);
      entry.fires += 1;
      if (branch !== undefined) {
        entry.effortsFired.add(branch);
      }
    }
    for (const declaration of block.declared ?? []) {
      const entry = tally(declaration.id);
      entry.declared += 1;
      if (declaration.revised === true) {
        entry.declaredRevised += 1;
      } else if (declaration.revised === false) {
        entry.declaredUnchanged += 1;
      }
      if (declaration.conclusion === "unmet") {
        entry.declaredUnmet += 1;
      }
      if (typeof declaration.elapsed_ms === "number") {
        entry.declareElapsedMs.push(declaration.elapsed_ms);
      }
    }
    for (const variance of block.variances ?? []) {
      const entry = tally(variance.id);
      entry.variances += 1;
      if (branch !== undefined) {
        entry.varianceEfforts.add(branch);
      }
    }
    for (const ended of block.abandoned ?? []) {
      tally(ended.id).abandoned += 1;
    }
  }
  return { gateEfforts, landedEfforts, tallies };
}

/** Project one tally onto its bounded wire row. */
function economicsRow(
  tally: CheckpointTally,
  landedEfforts: ReadonlySet<string>,
): CheckpointEconomicsRow {
  const effortsLanded =
    [...tally.effortsFired].filter((branch) => landedEfforts.has(branch))
      .length;
  return {
    id: tally.id,
    efforts_fired: tally.effortsFired.size,
    efforts_landed: effortsLanded,
    fires: tally.fires,
    declared: tally.declared,
    declared_unchanged: tally.declaredUnchanged,
    declared_unmet: tally.declaredUnmet,
    reopened: tally.reopened,
    variances: tally.variances,
    abandoned: tally.abandoned,
    ...(tally.declareElapsedMs.length === 0
      ? {}
      : { median_declare_s: round1(median(tally.declareElapsedMs) / 1000) }),
  };
}

/**
 * The bounded per-checkpoint economics, or undefined when the stream holds no
 * checkpoint activity at all. Rows carry the most-served checkpoints first
 * (id breaking ties); checkpoints beyond the bound stay counted in `omitted`.
 */
export function checkpointEconomicsOf(
  facts: StreamFacts,
): CheckpointEconomics | undefined {
  const analysis = analyzeCheckpointObservations(facts);
  if (analysis.tallies.size === 0) {
    return undefined;
  }
  const rows = [...analysis.tallies.values()]
    .sort((a, b) => b.fires - a.fires || a.id.localeCompare(b.id))
    .map((tally) => economicsRow(tally, analysis.landedEfforts));
  return {
    efforts: analysis.gateEfforts.size,
    rows: rows.slice(0, CHECKPOINT_ECONOMICS_ROWS_MAX),
    omitted: Math.max(0, rows.length - CHECKPOINT_ECONOMICS_ROWS_MAX),
  };
}

/**
 * The stream moment after which the current `[checkpoints]` configuration is
 * known to govern: the newest recorded config change naming that section, or
 * undefined when none was recorded. The dead/noisy hygiene detectors count
 * their effort denominators from here, so a freshly revised configuration
 * restarts its own evidence instead of answering for its predecessor's.
 */
export function checkpointConfigBoundary(
  facts: StreamFacts,
): string | undefined {
  let boundary: string | undefined;
  for (const event of facts.events) {
    if (
      event.kind === "config-change" && event.sections.includes("checkpoints")
    ) {
      boundary = event.at;
    }
  }
  return boundary;
}

/** Distinct gate-run efforts observed at or after the boundary (all of them
 * when no boundary exists) — the hygiene detectors' effort denominator. */
export function gateEffortsSince(
  facts: StreamFacts,
  boundary: string | undefined,
): Set<string> {
  const efforts = new Set<string>();
  for (const event of facts.verbs) {
    if (event.verb !== "done" || event.branch === null) {
      continue;
    }
    if (boundary !== undefined && event.at < boundary) {
      continue;
    }
    efforts.add(event.branch);
  }
  return efforts;
}
