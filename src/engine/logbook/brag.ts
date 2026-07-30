/**
 * The `--brag` reader — bragging rights, computed from the logbook. Where the
 * detector registry (`detectors.ts`) looks for what needs attention, this
 * module counts what went well: landings and their scale, green-gate streaks,
 * completed cycles, tightened limits, and how wide the practice ran.
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
  type PatternsBrag,
} from "../../shared/patterns_vocabulary.ts";
import type { PinEvent, VerbEvent } from "./schema.ts";
import { byBranch } from "./read.ts";
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
const CHECK_VERBS = new Set(["done", "prepare", "test"]);

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

/** Landings and their recorded scale ({@link PatternsBrag}, `landings`). */
function landingFeats(landings: VerbEvent[]): PatternsBrag["landings"] {
  const sums = { insertions: 0, deletions: 0, files: 0, commits: 0 };
  let biggest: NonNullable<PatternsBrag["landings"]["biggest"]> | undefined;
  for (const e of landings) {
    if (e.change === undefined) {
      continue;
    }
    sums.insertions += e.change.insertions;
    sums.deletions += e.change.deletions;
    sums.files += e.change.files;
    sums.commits += e.change.commits;
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
  const best = peakDay(landings);
  return {
    count: landings.length,
    branches: byBranch(landings).size,
    ...sums,
    ...(biggest !== undefined ? { biggest } : {}),
    ...(best !== undefined
      ? { best_day: { day: best.day, landings: best.count } }
      : {}),
    longest_daily_streak: longestDailyStreak(
      new Set(landings.map((e) => day(e.at))),
    ),
  };
}

/** Gate runs, streaks, and check time ({@link PatternsBrag}, `gate`). */
function gateFeats(facts: StreamFacts): PatternsBrag["gate"] {
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

/** Completed start-to-accept cycles, matched exactly the way the funnel
 * detector matches them: an `ok` start's created branch to the first later
 * `ok` accept on it ({@link PatternsBrag}, `cycles`). */
function cycleFeats(
  facts: StreamFacts,
  landings: VerbEvent[],
): PatternsBrag["cycles"] {
  const starts = facts.verbs.filter((e) =>
    e.verb === "start" && e.outcome === "ok" && e.target !== undefined
  );
  const cycles: number[] = [];
  for (const start of starts) {
    const accept = landings.find((a) =>
      a.branch === start.target && a.at > start.at
    );
    if (accept !== undefined) {
      cycles.push((Date.parse(accept.at) - Date.parse(start.at)) / HOUR_MS);
    }
  }
  return cycles.length > 0
    ? {
      completed: cycles.length,
      median_hours: round1(median(cycles)),
      fastest_hours: round1(Math.min(...cycles)),
    }
    : undefined;
}

/** Branches driven, active days, and the busiest day
 * ({@link PatternsBrag}, `breadth`). */
function breadthFeats(facts: StreamFacts): PatternsBrag["breadth"] {
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

/** Compute bragging rights from the pre-digested stream. Pure, and total over
 * any stream: an empty logbook produces a card of zeros, not an error. */
export function computeBrag(facts: StreamFacts): PatternsBrag {
  const landings = facts.verbs.filter((e) =>
    e.verb === "accept" && e.outcome === "ok"
  );
  const pins = facts.events.filter((e): e is PinEvent => e.kind === "pin");
  const cycles = cycleFeats(facts, landings);
  const span = seriesSpan(facts.verbs);
  const sum = (a: number, b: number): number => a + b;
  const fold = (daily: number[]): number[] =>
    foldDaily(daily, span?.daysPerPoint ?? 1, sum);
  const greens = facts.verbs.filter((e) =>
    e.verb === "done" && e.outcome === "ok"
  );
  return {
    ...(span !== undefined ? { series_days_per_point: span.daysPerPoint } : {}),
    landings: {
      ...landingFeats(landings),
      ...(span !== undefined
        ? { per_day: fold(dailyTotals(landings, span)) }
        : {}),
    },
    gate: {
      ...gateFeats(facts),
      ...(span !== undefined
        ? { greens_per_day: fold(dailyTotals(greens, span)) }
        : {}),
    },
    ...(cycles !== undefined ? { cycles } : {}),
    ratchet: {
      pins: pins.length,
      standards: new Set(pins.map((p) => p.standard)).size,
    },
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
    },
  };
}
