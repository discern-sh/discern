/**
 * The `--stats` reader — practice stats, computed from the logbook. Where the
 * detector registry (`detectors.ts`) looks for what needs attention, this
 * module counts what went well: accepted changes and their scale, green-gate
 * streaks, completed cycles, the standards ratchet and its measured trend,
 * the attributed agent cohorts, and how wide the practice ran.
 *
 * Rules of the surface:
 *
 *  - **Counts, never scores.** Every number is a plain count or duration read
 *    from recorded events, with its denominator beside it where one exists.
 *    Nothing here ranks, grades, or extrapolates.
 *  - **Local evidence only.** The logbook never leaves the machine, so there
 *    is no corpus to compare against and no percentile to claim. Sharing the
 *    card is the owner's move.
 *  - **Same population as the detectors.** The computation reads
 *    {@link StreamFacts}, so CI runs, `--dry-run` previews, and setup-era
 *    events are already set aside — the feats are the practice's, not the
 *    scaffolding's.
 *
 * Pure computation: `patterns.ts` owns the flag, the wire plumbing, and the
 * card rendering, mirroring how `detectors.ts` computes and `patterns.ts`
 * presents.
 */

import {
  PATTERNS_SERIES_MAX_POINTS,
  type PatternsStats,
  VALIDATION_WORKFLOW_ROUTES,
  type ValidationWorkflowRoute,
} from "../../shared/patterns_vocabulary.ts";
import type { PinEvent, VerbEvent } from "./schema.ts";
import { byBranch } from "./read.ts";
import { checkpointEconomicsOf } from "./checkpoint_economics.ts";
import { comparative, driverKind, splitByCohort } from "./cohorts.ts";
import { validationEvidenceIsComparable } from "./validation_findings.ts";
import { EMPTY_TREE_DIFF_FINGERPRINT } from "../../shared/tree_identity.ts";
import {
  day,
  inclusiveSpanDays,
  longestStreak,
  median,
  round1,
  type StreamFacts,
} from "./detectors.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The verbs whose wall-clock time counts as "checks run": the full gate and
 * its two inner loops. */
const VALIDATION_WORKFLOW_VERBS = ["prepare", "test", "done"] as const;
type ValidationWorkflowVerb = (typeof VALIDATION_WORKFLOW_VERBS)[number];
const CHECK_VERBS = new Set<string>(VALIDATION_WORKFLOW_VERBS);

/** Epoch day number of a "YYYY-MM-DD" string, for consecutive-day arithmetic. */
function epochDay(dayString: string): number {
  return Math.floor(Date.parse(`${dayString}T00:00:00Z`) / DAY_MS);
}

/** The cadence series' geometry: the span's first calendar day, its inclusive
 * day count, and how many whole days each wire point folds together to honor
 * the cap. Undefined until the span holds 2 days — a one-day cadence is just
 * the count already on the card. */
interface SeriesSpan {
  firstDay: number;
  spanDays: number;
  daysPerPoint: number;
}

/** Derive the inclusive date span and folding width for a bounded cadence series. */
function seriesSpan(verbs: readonly VerbEvent[]): SeriesSpan | undefined {
  const first = verbs[0];
  const last = verbs[verbs.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const spanDays = inclusiveSpanDays(first.at, last.at);
  if (spanDays === undefined || spanDays < 2) {
    return undefined;
  }
  return {
    firstDay: epochDay(day(first.at)),
    spanDays,
    daysPerPoint: Math.ceil(spanDays / PATTERNS_SERIES_MAX_POINTS),
  };
}

/** Events per calendar day across the span, zero-filled. */
function dailyTotals(
  events: readonly { at: string }[],
  span: SeriesSpan,
): number[] {
  const daily = new Array<number>(span.spanDays).fill(0);
  for (const e of events) {
    const index = epochDay(day(e.at)) - span.firstDay;
    if (index >= 0 && index < daily.length) {
      daily[index] = (daily[index] ?? 0) + 1;
    }
  }
  return daily;
}

/** Distinct branches active per calendar day across the span, zero-filled. */
function dailyBranchCounts(
  verbs: readonly VerbEvent[],
  span: SeriesSpan,
): number[] {
  const sets = Array.from({ length: span.spanDays }, () => new Set<string>());
  for (const e of verbs) {
    if (e.branch === null) {
      continue;
    }
    sets[epochDay(day(e.at)) - span.firstDay]?.add(e.branch);
  }
  return sets.map((branches) => branches.size);
}

/** Fold the daily values into runs of `daysPerPoint` whole days (the last
 * run may cover fewer). `fold` combines a run: sums for event counts, max
 * for the peak-parallelism reading. Zero is both folds' identity over
 * counts, so an empty tail run stays an honest zero. */
function foldDaily(
  daily: readonly number[],
  daysPerPoint: number,
  fold: (a: number, b: number) => number,
): number[] {
  if (daysPerPoint <= 1) {
    return [...daily];
  }
  const points: number[] = [];
  for (let start = 0; start < daily.length; start += daysPerPoint) {
    points.push(
      // Binary application only: reduce's extra callback arguments must
      // never reach a variadic fold like Math.max.
      daily.slice(start, start + daysPerPoint).reduce((a, b) => fold(a, b), 0),
    );
  }
  return points;
}

/** Longest run of consecutive UTC days in a set of "YYYY-MM-DD" strings. */
function longestDailyStreak(days: ReadonlySet<string>): number {
  const ordered = [...days].map(epochDay).filter(Number.isFinite).sort(
    (a, b) => a - b,
  );
  let best = ordered.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < ordered.length; i += 1) {
    run = ordered[i] === (ordered[i - 1] ?? Number.NaN) + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** The day with the most events (earliest day on a tie), with its count. */
function peakDay(
  events: readonly { at: string }[],
): { day: string; count: number } | undefined {
  const counts = new Map<string, number>();
  for (const e of events) {
    const d = day(e.at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let peak: { day: string; count: number } | undefined;
  for (const [d, count] of [...counts.entries()].sort()) {
    if (peak === undefined || count > peak.count) {
      peak = { day: d, count };
    }
  }
  return peak;
}

/** Accepted changes and their recorded scale ({@link PatternsStats},
 * `accepted`). */
function acceptedFeats(accepted: VerbEvent[]): PatternsStats["accepted"] {
  const sums = { insertions: 0, deletions: 0, files: 0, commits: 0 };
  let cleanups = 0;
  let biggest: NonNullable<PatternsStats["accepted"]["biggest"]> | undefined;
  for (const e of accepted) {
    if (e.change === undefined) {
      continue;
    }
    sums.insertions += e.change.insertions;
    sums.deletions += e.change.deletions;
    sums.files += e.change.files;
    sums.commits += e.change.commits;
    if (e.change.deletions > e.change.insertions) {
      cleanups += 1;
    }
    const lines = e.change.insertions + e.change.deletions;
    if (biggest === undefined || lines > biggest.lines) {
      biggest = {
        ...(e.branch !== null ? { branch: e.branch } : {}),
        lines,
        files: e.change.files,
        day: day(e.at),
      };
    }
  }
  const best = peakDay(accepted);
  return {
    count: accepted.length,
    branches: byBranch(accepted).size,
    ...sums,
    cleanups,
    ...(biggest !== undefined ? { biggest } : {}),
    ...(best !== undefined
      ? { best_day: { day: best.day, accepted: best.count } }
      : {}),
    longest_streak: longestDailyStreak(
      new Set(accepted.map((e) => day(e.at))),
    ),
  };
}

/** Gate runs, streaks, and check time ({@link PatternsStats}, `gate`). */
function gateFeats(facts: StreamFacts): PatternsStats["gate"] {
  const dones = facts.verbs.filter((e) => e.verb === "done");
  const green = (e: VerbEvent): boolean => e.outcome === "ok";
  let current = 0;
  for (let i = dones.length - 1; i >= 0; i -= 1) {
    const e = dones[i];
    if (e === undefined || !green(e)) {
      break;
    }
    current += 1;
  }
  let firstTry = 0;
  const gated = byBranch(dones);
  for (const runs of gated.values()) {
    if (runs[0]?.outcome === "ok") {
      firstTry += 1;
    }
  }
  // Check-hours answers how much time the agents experienced across their
  // checking loops, so slot waits remain part of this end-to-end wall total.
  const checkMs = facts.verbs
    .filter((e) => CHECK_VERBS.has(e.verb))
    .reduce((sum, e) => sum + e.duration_ms, 0);
  return {
    runs: dones.length,
    greens: dones.filter(green).length,
    first_try_green_branches: firstTry,
    gated_branches: gated.size,
    longest_green_streak: longestStreak(dones, green),
    current_green_streak: current,
    check_hours: round1(checkMs / HOUR_MS),
  };
}

/** One stream-defined change cycle on one branch and one recorded config
 * epoch. Its events are validation-workflow runs only. */
interface ValidationWorkflowCycle {
  branch: string;
  epoch: string;
  events: VerbEvent[];
}

/** Whether one event is part of the validation-workflow population. */
function isValidationWorkflowEvent(
  event: VerbEvent,
): event is VerbEvent & { verb: ValidationWorkflowVerb } {
  return (VALIDATION_WORKFLOW_VERBS as readonly string[]).includes(event.verb);
}

/** Whether one event is a clean successful full Gate. */
function isCleanGreenGate(event: VerbEvent): boolean {
  return event.verb === "done" && event.clean === true &&
    event.outcome === "ok";
}

/** Finish one active branch cycle if it contains validation runs. */
function finishWorkflowCycle(
  branch: string,
  active: Map<string, ValidationWorkflowCycle>,
  completed: ValidationWorkflowCycle[],
): void {
  const cycle = active.get(branch);
  if (cycle !== undefined && cycle.events.length > 0) {
    completed.push(cycle);
  }
  active.delete(branch);
}

/** Build conservative change cycles entirely from recorded stream evidence.
 * A successful `start` for a reused branch, a successful `accept`, or a config epoch
 * change closes the prior cycle. After a clean green Gate, a later dirty run
 * or another recorded HEAD begins a new cycle. The dirty-to-committed HEAD
 * transition before that green Gate remains inside its cycle. */
function validationWorkflowCycles(
  facts: StreamFacts,
): ValidationWorkflowCycle[] {
  const active = new Map<string, ValidationWorkflowCycle>();
  const completed: ValidationWorkflowCycle[] = [];
  for (const event of facts.verbs) {
    if (
      event.verb === "start" && event.outcome === "ok" &&
      event.target !== undefined
    ) {
      finishWorkflowCycle(event.target, active, completed);
    }
    if (
      event.verb === "accept" && event.outcome === "ok" &&
      event.branch !== null
    ) {
      finishWorkflowCycle(event.branch, active, completed);
    }
    if (!isValidationWorkflowEvent(event) || event.branch === null) {
      continue;
    }
    const epoch = event.epoch;
    let cycle = active.get(event.branch);
    const priorGreen = cycle?.events.findLast(isCleanGreenGate);
    const startsAnotherChange = priorGreen !== undefined &&
      (event.clean === false ||
        (priorGreen.head !== null && event.head !== null &&
          priorGreen.head !== event.head));
    if (
      cycle !== undefined &&
      (epoch === null || cycle.epoch !== epoch || startsAnotherChange)
    ) {
      finishWorkflowCycle(event.branch, active, completed);
      cycle = undefined;
    }
    if (cycle === undefined) {
      // A missing epoch cannot support a relationship with another run. Its
      // placeholder is unique to this cycle because the next null event closes it.
      cycle = {
        branch: event.branch,
        epoch: epoch ?? `unattributed:${event.at}`,
        events: [],
      };
      active.set(event.branch, cycle);
    }
    cycle.events.push(event);
  }
  for (const branch of [...active.keys()]) {
    finishWorkflowCycle(branch, active, completed);
  }
  return completed;
}

/** The first recorded entry state decides a cycle's route. Dirty entry is
 * test-first; clean entry is commit-first; missing state stays unattributed.
 * A later state cannot reconstruct an entry state the stream did not record. */
function validationWorkflowRoute(
  cycle: ValidationWorkflowCycle,
): ValidationWorkflowRoute {
  const first = cycle.events[0];
  return first?.clean === false
    ? "test-first"
    : first?.clean === true
    ? "commit-first"
    : "unattributed";
}

/** Whether a test-first cycle records dirty validation, a later HEAD, and a
 * clean green Gate on that later HEAD. */
function isPrecommitToCleanGate(cycle: ValidationWorkflowCycle): boolean {
  if (validationWorkflowRoute(cycle) !== "test-first") {
    return false;
  }
  const greenIndex = cycle.events.findIndex(isCleanGreenGate);
  const green = cycle.events[greenIndex];
  if (greenIndex < 1 || green === undefined || green.head === null) {
    return false;
  }
  return cycle.events.slice(0, greenIndex).some((event) =>
    event.clean === false && event.head !== null && event.head !== green.head
  );
}

/** Classify how much current workflow evidence one run carries. Validation
 * evidence must clear the complete comparison boundary. `prepare` has no
 * versioned validation capture and remains unattributed here. */
function validationWorkflowEvidence(
  event: VerbEvent,
): "complete" | "incomplete" | "unattributed" {
  if (event.validation !== undefined) {
    return validationEvidenceIsComparable(event.validation)
      ? "complete"
      : "incomplete";
  }
  return "unattributed";
}

/** Classify a complete current dirty standalone-test state without exposing
 * paths. That capture shares the invocation-start boundary; a full Gate's
 * post-pre-group capture does not and remains unclassified. The validation
 * counts identify worktree and untracked changes, while the legacy tracked-
 * diff fingerprint closes the staged-only gap when it was readable. */
function validationDirtyState(
  event: VerbEvent,
): "tracked_only" | "untracked_only" | "mixed" | "unclassified" {
  const state = event.validation?.state;
  if (
    state === undefined || validationWorkflowEvidence(event) !== "complete" ||
    event.clean !== false ||
    event.validation?.execution.mode !== "standalone-test"
  ) {
    return "unclassified";
  }
  const trackedAtBoundary = state.counts.tracked_paths > 0;
  const trackedAtStart = event.tree !== undefined &&
    event.tree !== EMPTY_TREE_DIFF_FINGERPRINT;
  const noTrackedAtStart = event.tree === EMPTY_TREE_DIFF_FINGERPRINT;
  const tracked = trackedAtBoundary || trackedAtStart;
  const untracked = state.counts.untracked_paths > 0;
  if (tracked && untracked) return "mixed";
  if (tracked && !untracked) return "tracked_only";
  if (!tracked && untracked && noTrackedAtStart) return "untracked_only";
  return "unclassified";
}

/** Route-level counts, including cycle and run denominators. */
function validationRouteCounts(
  route: ValidationWorkflowRoute,
  cycles: readonly ValidationWorkflowCycle[],
): PatternsStats["validation_workflows"]["cycles"]["routes"][number] {
  const selected = cycles.filter((cycle) =>
    validationWorkflowRoute(cycle) === route
  );
  return {
    route,
    cycles: selected.length,
    branches: new Set(selected.map((cycle) => cycle.branch)).size,
    runs: selected.reduce((sum, cycle) => sum + cycle.events.length, 0),
    successful_cycles:
      selected.filter((cycle) => cycle.events.some(isCleanGreenGate)).length,
    successful_runs: selected.reduce(
      (sum, cycle) =>
        sum + cycle.events.filter((event) => event.outcome === "ok").length,
      0,
    ),
    failed_cycles:
      selected.filter((cycle) =>
        cycle.events.some((event) => event.outcome === "failed")
      ).length,
    failed_runs: selected.reduce(
      (sum, cycle) =>
        sum + cycle.events.filter((event) => event.outcome === "failed").length,
      0,
    ),
    retried_cycles: selected.filter((cycle) => cycle.events.length > 1).length,
    retry_runs: selected.reduce(
      (sum, cycle) => sum + Math.max(0, cycle.events.length - 1),
      0,
    ),
  };
}

/** Workflow cohort split through the shared identity seam and minimums. */
function validationWorkflowCohorts(
  cycles: readonly ValidationWorkflowCycle[],
): PatternsStats["validation_workflows"]["cohorts"] {
  const split = splitByCohort(cycles, (cycle) => cycle.events);
  if (!comparative(split)) {
    return undefined;
  }
  const below = split.belowMinimum;
  return {
    denominator_cycles: cycles.length,
    denominator_runs: cycles.reduce(
      (sum, cycle) => sum + cycle.events.length,
      0,
    ),
    identities: split.speaking.map((cohort) => ({
      agent: cohort.agent,
      label: cohort.label,
      cycles: cohort.units.length,
      runs: cohort.runs,
      test_first_cycles:
        cohort.units.filter((cycle) =>
          validationWorkflowRoute(cycle) === "test-first"
        ).length,
      commit_first_cycles:
        cohort.units.filter((cycle) =>
          validationWorkflowRoute(cycle) === "commit-first"
        ).length,
      successful_cycles:
        cohort.units.filter((cycle) => cycle.events.some(isCleanGreenGate))
          .length,
      failed_cycles:
        cohort.units.filter((cycle) =>
          cycle.events.some((event) => event.outcome === "failed")
        ).length,
      retried_cycles:
        cohort.units.filter((cycle) => cycle.events.length > 1).length,
    })).sort((left, right) => left.agent.localeCompare(right.agent)),
    below_minimum: {
      cohorts: below.length,
      cycles: below.reduce((sum, cohort) => sum + cohort.units.length, 0),
      runs: below.reduce((sum, cohort) => sum + cohort.runs, 0),
    },
    unattributed: {
      cycles: split.unattributedUnits,
      runs: split.unattributedRuns,
    },
  };
}

/** Validation workflow counts over runs, cycles, and eligible cohorts. */
function validationWorkflowFeats(
  facts: StreamFacts,
): PatternsStats["validation_workflows"] {
  const runs = facts.verbs.filter(isValidationWorkflowEvent);
  const cycles = validationWorkflowCycles(facts);
  const retryEvents = new Set(
    cycles.flatMap((cycle) => cycle.events.slice(1)),
  );
  const evidence = {
    denominator: runs.length,
    complete: 0,
    incomplete: 0,
    unattributed: 0,
  };
  const dirtyState = {
    denominator: 0,
    tracked_only: 0,
    untracked_only: 0,
    mixed: 0,
    unclassified: 0,
  };
  for (const event of runs) {
    evidence[validationWorkflowEvidence(event)] += 1;
    if (
      event.clean === false &&
      validationWorkflowEvidence(event) === "complete"
    ) {
      dirtyState.denominator += 1;
      dirtyState[validationDirtyState(event)] += 1;
    }
  }
  const precommit = cycles.filter(isPrecommitToCleanGate);
  const cohorts = validationWorkflowCohorts(cycles);
  return {
    runs: {
      total: runs.length,
      branches: byBranch(runs).size,
      by_verb: VALIDATION_WORKFLOW_VERBS.map((verb) => {
        const selected = runs.filter((event) => event.verb === verb);
        return {
          verb,
          runs: selected.length,
          branches: byBranch(selected).size,
          clean: selected.filter((event) => event.clean === true).length,
          dirty: selected.filter((event) => event.clean === false).length,
          unknown: selected.filter((event) => event.clean === null).length,
          successes: selected.filter((event) => event.outcome === "ok").length,
          failures: selected.filter((event) => event.outcome === "failed")
            .length,
          retries: selected.filter((event) => retryEvents.has(event)).length,
        };
      }),
      evidence,
      dirty_state: dirtyState,
    },
    cycles: {
      total: cycles.length,
      branches: new Set(cycles.map((cycle) => cycle.branch)).size,
      routes: VALIDATION_WORKFLOW_ROUTES.map((route) =>
        validationRouteCounts(route, cycles)
      ),
      precommit_to_clean_gate: {
        cycles: precommit.length,
        branches: new Set(precommit.map((cycle) => cycle.branch)).size,
        runs: precommit.reduce((sum, cycle) => sum + cycle.events.length, 0),
        retry_runs: precommit.reduce(
          (sum, cycle) => sum + Math.max(0, cycle.events.length - 1),
          0,
        ),
      },
    },
    ...(cohorts !== undefined ? { cohorts } : {}),
  };
}

/** Completed start-to-accept cycles, matched exactly the way the funnel
 * detector matches them: an `ok` start's created branch to the first later
 * `ok` accept on it ({@link PatternsStats}, `cycles`). */
function cycleFeats(
  facts: StreamFacts,
  accepted: VerbEvent[],
): PatternsStats["cycles"] {
  const starts = facts.verbs.filter((e) =>
    e.verb === "start" && e.outcome === "ok" && e.target !== undefined
  );
  const cycles: number[] = [];
  for (const start of starts) {
    const accept = accepted.find((a) =>
      a.branch === start.target && a.at > start.at
    );
    if (accept !== undefined) {
      cycles.push((Date.parse(accept.at) - Date.parse(start.at)) / HOUR_MS);
    }
  }
  return cycles.length > 0
    ? {
      started: starts.length,
      completed: cycles.length,
      under_day: cycles.filter((hours) => hours < 24).length,
      median_hours: round1(median(cycles)),
      fastest_hours: round1(Math.min(...cycles)),
    }
    : undefined;
}

/** One standard's recorded readings in stream order, with the direction that
 * orients "better". Standards recorded without a direction can't be oriented
 * and are set aside. */
interface StandardTrack {
  name: string;
  direction: "up" | "down";
  readings: { at: string; value: number }[];
}

/** Collect oriented standard readings by name in event-stream order. */
function standardTracks(facts: StreamFacts): StandardTrack[] {
  const byName = new Map<
    string,
    { direction?: "up" | "down"; readings: { at: string; value: number }[] }
  >();
  for (const e of facts.verbs) {
    for (const s of e.standards ?? []) {
      if (s.value === undefined) {
        continue;
      }
      const track = byName.get(s.name) ?? { readings: [] };
      if (s.direction === "up" || s.direction === "down") {
        track.direction = s.direction;
      }
      track.readings.push({ at: e.at, value: s.value });
      byName.set(s.name, track);
    }
  }
  return [...byName.entries()]
    .flatMap(([name, t]) =>
      t.direction !== undefined
        ? [{ name, direction: t.direction, readings: t.readings }]
        : []
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Percent improvement of one reading against the standard's first recorded
 * value, direction-adjusted so better is always positive — the normalization
 * that makes standards on different scales comparable. */
function improvementPercent(
  direction: "up" | "down",
  first: number,
  value: number,
): number {
  const delta = direction === "down" ? first - value : value - first;
  return (delta / Math.abs(first)) * 100;
}

/** A track qualifies for trend arithmetic once it holds two readings and a
 * non-zero first value (percent-of-first needs a denominator). */
function trendEligible(track: StandardTrack): boolean {
  return track.readings.length >= 2 && (track.readings[0]?.value ?? 0) !== 0;
}

/** The average improvement across all eligible standards per series point
 * ({@link PatternsStats}, `ratchet.trend`). Each standard contributes its
 * day's last reading, carried forward through unmeasured days; before its
 * first reading it contributes nothing. Days before any reading average to
 * zero — no measured improvement yet, honestly stated. */
function ratchetTrend(
  tracks: readonly StandardTrack[],
  span: SeriesSpan | undefined,
): number[] | undefined {
  if (span === undefined) {
    return undefined;
  }
  const eligible = tracks.filter(trendEligible);
  if (eligible.length === 0) {
    return undefined;
  }
  const perStandard = eligible.map((t) => {
    const first = t.readings[0];
    const byDay = new Array<number | undefined>(span.spanDays).fill(undefined);
    for (const r of t.readings) {
      const index = epochDay(day(r.at)) - span.firstDay;
      if (index >= 0 && index < byDay.length) {
        byDay[index] = r.value;
      }
    }
    let carried: number | undefined;
    return byDay.map((value) => {
      if (value !== undefined) {
        carried = value;
      }
      return carried === undefined || first === undefined
        ? undefined
        : improvementPercent(t.direction, first.value, carried);
    });
  });
  const dailyAverage = Array.from({ length: span.spanDays }, (_, index) => {
    const present = perStandard
      .map((series) => series[index])
      .filter((value): value is number => value !== undefined);
    return present.length === 0
      ? 0
      : present.reduce((a, b) => a + b, 0) / present.length;
  });
  const points: number[] = [];
  for (
    let start = 0;
    start < dailyAverage.length;
    start += span.daysPerPoint
  ) {
    const chunk = dailyAverage.slice(start, start + span.daysPerPoint);
    points.push(round1(chunk.reduce((a, b) => a + b, 0) / chunk.length));
  }
  return points;
}

/** The standard whose last reading improved the most against its first,
 * percent-normalized ({@link PatternsStats}, `ratchet.most_improved`).
 * Absent when nothing improved. */
function mostImproved(
  tracks: readonly StandardTrack[],
): PatternsStats["ratchet"]["most_improved"] {
  let best:
    | { standard: string; from: number; to: number; raw: number }
    | undefined;
  for (const t of tracks.filter(trendEligible)) {
    const first = t.readings[0];
    const last = t.readings[t.readings.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }
    const raw = improvementPercent(t.direction, first.value, last.value);
    if (raw > 0 && (best === undefined || raw > best.raw)) {
      best = { standard: t.name, from: first.value, to: last.value, raw };
    }
  }
  return best === undefined ? undefined : {
    standard: best.standard,
    from: best.from,
    to: best.to,
    better_percent: round1(best.raw),
  };
}

/** The most change branches in flight at one instant ({@link PatternsStats},
 * `breadth.peak_in_flight`). A branch is in flight from its first analyzed
 * event to its last: a pause inside that window (an overnight break) stays
 * in flight, and after its last event the branch stops counting — so an
 * abandoned effort never inflates the peak. The trunk is not a change. */
function peakInFlight(
  facts: StreamFacts,
): PatternsStats["breadth"]["peak_in_flight"] {
  const windows = new Map<string, { from: string; to: string }>();
  for (const e of facts.verbs) {
    if (e.branch === null || e.branch === facts.trunk) {
      continue;
    }
    const window = windows.get(e.branch);
    if (window === undefined) {
      windows.set(e.branch, { from: e.at, to: e.at });
    } else {
      if (e.at < window.from) {
        window.from = e.at;
      }
      if (e.at > window.to) {
        window.to = e.at;
      }
    }
  }
  if (windows.size === 0) {
    return undefined;
  }
  const bounds: { at: string; delta: 1 | -1 }[] = [];
  for (const window of windows.values()) {
    bounds.push({ at: window.from, delta: 1 }, { at: window.to, delta: -1 });
  }
  // Opens sort before closes at the same instant: a branch closing exactly
  // when another opens still overlaps it for that instant.
  bounds.sort((a, b) => a.at.localeCompare(b.at) || b.delta - a.delta);
  let open = 0;
  let peak: NonNullable<PatternsStats["breadth"]["peak_in_flight"]> = {
    branches: 0,
    day: "",
  };
  for (const bound of bounds) {
    open += bound.delta;
    if (open > peak.branches) {
      peak = { branches: open, day: day(bound.at) };
    }
  }
  return peak;
}

/** Attributed agent identities and their runs ({@link PatternsStats},
 * `agents`), segmented through the cohort seam (`cohorts.ts`) so the same
 * honesty rules apply here as in every detector: identities below the
 * reporting minimums are counted but never listed, and the unattributed
 * share is always stated. */
function agentFeats(
  facts: StreamFacts,
  span: SeriesSpan | undefined,
  fold: (daily: number[]) => number[],
): PatternsStats["agents"] {
  const split = splitByCohort(facts.verbs, (e) => [e]);
  const identities = split.speaking.slice(0, 10).map((cohort) => {
    const dones = cohort.units.filter((e) => e.verb === "done");
    return {
      agent: cohort.agent,
      label: cohort.label,
      runs: cohort.runs,
      done_runs: dones.length,
      greens: dones.filter((e) => e.outcome === "ok").length,
      ...(span !== undefined
        ? { per_day: fold(dailyTotals(cohort.units, span)) }
        : {}),
    };
  });
  const agentDriven = facts.verbs.filter((e) => driverKind(e) === "agent");
  return {
    detected: split.speaking.length + split.belowMinimum.length,
    ...(span !== undefined
      ? { per_day: fold(dailyTotals(agentDriven, span)) }
      : {}),
    identities,
    ...(split.belowMinimum.length > 0
      ? {
        below_minimum: {
          agents: split.belowMinimum.length,
          runs: split.belowMinimum.reduce((sum, c) => sum + c.runs, 0),
        },
      }
      : {}),
    unattributed_runs: split.unattributedRuns,
  };
}

/** Branches driven, active days, and the busiest day
 * ({@link PatternsStats}, `breadth`). */
function breadthFeats(facts: StreamFacts): PatternsStats["breadth"] {
  const activeDays = new Set(facts.verbs.map((e) => day(e.at)));
  const branchesByDay = new Map<string, Set<string>>();
  for (const e of facts.verbs) {
    if (e.branch === null) {
      continue;
    }
    const d = day(e.at);
    const branches = branchesByDay.get(d);
    if (branches === undefined) {
      branchesByDay.set(d, new Set([e.branch]));
    } else {
      branches.add(e.branch);
    }
  }
  let busiest: { day: string; branches: number } | undefined;
  for (const [d, branches] of [...branchesByDay.entries()].sort()) {
    if (busiest === undefined || branches.size > busiest.branches) {
      busiest = { day: d, branches: branches.size };
    }
  }
  const first = facts.verbs[0];
  const last = facts.verbs[facts.verbs.length - 1];
  const span = first !== undefined && last !== undefined
    ? inclusiveSpanDays(first.at, last.at) ?? 0
    : 0;
  return {
    branches: byBranch(facts.verbs).size,
    active_days: activeDays.size,
    span_days: span,
    ...(first !== undefined ? { first_day: day(first.at) } : {}),
    ...(last !== undefined ? { last_day: day(last.at) } : {}),
    ...(busiest !== undefined ? { busiest_day: busiest } : {}),
  };
}

/** Compute practice stats from the pre-digested stream. Pure, and total over
 * any stream: an empty logbook produces a card of zeros, not an error. */
export function computeStats(facts: StreamFacts): PatternsStats {
  const accepted = facts.verbs.filter((e) =>
    e.verb === "accept" && e.outcome === "ok"
  );
  const pins = facts.events.filter((e): e is PinEvent => e.kind === "pin");
  const cycles = cycleFeats(facts, accepted);
  const span = seriesSpan(facts.verbs);
  const sum = (a: number, b: number): number => a + b;
  const fold = (daily: number[]): number[] =>
    foldDaily(daily, span?.daysPerPoint ?? 1, sum);
  const greens = facts.verbs.filter((e) =>
    e.verb === "done" && e.outcome === "ok"
  );
  const tracks = standardTracks(facts);
  const trend = ratchetTrend(tracks, span);
  const improved = mostImproved(tracks);
  const peak = peakInFlight(facts);
  const checkpoints = checkpointEconomicsOf(facts);
  return {
    ...(span !== undefined ? { series_days_per_point: span.daysPerPoint } : {}),
    accepted: {
      ...acceptedFeats(accepted),
      ...(span !== undefined
        ? { per_day: fold(dailyTotals(accepted, span)) }
        : {}),
    },
    gate: {
      ...gateFeats(facts),
      ...(span !== undefined
        ? { greens_per_day: fold(dailyTotals(greens, span)) }
        : {}),
    },
    validation_workflows: validationWorkflowFeats(facts),
    ...(cycles !== undefined ? { cycles } : {}),
    ratchet: {
      pins: pins.length,
      standards: new Set(pins.map((p) => p.standard)).size,
      ...(trend !== undefined ? { trend } : {}),
      ...(improved !== undefined ? { most_improved: improved } : {}),
    },
    agents: agentFeats(facts, span, fold),
    ...(checkpoints !== undefined ? { checkpoints } : {}),
    breadth: {
      ...breadthFeats(facts),
      ...(span !== undefined
        ? {
          branches_per_day: foldDaily(
            dailyBranchCounts(facts.verbs, span),
            span.daysPerPoint,
            Math.max,
          ),
        }
        : {}),
      ...(peak !== undefined ? { peak_in_flight: peak } : {}),
    },
  };
}
