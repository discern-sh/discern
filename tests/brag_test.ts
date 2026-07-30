/**
 * Brag-reader unit tests — {@link computeBrag} driven over synthetic streams,
 * proving every number on the card is the plain count it claims to be:
 * landings and their recorded scale, gate streaks in stream order, first-try
 * greens per branch, start-to-accept cycles matched the way the funnel
 * detector matches them, the pin ratchet, and breadth. The reader shares the
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
function pin(at: string, standard: string, from: number, to: number): LogbookEvent {
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

Deno.test("brag: landings count successful accepts and sum their recorded scale", () => {
  const b = brag(run([
    {
      verb: "accept",
      branch: "agent/a",
      change: { files: 3, insertions: 100, deletions: 20, commits: 2 },
    },
    // A landing recorded without a change scale still counts, adding zero.
    { verb: "accept", branch: "agent/b" },
    // A red accept is not a landing.
    { verb: "accept", branch: "agent/c", outcome: "failed" },
  ]));
  assertEquals(b.landings.count, 2);
  assertEquals(b.landings.branches, 2);
  assertEquals(b.landings.insertions, 100);
  assertEquals(b.landings.deletions, 20);
  assertEquals(b.landings.files, 3);
  assertEquals(b.landings.commits, 2);
  assertEquals(b.landings.biggest, {
    branch: "agent/a",
    lines: 120,
    files: 3,
    day: "2026-07-01",
  });
});

Deno.test("brag: the biggest landing is by changed lines, and a branch-less event carries no branch", () => {
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
  assertEquals(b.landings.count, 2);
  assertEquals(b.landings.branches, 1, "a null branch never mints a branch");
  assertEquals(b.landings.biggest, {
    lines: 500,
    files: 9,
    day: "2026-07-01",
  });
});

Deno.test("brag: the best day and the daily streak read UTC calendar days, ties to the earliest", () => {
  const accept = (hours: number): Partial<VerbEvent> => ({
    verb: "accept",
    at: t(hours),
  });
  const b = brag(run([
    accept(1),
    accept(2), // 2026-07-01 × 2
    accept(25),
    accept(26), // 2026-07-02 × 2 — a tie the earliest day wins
    accept(73), // 2026-07-04 — the gap ends the daily streak
  ]));
  assertEquals(b.landings.best_day, { day: "2026-07-01", landings: 2 });
  assertEquals(b.landings.longest_daily_streak, 2);
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
  ]));
  assertEquals(b.cycles, {
    completed: 2,
    median_hours: 3,
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

Deno.test("brag: CI runs, previews, and setup-era events never reach a feat", () => {
  const b = brag(run([
    {
      verb: "accept",
      driver: { session: "ci:1", json: true, tty: false, ci: true },
    },
    { verb: "accept", dry_run: true },
    { verb: "done", branch: SETUP_BRANCH },
  ]));
  assertEquals(b.landings.count, 0);
  assertEquals(b.gate.runs, 0);
  assertEquals(b.breadth.branches, 0);
});

Deno.test("brag: an empty stream produces a card of zeros, not an error", () => {
  const b = brag([]);
  assertEquals(b.landings, {
    count: 0,
    branches: 0,
    insertions: 0,
    deletions: 0,
    files: 0,
    commits: 0,
    longest_daily_streak: 0,
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
