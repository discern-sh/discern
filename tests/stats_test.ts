/**
 * Stats-reader unit tests — {@link computeStats} driven over synthetic streams,
 * proving every number on the card is the plain count it claims to be:
 * accepted changes and their recorded scale, gate streaks in stream order,
 * first-try greens per branch, start-to-accept cycles matched the way the
 * funnel detector matches them, the pin ratchet, and breadth. The reader shares the
 * detectors' analysis population, so CI runs, previews, and setup-era events
 * must never reach a feat.
 */

import { assert, assertEquals } from "@std/assert";
import { computeStats } from "../src/engine/logbook/stats.ts";
import { buildStreamFacts } from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import type { PatternsStats } from "../src/shared/patterns_vocabulary.ts";

/** A deterministic timestamp `n` hours after the fixture epoch. */
function t(hours: number): string {
  return new Date(Date.parse("2026-07-01T00:00:00.000Z") + hours * 3_600_000)
    .toISOString();
}

/** One synthetic verb event with agent-shaped defaults; override what matters. */
function verb(over: Partial<VerbEvent>): VerbEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: t(0),
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:1", json: true, tty: false, ci: false },
    branch: "agent/task",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 1_000,
    epoch: "e1",
    ...over,
  };
}

/** A sequence of verb events, one per override, timestamped an hour apart. */
function run(overrides: Partial<VerbEvent>[]): LogbookEvent[] {
  return overrides.map((over, i) => verb({ at: t(i), ...over }));
}

/** A pin event tightening one standard's limit. */
function pin(
  at: string,
  standard: string,
  from: number,
  to: number,
): LogbookEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at,
    kind: "pin",
    branch: "agent/task",
    standard,
    from,
    to,
    measured: to,
  };
}

/** Derive production stream facts before computing aggregate pattern statistics for fixtures. */
function stats(events: LogbookEvent[]): PatternsStats {
  return computeStats(buildStreamFacts(events, "main"));
}

Deno.test("stats: accepted counts successful accepts and sums their recorded scale", () => {
  const b = stats(run([
    {
      verb: "accept",
      branch: "agent/a",
      change: { files: 3, insertions: 100, deletions: 20, commits: 2 },
    },
    // An accept recorded without a change scale still counts, adding zero.
    { verb: "accept", branch: "agent/b" },
    // A red accept is never an accepted change.
    { verb: "accept", branch: "agent/c", outcome: "failed" },
  ]));
  assertEquals(b.accepted.count, 2);
  assertEquals(b.accepted.branches, 2);
  assertEquals(b.accepted.insertions, 100);
  assertEquals(b.accepted.deletions, 20);
  assertEquals(b.accepted.files, 3);
  assertEquals(b.accepted.commits, 2);
  assertEquals(b.accepted.biggest, {
    branch: "agent/a",
    lines: 120,
    files: 3,
    day: "2026-07-01",
  });
});

Deno.test("stats: cleanups count accepted changes that removed more lines than they added", () => {
  const b = stats(run([
    {
      verb: "accept",
      branch: "agent/prune",
      change: { files: 2, insertions: 5, deletions: 40, commits: 1 },
    },
    {
      verb: "accept",
      branch: "agent/grow",
      change: { files: 2, insertions: 40, deletions: 5, commits: 1 },
    },
    // A wash is not a cleanup.
    {
      verb: "accept",
      branch: "agent/even",
      change: { files: 1, insertions: 7, deletions: 7, commits: 1 },
    },
  ]));
  assertEquals(b.accepted.cleanups, 1);
});

Deno.test("stats: the biggest accepted change is by changed lines, and a branch-less event carries no branch", () => {
  const b = stats(run([
    {
      verb: "accept",
      branch: "agent/small",
      change: { files: 1, insertions: 10, deletions: 0, commits: 1 },
    },
    {
      verb: "accept",
      branch: null,
      change: { files: 9, insertions: 400, deletions: 100, commits: 4 },
    },
  ]));
  assertEquals(b.accepted.count, 2);
  assertEquals(b.accepted.branches, 1, "a null branch never mints a branch");
  assertEquals(b.accepted.biggest, {
    lines: 500,
    files: 9,
    day: "2026-07-01",
  });
});

Deno.test("stats: the best day and the acceptance streak read UTC calendar days, ties to the earliest", () => {
  const accept = (hours: number): Partial<VerbEvent> => ({
    verb: "accept",
    at: t(hours),
  });
  const b = stats(run([
    accept(1),
    accept(2), // 2026-07-01 × 2
    accept(25),
    accept(26), // 2026-07-02 × 2 — a tie the earliest day wins
    accept(73), // 2026-07-04 — the gap ends the streak
  ]));
  assertEquals(b.accepted.best_day, { day: "2026-07-01", accepted: 2 });
  assertEquals(b.accepted.longest_streak, 2);
});

Deno.test("stats: gate streaks run in stream order and the current streak reads from the tail", () => {
  const streaky = stats(run([
    {},
    {},
    { outcome: "failed", failed_stage: "check/test" },
    {},
    {},
    {},
  ]));
  assertEquals(streaky.gate.runs, 6);
  assertEquals(streaky.gate.greens, 5);
  assertEquals(streaky.gate.longest_green_streak, 3);
  assertEquals(streaky.gate.current_green_streak, 3);

  const redTail = stats(run([
    {},
    {},
    { outcome: "failed", failed_stage: "check/test" },
  ]));
  assertEquals(redTail.gate.longest_green_streak, 2);
  assertEquals(redTail.gate.current_green_streak, 0);
});

Deno.test("stats: first-try green counts branches whose first `done` came back green", () => {
  const b = stats(run([
    { branch: "agent/first-try" },
    { branch: "agent/first-try", outcome: "failed" },
    { branch: "agent/thrash", outcome: "failed" },
    { branch: "agent/thrash" },
    { branch: "agent/clean" },
  ]));
  assertEquals(b.gate.gated_branches, 3);
  assertEquals(b.gate.first_try_green_branches, 2);
});

Deno.test("stats: check hours sum done, prepare, and test wall clocks and nothing else", () => {
  const b = stats(run([
    { verb: "done", duration_ms: 3_600_000 },
    { verb: "prepare", duration_ms: 1_800_000 },
    { verb: "test", duration_ms: 1_800_000 },
    // A slow read-only verb is not a check.
    { verb: "status", duration_ms: 7_200_000 },
  ]));
  assertEquals(b.gate.check_hours, 2);
});

Deno.test("stats: cycles match a start's created branch to the first later accept on it", () => {
  const b = stats(run([
    { verb: "start", branch: "main", target: "agent/quick" }, // t(0)
    { verb: "start", branch: "main", target: "agent/slow" }, // t(1)
    { verb: "accept", branch: "agent/quick" }, // t(2) → 2h
    // An accept that predates its start can never complete the cycle.
    { verb: "accept", branch: "agent/orphan" }, // t(3)
    { verb: "start", branch: "main", target: "agent/orphan" }, // t(4)
    { verb: "accept", branch: "agent/slow" }, // t(5) → 4h
    { verb: "start", branch: "main", target: "agent/marathon", at: t(6) },
    // 30h later — a completed cycle, but not one inside a day.
    { verb: "accept", branch: "agent/marathon", at: t(36) },
  ]));
  assertEquals(b.cycles, {
    started: 4,
    completed: 3,
    under_day: 2,
    median_hours: 4,
    fastest_hours: 2,
  });
});

Deno.test("stats: no completed cycle means no cycles section, not zeros", () => {
  const b = stats(run([
    { verb: "start", branch: "main", target: "agent/open" },
    { verb: "done", branch: "agent/open" },
  ]));
  assertEquals(b.cycles, undefined);
});

Deno.test("stats: the ratchet counts pins and the distinct standards they tightened", () => {
  const b = stats([
    ...run([{ verb: "done" }]),
    pin(t(1), "coverage", 80, 85),
    pin(t(2), "coverage", 85, 88),
    pin(t(3), "lint_suppressions", 5, 4),
  ]);
  assertEquals(b.ratchet, { pins: 3, standards: 2 });
});

Deno.test("stats: breadth counts branches, active days, and the busiest day", () => {
  const b = stats(run([
    { branch: "agent/a", at: t(1) },
    { branch: "agent/b", at: t(2) },
    { branch: "agent/a", at: t(25) }, // 2026-07-02
    { branch: "agent/a", at: t(73) }, // 2026-07-04
    { branch: "agent/b", at: t(74) },
    { branch: "agent/c", at: t(75) },
  ]));
  assertEquals(b.breadth.branches, 3);
  assertEquals(b.breadth.active_days, 3);
  assertEquals(b.breadth.span_days, 4, "the span is inclusive calendar days");
  assertEquals(b.breadth.first_day, "2026-07-01");
  assertEquals(b.breadth.last_day, "2026-07-04");
  assertEquals(b.breadth.busiest_day, { day: "2026-07-04", branches: 3 });
});

Deno.test("stats: cadence series cover the span's calendar days, zero-filled", () => {
  const b = stats(run([
    { verb: "accept", at: t(1) },
    { verb: "accept", at: t(2) },
    { verb: "done", at: t(3) },
    { verb: "accept", at: t(49) }, // 2026-07-03 — day 2 stays an honest zero
    {
      verb: "done",
      at: t(50),
      outcome: "failed",
      failed_stage: "check/test",
    },
  ]));
  assertEquals(b.series_days_per_point, 1);
  assertEquals(b.accepted.per_day, [2, 0, 1]);
  assertEquals(b.gate.greens_per_day, [1, 0, 0], "a red day is not a green");
  assertEquals(b.breadth.branches_per_day, [1, 0, 1]);
});

Deno.test("stats: a one-day span carries no cadence series", () => {
  const b = stats(run([{ verb: "accept" }, { verb: "done" }]));
  assertEquals(b.series_days_per_point, undefined);
  assertEquals(b.accepted.per_day, undefined);
  assertEquals(b.gate.greens_per_day, undefined);
  assertEquals(b.breadth.branches_per_day, undefined);
});

Deno.test("stats: a span past the wire cap folds whole days per point — sums for counts, the peak for branches", () => {
  const b = stats(run([
    { verb: "accept", branch: "agent/a", at: t(0) },
    { verb: "accept", branch: "agent/b", at: t(24) },
    // Day 47 anchors a 48-day span: 2 whole days per point, 24 points.
    { verb: "done", branch: "agent/x", at: t(24 * 47) },
  ]));
  assertEquals(b.series_days_per_point, 2);
  assertEquals(b.accepted.per_day?.length, 24);
  assertEquals(b.accepted.per_day?.[0], 2, "a point sums its days' ships");
  assertEquals(
    b.breadth.branches_per_day?.[0],
    1,
    "a point keeps its peak day's distinct branches, never a cross-day sum",
  );
});

Deno.test("stats: CI runs, previews, and setup-era events never reach a feat", () => {
  const b = stats(run([
    {
      verb: "accept",
      driver: { session: "ci:1", json: true, tty: false, ci: true },
    },
    { verb: "accept", dry_run: true },
    { verb: "done", branch: SETUP_BRANCH },
  ]));
  assertEquals(b.accepted.count, 0);
  assertEquals(b.gate.runs, 0);
  assertEquals(b.breadth.branches, 0);
});

Deno.test("stats: an empty stream produces a card of zeros, not an error", () => {
  const b = stats([]);
  assertEquals(b.accepted, {
    count: 0,
    branches: 0,
    insertions: 0,
    deletions: 0,
    files: 0,
    commits: 0,
    cleanups: 0,
    longest_streak: 0,
  });
  assertEquals(b.gate, {
    runs: 0,
    greens: 0,
    first_try_green_branches: 0,
    gated_branches: 0,
    longest_green_streak: 0,
    current_green_streak: 0,
    check_hours: 0,
  });
  assertEquals(b.cycles, undefined);
  assertEquals(b.ratchet, { pins: 0, standards: 0 });
  assertEquals(b.agents, {
    detected: 0,
    identities: [],
    unattributed_runs: 0,
  });
  assertEquals(b.breadth, {
    branches: 0,
    active_days: 0,
    span_days: 0,
  });
  assert(!("busiest_day" in b.breadth));
  assert(!("peak_in_flight" in b.breadth));
});

Deno.test("stats: peak in flight counts overlapping branch windows, pauses included", () => {
  const b = stats(run([
    { branch: "agent/a", at: t(0) },
    // b's whole life falls inside a's overnight pause — still 2 in flight.
    { branch: "agent/b", at: t(10) },
    { branch: "agent/a", at: t(30) },
  ]));
  assertEquals(b.breadth.peak_in_flight, { branches: 2, day: "2026-07-01" });
});

Deno.test("stats: a branch stops counting toward the peak after its last event", () => {
  const b = stats(run([
    { branch: "agent/abandoned", at: t(0) },
    { branch: "agent/abandoned", at: t(1) },
    // Opens 4h after the abandoned branch's last event: never concurrent.
    { branch: "agent/later", at: t(5) },
    { branch: "agent/later", at: t(6) },
  ]));
  assertEquals(b.breadth.peak_in_flight?.branches, 1);
});

Deno.test("stats: the trunk is not a change, and same-instant handover still overlaps", () => {
  const trunkOnly = stats(run([
    { branch: "main", verb: "status" },
    { branch: "main", verb: "status", at: t(1) },
  ]));
  assertEquals(trunkOnly.breadth.peak_in_flight, undefined);

  const handover = stats(run([
    { branch: "agent/first", at: t(0) },
    // Both branches carry an event at the same instant: 2 in flight.
    { branch: "agent/first", at: t(2) },
    { branch: "agent/second", at: t(2) },
    { branch: "agent/second", at: t(3) },
  ]));
  assertEquals(handover.breadth.peak_in_flight?.branches, 2);
});

/** A verb event carrying standard readings, as the gate records them. */
function measured(
  over: Partial<VerbEvent>,
  readings: { name: string; direction: string; value: number }[],
): Partial<VerbEvent> {
  return {
    ...over,
    standards: readings.map((r) => ({ ...r, limit: r.value })),
  };
}

Deno.test("stats: the most improved standard is percent-normalized, so scales compare like-for-like", () => {
  const b = stats(run([
    measured({ at: t(0) }, [
      { name: "big_ceiling", direction: "down", value: 1_000_000 },
      { name: "small_ceiling", direction: "down", value: 10 },
    ]),
    measured({ at: t(1) }, [
      // −100,000 lines is a 10% improvement…
      { name: "big_ceiling", direction: "down", value: 900_000 },
      // …but −2 from 10 is 20%: the small standard wins like-for-like.
      { name: "small_ceiling", direction: "down", value: 8 },
    ]),
  ]));
  assertEquals(b.ratchet.most_improved, {
    standard: "small_ceiling",
    from: 10,
    to: 8,
    better_percent: 20,
  });
});

Deno.test("stats: improvement is direction-adjusted — a rising floor and a falling ceiling both read positive", () => {
  const b = stats(run([
    measured({ at: t(0) }, [
      { name: "ceiling", direction: "down", value: 100 },
      { name: "floor", direction: "up", value: 50 },
    ]),
    measured({ at: t(1) }, [
      { name: "ceiling", direction: "down", value: 90 },
      { name: "floor", direction: "up", value: 60 },
    ]),
  ]));
  assertEquals(b.ratchet.most_improved?.standard, "floor");
  assertEquals(b.ratchet.most_improved?.better_percent, 20);
});

Deno.test("stats: a standard that only worsened is never most improved, and a zero first reading is set aside", () => {
  const b = stats(run([
    measured({ at: t(0) }, [
      { name: "worsening", direction: "down", value: 100 },
      { name: "zero_start", direction: "up", value: 0 },
    ]),
    measured({ at: t(1) }, [
      { name: "worsening", direction: "down", value: 120 },
      { name: "zero_start", direction: "up", value: 5 },
    ]),
  ]));
  assertEquals(b.ratchet.most_improved, undefined);
});

Deno.test("stats: the ratchet trend averages per-day improvement, carrying unmeasured days forward", () => {
  const b = stats(run([
    measured({ at: t(0) }, [
      { name: "ceiling", direction: "down", value: 100 },
    ]),
    // Day 1 goes unmeasured: the day-0 reading carries forward at 0%.
    measured({ at: t(49) }, [
      { name: "ceiling", direction: "down", value: 90 },
    ]),
  ]));
  assertEquals(b.ratchet.trend, [0, 0, 10]);
});

/** An invocation-scoped identity signal naming one agent. */
function signals(agent: string): NonNullable<VerbEvent["driver"]> {
  return {
    session: `cli:${agent}`,
    json: true,
    tty: false,
    ci: false,
    agent_signals: [{ agent, source: "process-environment", markers: ["X"] }],
  };
}

Deno.test("stats: agents ride the cohort seam — below-minimum identities are counted, never listed", () => {
  const b = stats(run([
    // Six attributed runs clear the reporting minimums…
    { driver: signals("claude") },
    { driver: signals("claude") },
    { driver: signals("claude"), outcome: "failed", failed_stage: "check" },
    { driver: signals("claude") },
    { driver: signals("claude"), verb: "status" },
    { driver: signals("claude"), verb: "status" },
    // …one run does not…
    { driver: signals("codex") },
    // …and a signal-less run stays unattributed.
    { verb: "status" },
  ]));
  assertEquals(b.agents.detected, 2);
  assertEquals(b.agents.identities.length, 1);
  const [claude] = b.agents.identities;
  assertEquals(claude?.agent, "claude");
  assertEquals(claude?.runs, 6);
  assertEquals(claude?.done_runs, 4);
  assertEquals(claude?.greens, 3);
  assertEquals(b.agents.below_minimum, { agents: 1, runs: 1 });
  assertEquals(b.agents.unattributed_runs, 1);
});

Deno.test("stats: each listed identity carries its own usage series across the span", () => {
  const b = stats(run([
    { driver: signals("claude"), at: t(0) },
    { driver: signals("claude"), at: t(1) },
    { driver: signals("claude"), at: t(2) },
    { driver: signals("claude"), at: t(3) },
    // Day 1 is quiet for this identity; day 2 holds its fifth run.
    { driver: signals("claude"), at: t(49) },
  ]));
  assertEquals(b.agents.identities[0]?.per_day, [4, 0, 1]);
  assertEquals(b.agents.per_day, [4, 0, 1]);
});
