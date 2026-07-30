/**
 * Brag-reader unit tests — {@link computeBrag} driven over synthetic streams,
 * proving every number on the card is the plain count it claims to be:
 * changes shipped and their recorded scale, gate streaks in stream order,
 * first-try greens per branch, start-to-accept cycles matched the way the
 * funnel detector matches them, the pin ratchet, and breadth. The reader shares the
 * detectors' analysis population, so CI runs, previews, and setup-era events
 * must never reach a feat.
 */

import { assert, assertEquals } from "@std/assert";
import { computeBrag } from "../src/engine/logbook/brag.ts";
import { buildStreamFacts } from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import type { PatternsBrag } from "../src/shared/patterns_vocabulary.ts";

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

function brag(events: LogbookEvent[]): PatternsBrag {
  return computeBrag(buildStreamFacts(events, "main"));
}

Deno.test("brag: shipped counts successful accepts and sums their recorded scale", () => {
  const b = brag(run([
    {
      verb: "accept",
      branch: "agent/a",
      change: { files: 3, insertions: 100, deletions: 20, commits: 2 },
    },
    // An accept recorded without a change scale still counts, adding zero.
    { verb: "accept", branch: "agent/b" },
    // A red accept never ships.
    { verb: "accept", branch: "agent/c", outcome: "failed" },
  ]));
  assertEquals(b.shipped.count, 2);
  assertEquals(b.shipped.branches, 2);
  assertEquals(b.shipped.insertions, 100);
  assertEquals(b.shipped.deletions, 20);
  assertEquals(b.shipped.files, 3);
  assertEquals(b.shipped.commits, 2);
  assertEquals(b.shipped.biggest, {
    branch: "agent/a",
    lines: 120,
    files: 3,
    day: "2026-07-01",
  });
});

Deno.test("brag: cleanups count shipped changes that removed more lines than they added", () => {
  const b = brag(run([
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
  assertEquals(b.shipped.cleanups, 1);
});

Deno.test("brag: the biggest shipped change is by changed lines, and a branch-less event carries no branch", () => {
  const b = brag(run([
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
  assertEquals(b.shipped.count, 2);
  assertEquals(b.shipped.branches, 1, "a null branch never mints a branch");
  assertEquals(b.shipped.biggest, {
    lines: 500,
    files: 9,
    day: "2026-07-01",
  });
});

Deno.test("brag: the best day and the shipping streak read UTC calendar days, ties to the earliest", () => {
  const accept = (hours: number): Partial<VerbEvent> => ({
    verb: "accept",
    at: t(hours),
  });
  const b = brag(run([
    accept(1),
    accept(2), // 2026-07-01 × 2
    accept(25),
    accept(26), // 2026-07-02 × 2 — a tie the earliest day wins
    accept(73), // 2026-07-04 — the gap ends the streak
  ]));
  assertEquals(b.shipped.best_day, { day: "2026-07-01", shipped: 2 });
  assertEquals(b.shipped.longest_streak, 2);
});

Deno.test("brag: gate streaks run in stream order and the current streak reads from the tail", () => {
  const streaky = brag(run([
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

  const redTail = brag(run([
    {},
    {},
    { outcome: "failed", failed_stage: "check/test" },
  ]));
  assertEquals(redTail.gate.longest_green_streak, 2);
  assertEquals(redTail.gate.current_green_streak, 0);
});

Deno.test("brag: first-try green counts branches whose first `done` came back green", () => {
  const b = brag(run([
    { branch: "agent/first-try" },
    { branch: "agent/first-try", outcome: "failed" },
    { branch: "agent/thrash", outcome: "failed" },
    { branch: "agent/thrash" },
    { branch: "agent/clean" },
  ]));
  assertEquals(b.gate.gated_branches, 3);
  assertEquals(b.gate.first_try_green_branches, 2);
});

Deno.test("brag: check hours sum done, prepare, and test wall clocks and nothing else", () => {
  const b = brag(run([
    { verb: "done", duration_ms: 3_600_000 },
    { verb: "prepare", duration_ms: 1_800_000 },
    { verb: "test", duration_ms: 1_800_000 },
    // A slow read-only verb is not a check.
    { verb: "status", duration_ms: 7_200_000 },
  ]));
  assertEquals(b.gate.check_hours, 2);
});

Deno.test("brag: cycles match a start's created branch to the first later accept on it", () => {
  const b = brag(run([
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

Deno.test("brag: no completed cycle means no cycles section, not zeros", () => {
  const b = brag(run([
    { verb: "start", branch: "main", target: "agent/open" },
    { verb: "done", branch: "agent/open" },
  ]));
  assertEquals(b.cycles, undefined);
});

Deno.test("brag: the ratchet counts pins and the distinct standards they tightened", () => {
  const b = brag([
    ...run([{ verb: "done" }]),
    pin(t(1), "coverage", 80, 85),
    pin(t(2), "coverage", 85, 88),
    pin(t(3), "lint_suppressions", 5, 4),
  ]);
  assertEquals(b.ratchet, { pins: 3, standards: 2 });
});

Deno.test("brag: breadth counts branches, active days, and the busiest day", () => {
  const b = brag(run([
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

Deno.test("brag: cadence series cover the span's calendar days, zero-filled", () => {
  const b = brag(run([
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
  assertEquals(b.shipped.per_day, [2, 0, 1]);
  assertEquals(b.gate.greens_per_day, [1, 0, 0], "a red day is not a green");
  assertEquals(b.breadth.branches_per_day, [1, 0, 1]);
});

Deno.test("brag: a one-day span carries no cadence series", () => {
  const b = brag(run([{ verb: "accept" }, { verb: "done" }]));
  assertEquals(b.series_days_per_point, undefined);
  assertEquals(b.shipped.per_day, undefined);
  assertEquals(b.gate.greens_per_day, undefined);
  assertEquals(b.breadth.branches_per_day, undefined);
});

Deno.test("brag: a span past the wire cap folds whole days per point — sums for counts, the peak for branches", () => {
  const b = brag(run([
    { verb: "accept", branch: "agent/a", at: t(0) },
    { verb: "accept", branch: "agent/b", at: t(24) },
    // Day 47 anchors a 48-day span: 2 whole days per point, 24 points.
    { verb: "done", branch: "agent/x", at: t(24 * 47) },
  ]));
  assertEquals(b.series_days_per_point, 2);
  assertEquals(b.shipped.per_day?.length, 24);
  assertEquals(b.shipped.per_day?.[0], 2, "a point sums its days' ships");
  assertEquals(
    b.breadth.branches_per_day?.[0],
    1,
    "a point keeps its peak day's distinct branches, never a cross-day sum",
  );
});

Deno.test("brag: CI runs, previews, and setup-era events never reach a feat", () => {
  const b = brag(run([
    {
      verb: "accept",
      driver: { session: "ci:1", json: true, tty: false, ci: true },
    },
    { verb: "accept", dry_run: true },
    { verb: "done", branch: SETUP_BRANCH },
  ]));
  assertEquals(b.shipped.count, 0);
  assertEquals(b.gate.runs, 0);
  assertEquals(b.breadth.branches, 0);
});

Deno.test("brag: an empty stream produces a card of zeros, not an error", () => {
  const b = brag([]);
  assertEquals(b.shipped, {
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
  assertEquals(b.breadth, {
    branches: 0,
    active_days: 0,
    span_days: 0,
  });
  assert(!("busiest_day" in b.breadth));
});
