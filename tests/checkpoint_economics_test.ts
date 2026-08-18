/**
 * The checkpoint economics reader — the one tally every consumer (the stats
 * card, the `checkpoints` verb, the hygiene detectors) reads. What must hold:
 * counts are local with their denominators, rows stay bounded by the
 * configured cap regardless of history, evidence gaps censor (an event
 * without the observation block, a declaration without its revision flag or
 * elapsed time), and the config-change boundary restarts the hygiene
 * denominator so a revised `[checkpoints]` table answers for itself.
 */

import { assert, assertEquals } from "@std/assert";
import {
  analyzeCheckpointObservations,
  checkpointConfigBoundary,
  checkpointEconomicsOf,
  gateEffortsSince,
} from "../src/engine/logbook/checkpoint_economics.ts";
import { computeStats } from "../src/engine/logbook/stats.ts";
import { buildStreamFacts } from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import { CHECKPOINT_ECONOMICS_ROWS_MAX } from "../src/shared/patterns_vocabulary.ts";

/** A deterministic timestamp `n` hours after the fixture epoch. */
function t(hours: number): string {
  return new Date(Date.parse("2026-07-01T00:00:00.000Z") + hours * 3_600_000)
    .toISOString();
}

/** One synthetic analyzable CLI event with non-interactive defaults. */
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

function facts(events: LogbookEvent[]): ReturnType<typeof buildStreamFacts> {
  return buildStreamFacts(events, "main");
}

Deno.test("checkpoint economics: the full lifecycle tallies with its denominators", () => {
  const events = run([
    // Effort one: fired, revised, declared met after a reopen, landed clean.
    {
      branch: "agent/one",
      checkpoints: { fired: [{ id: "api-review", subject: "s1" }] },
    },
    {
      branch: "agent/one",
      checkpoints: {
        reopened: [{ id: "api-review", subject: "s2" }],
        declared: [{
          id: "api-review",
          conclusion: "met",
          revised: true,
          elapsed_ms: 120_000,
        }],
      },
    },
    { branch: "agent/one", verb: "accept" },
    // Effort two: fired, declared unmet on the unchanged subject, landed
    // under an authorized variance with one abandoned episode.
    {
      branch: "agent/two",
      checkpoints: { fired: [{ id: "api-review", subject: "s3" }] },
    },
    {
      branch: "agent/two",
      checkpoints: {
        declared: [{
          id: "api-review",
          conclusion: "unmet",
          revised: false,
          elapsed_ms: 60_000,
        }],
      },
    },
    {
      branch: "agent/two",
      verb: "accept",
      checkpoints: {
        variances: [{ id: "api-review", definition: "d1", subject: "s3" }],
        abandoned: [{ id: "retired-rule" }],
      },
    },
    // Effort three: a gate run where nothing fired — the denominator grows.
    { branch: "agent/three" },
  ]);
  const economics = checkpointEconomicsOf(facts(events));
  assert(economics !== undefined, "recorded activity must produce economics");
  assertEquals(economics.efforts, 3);
  assertEquals(economics.omitted, 0);
  const api = economics.rows.find((row) => row.id === "api-review");
  assertEquals(api, {
    id: "api-review",
    efforts_fired: 2,
    efforts_landed: 2,
    fires: 3,
    declared: 2,
    declared_unchanged: 1,
    declared_unmet: 1,
    reopened: 1,
    variances: 1,
    abandoned: 0,
    median_declare_s: 90,
  });
  const retired = economics.rows.find((row) => row.id === "retired-rule");
  assertEquals(retired?.abandoned, 1);
  assertEquals(retired?.fires, 0);
});

Deno.test("checkpoint economics: evidence gaps censor instead of counting", () => {
  const events = run([
    // An event from a writer without the observation block: nothing to read.
    { branch: "agent/one" },
    // A declaration without the revision flag counts as declared only, and
    // one without elapsed time contributes nothing to the median.
    {
      branch: "agent/one",
      checkpoints: {
        fired: [{ id: "api-review" }],
        declared: [{ id: "api-review", conclusion: "met" }],
      },
    },
  ]);
  const economics = checkpointEconomicsOf(facts(events));
  assert(economics !== undefined);
  const api = economics.rows.find((row) => row.id === "api-review");
  assertEquals(api?.declared, 1);
  assertEquals(api?.declared_unchanged, 0);
  assertEquals(api?.median_declare_s, undefined);
});

Deno.test("checkpoint economics: rows stay bounded and most-served first", () => {
  const many = Array.from(
    { length: CHECKPOINT_ECONOMICS_ROWS_MAX + 4 },
    (_, i) => ({
      branch: `agent/${i}`,
      checkpoints: {
        advise: Array.from(
          { length: i + 1 },
          () => ({ id: `check-${String(i).padStart(2, "0")}` }),
        ),
      },
    }),
  );
  const economics = checkpointEconomicsOf(facts(run(many)));
  assert(economics !== undefined);
  assertEquals(economics.rows.length, CHECKPOINT_ECONOMICS_ROWS_MAX);
  assertEquals(economics.omitted, 4);
  const fires = economics.rows.map((row) => row.fires);
  assertEquals(fires, [...fires].sort((a, b) => b - a), "most served first");
});

Deno.test("checkpoint economics: an empty or block-less stream reads as no history", () => {
  assertEquals(checkpointEconomicsOf(facts([])), undefined);
  assertEquals(
    checkpointEconomicsOf(facts(run([{ branch: "agent/one" }]))),
    undefined,
  );
});

Deno.test("checkpoint economics: servings on an unknown branch count without attributing an effort", () => {
  const analysis = analyzeCheckpointObservations(facts(run([
    {
      branch: null,
      checkpoints: { fired: [{ id: "api-review" }] },
    },
  ])));
  const tally = analysis.tallies.get("api-review");
  assertEquals(tally?.fires, 1);
  assertEquals(tally?.effortsFired.size, 0);
});

Deno.test("checkpoint economics: the stats card carries the same rows, and none without history", () => {
  const active = computeStats(facts(run([
    {
      branch: "agent/one",
      checkpoints: { fired: [{ id: "api-review" }] },
    },
  ])));
  assertEquals(active.checkpoints?.rows.length, 1);
  assertEquals(active.checkpoints?.rows[0]?.id, "api-review");
  const silent = computeStats(facts(run([{ branch: "agent/one" }])));
  assertEquals(
    silent.checkpoints,
    undefined,
    "a stream without checkpoint activity adds no section to the card",
  );
});

Deno.test("checkpoint economics: the config-change boundary restarts the hygiene denominator", () => {
  const events: LogbookEvent[] = [
    verb({ at: t(0), branch: "agent/old-one" }),
    verb({ at: t(1), branch: "agent/old-two" }),
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: t(2),
      kind: "config-change",
      branch: "agent/new-one",
      sections: ["checkpoints"],
      epoch: "e2",
    },
    verb({ at: t(3), branch: "agent/new-one", epoch: "e2" }),
    verb({ at: t(4), branch: "agent/new-two", epoch: "e2" }),
  ];
  const streamFacts = facts(events);
  const boundary = checkpointConfigBoundary(streamFacts);
  assertEquals(boundary, t(2));
  assertEquals(
    [...gateEffortsSince(streamFacts, boundary)].sort(),
    ["agent/new-one", "agent/new-two"],
  );
  // A change to some other section moves no checkpoint boundary.
  const other: LogbookEvent[] = [
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: t(0),
      kind: "config-change",
      branch: "agent/one",
      sections: ["standards"],
      epoch: "e2",
    },
    verb({ at: t(1), branch: "agent/one" }),
  ];
  assertEquals(checkpointConfigBoundary(facts(other)), undefined);
  assertEquals(
    [...gateEffortsSince(facts(other), undefined)],
    ["agent/one"],
  );
});
