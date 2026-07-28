/**
 * Cohort-seam unit tests — the honesty rules at their single home
 * (`src/engine/logbook/cohorts.ts`), proven at the seam so every detector
 * passing through inherits them:
 *
 *  - cohort keys come only from invocation-scoped evidence, driven off the
 *    catalogue's lifetime record (a new ambient source class auto-excludes);
 *  - `custom` is one cohort, never subdivided;
 *  - the unattributed share is always reported, even at zero;
 *  - the recorded minimums are tuned to the observed fleet shapes: a balanced
 *    split speaks, a trace second cohort stays silent even past the absolute
 *    floor (the share floor at work);
 *  - the dominant client's version eras: boundaries only between two recorded
 *    versions, none at all for a version-blind stream.
 */

import { assert, assertEquals } from "@std/assert";
import {
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  AGENT_SIGNAL_SOURCES,
} from "../src/shared/agent_catalogue.ts";
import {
  attributedIdentity,
  COHORT_MINIMUMS,
  cohortDenominators,
  type CohortSplit,
  comparative,
  denominatorClause,
  dominantClientEras,
  splitByCohort,
} from "../src/engine/logbook/cohorts.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";

function t(hours: number): string {
  return new Date(Date.parse("2026-07-01T00:00:00.000Z") + hours * 3_600_000)
    .toISOString();
}

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

/** An event carrying one identity signal from the given source. */
function signalled(
  agent: string,
  source: (typeof AGENT_SIGNAL_SOURCES)[number],
  marker = "MARKER",
  over: Partial<VerbEvent> = {},
): VerbEvent {
  return verb({
    driver: {
      session: "cli:1",
      json: true,
      tty: false,
      ci: false,
      agent_signals: [{ agent, source, markers: [marker] }],
    },
    ...over,
  });
}

/** N events attributed to one agent via a process marker. */
function runs(agent: string, n: number): VerbEvent[] {
  return Array.from(
    { length: n },
    (_, i) => signalled(agent, "process-environment", "MARKER", { at: t(i) }),
  );
}

function eventUnits(events: VerbEvent[]): CohortSplit<VerbEvent> {
  return splitByCohort(events, (e: VerbEvent) => [e]);
}

// ── keys come only from invocation-scoped evidence ──────────────────────────

Deno.test("cohort seam: every ambient source class is excluded from cohort keys automatically", () => {
  const ambientSources = AGENT_SIGNAL_SOURCES.filter(
    (source) => AGENT_SIGNAL_SOURCE_LIFETIMES[source] === "ambient",
  );
  assert(
    ambientSources.length > 0,
    "the catalogue currently classifies at least one ambient source",
  );
  for (const source of ambientSources) {
    const events = Array.from(
      { length: COHORT_MINIMUMS.runsPerCohort * 2 },
      (_, i) => signalled("devin", source, "/opt/.devin", { at: t(i) }),
    );
    const split = eventUnits(events);
    assertEquals(
      split.speaking.length + split.belowMinimum.length,
      0,
      `${source}: ambient evidence must mint no cohort`,
    );
    assertEquals(split.unattributedRuns, events.length);
  }
});

Deno.test("cohort seam: a unit two agents drove belongs to neither cohort", () => {
  assertEquals(
    attributedIdentity([
      signalled("claude", "process-environment", "CLAUDECODE"),
      signalled("codex", "process-environment", "CODEX_THREAD_ID"),
    ]),
    undefined,
  );
  // Absence is not disagreement: unsignalled events beside one identity
  // still attribute the unit.
  assertEquals(
    attributedIdentity([
      signalled("claude", "process-environment", "CLAUDECODE"),
      verb({}),
    ]),
    "claude",
  );
  assertEquals(attributedIdentity([verb({})]), undefined);
});

// ── custom is one cohort ────────────────────────────────────────────────────

Deno.test("cohort seam: unrecognized declarations pool into the one custom cohort", () => {
  const events = [
    ...runs("custom", COHORT_MINIMUMS.runsPerCohort),
    ...runs("claude", COHORT_MINIMUMS.runsPerCohort),
  ];
  const split = eventUnits(events);
  const custom = split.speaking.find((c) => c.agent === "custom");
  assert(custom !== undefined, "custom must form a single speaking cohort");
  assertEquals(custom.runs, COHORT_MINIMUMS.runsPerCohort);
  assertEquals(custom.label, "Custom agent");
});

// ── the recorded minimums, tuned to the fleet shapes ────────────────────────

Deno.test("cohort seam: a balanced two-cohort corpus speaks", () => {
  const split = eventUnits([...runs("claude", 11), ...runs("codex", 9)]);
  assert(comparative(split));
  assertEquals(split.speaking.map((c) => c.agent), ["claude", "codex"]);
});

Deno.test("cohort seam: a trace second cohort stays silent past the absolute floor — the share floor at work", () => {
  // Modeled on the observed near-single-cohort corpus: hundreds of runs
  // against a single-digit handful. Six runs clear the absolute floor, so
  // only the share floor can hold the honesty line here.
  const trace = COHORT_MINIMUMS.runsPerCohort + 1;
  const split = eventUnits([...runs("codex", 60), ...runs("claude", trace)]);
  assert(!comparative(split), "247-versus-9 must not read as a comparison");
  assertEquals(split.speaking.map((c) => c.agent), ["codex"]);
  assertEquals(split.belowMinimum.map((c) => c.agent), ["claude"]);
});

Deno.test("cohort seam: a lopsided-but-real split qualifies", () => {
  // The borderline fleet shape (~85/15): qualifies here, held to each
  // detector's own population downstream.
  const split = eventUnits([...runs("codex", 85), ...runs("claude", 15)]);
  assert(comparative(split));
});

Deno.test("cohort seam: below the absolute floor a cohort never speaks", () => {
  const split = eventUnits([
    ...runs("codex", COHORT_MINIMUMS.runsPerCohort),
    ...runs("claude", COHORT_MINIMUMS.runsPerCohort - 1),
  ]);
  assert(!comparative(split));
  assertEquals(split.belowMinimum.map((c) => c.agent), ["claude"]);
});

// ── the unattributed share is always reported ───────────────────────────────

Deno.test("cohort seam: denominators always carry the unattributed share, even at zero", () => {
  const attributed = eventUnits([...runs("claude", 6), ...runs("codex", 6)]);
  assertEquals(cohortDenominators(attributed).unattributed_runs, 0);
  assert(denominatorClause(attributed).includes("0 unattributed"));

  const remainder = eventUnits([
    ...runs("claude", 6),
    ...runs("codex", 6),
    verb({}),
    verb({}),
  ]);
  assertEquals(cohortDenominators(remainder).unattributed_runs, 2);
  assertEquals(remainder.unattributedUnits, 2);
  const clause = denominatorClause(remainder);
  assert(
    clause.includes("Claude Code 6") && clause.includes("Codex 6") &&
      clause.includes("2 unattributed"),
    clause,
  );
});

Deno.test("cohort seam: below-minimum runs are reported beside the cohorts, never hidden", () => {
  const split = eventUnits([
    ...runs("codex", 60),
    ...runs("claude", COHORT_MINIMUMS.runsPerCohort + 1),
  ]);
  assertEquals(
    cohortDenominators(split).below_minimum_runs,
    COHORT_MINIMUMS.runsPerCohort + 1,
  );
  assert(
    denominatorClause(split).includes("below the reporting minimums"),
    denominatorClause(split),
  );
});

// ── unit-level splitting ────────────────────────────────────────────────────

Deno.test("cohort seam: units carry their own runs as the denominator", () => {
  const branches = [
    { name: "agent/a", events: runs("claude", 4) },
    { name: "agent/b", events: runs("claude", 3) },
    { name: "agent/c", events: runs("codex", 6) },
    {
      name: "agent/mixed",
      events: [...runs("claude", 1), ...runs("codex", 1)],
    },
  ];
  const split = splitByCohort(branches, (b) => b.events);
  assertEquals(
    split.speaking.map((c) => [c.agent, c.units.length, c.runs]),
    [["claude", 2, 7], ["codex", 1, 6]],
  );
  assertEquals(split.unattributedUnits, 1);
  assertEquals(split.unattributedRuns, 2);
});

// ── the dominant client's version eras ──────────────────────────────────────

/** An MCP-surface event declaring a client name and version. */
function mcpRun(
  name: string,
  version: string,
  at: string,
  recognizedAs?: string,
): VerbEvent {
  return verb({
    at,
    surface: "mcp",
    driver: {
      session: "mcp:1",
      json: false,
      tty: false,
      ci: false,
      ...(recognizedAs !== undefined
        ? {
          agent_signals: [{
            agent: recognizedAs,
            source: "mcp-client" as const,
            markers: ["clientInfo.name"],
          }],
        }
        : {}),
      mcp_client: { name, version },
    },
  });
}

Deno.test("cohort eras: only the dominant client's recorded version changes are boundaries", () => {
  const events = [
    mcpRun("codex-mcp-client", "0.145.0", t(0), "codex"),
    mcpRun("claude-code", "2.1.205", t(1), "claude"),
    mcpRun("codex-mcp-client", "0.145.0", t(2), "codex"),
    // The minority client's change must contribute nothing.
    mcpRun("claude-code", "2.1.217", t(3), "claude"),
    mcpRun("codex-mcp-client", "0.146.0", t(4), "codex"),
  ];
  const eras = dominantClientEras(events);
  assertEquals(eras.label, "Codex");
  assertEquals(eras.boundaries, [
    { at: t(4), from: "0.145.0", to: "0.146.0" },
  ]);
  assertEquals(eras.eraOf(events[0] as VerbEvent), 0);
  assertEquals(eras.eraOf(events[4] as VerbEvent), 1);
  assertEquals(eras.versionOf(0), "0.145.0");
  assertEquals(eras.versionOf(1), "0.146.0");
});

Deno.test("cohort eras: first sight of a client is not a boundary", () => {
  const eras = dominantClientEras([
    verb({ at: t(0) }),
    mcpRun("claude-code", "2.1.205", t(1), "claude"),
    mcpRun("claude-code", "2.1.205", t(2), "claude"),
  ]);
  assertEquals(eras.boundaries, []);
  assertEquals(eras.label, "Claude Code");
});

Deno.test("cohort eras: a version-blind stream has no boundaries and no error — a silent absence", () => {
  // The observed fleet holds a corpus whose cohort was attributed entirely
  // through process evidence: zero client declarations. That cohort simply
  // has nothing to bisect.
  const eras = dominantClientEras(runs("claude", 8));
  assertEquals(eras.label, undefined);
  assertEquals(eras.boundaries, []);
  assertEquals(eras.eraOf(verb({})), 0);
  assertEquals(eras.versionOf(0), undefined);
});

Deno.test("cohort eras: an unrecognized dominant client keeps its raw declared name", () => {
  const eras = dominantClientEras([
    mcpRun("mystery-agent", "7.0.0", t(0)),
    mcpRun("mystery-agent", "7.1.0", t(1)),
  ]);
  assertEquals(eras.label, "mystery-agent");
  assertEquals(eras.boundaries, [{ at: t(1), from: "7.0.0", to: "7.1.0" }]);
});
