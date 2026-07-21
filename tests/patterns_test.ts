/**
 * Detector-registry unit tests — parameterized off {@link DETECTORS}, the single
 * source of truth, so a new detector auto-enrols into every harness here:
 *
 *  - **the fixture obligation**: every detector must supply a firing stream, a
 *    quiet stream (or record why a quiet state cannot exist), and a sparse
 *    stream — the test fails BY NAME for a detector that arrives without them;
 *  - **the three behaviours**: firing fixtures produce at least one finding with
 *    non-empty plain-count evidence; quiet fixtures clear the threshold and
 *    find nothing; sparse fixtures sit below the threshold and stay silent;
 *  - **the segmentation promises, class-wide**: a stream of CI-marked runs (or
 *    dry-run previews) reaches NO detector at all;
 *  - **epoch/writer attribution**: a trend split by a config change or release
 *    names the boundary instead of comparing across it or going silent;
 *  - **coarse-history honesty**: rotation digests extend the red-rate series,
 *    marked coarse.
 */

import { assert, assertEquals } from "@std/assert";
import {
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  AGENT_SIGNAL_SOURCES,
} from "../src/shared/agent_catalogue.ts";
import {
  buildStreamFacts,
  comparableTail,
  type Detector,
  type DetectorReport,
  DETECTORS,
  driverAgent,
  driverKind,
  runDetector,
} from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import {
  DETECTOR_FAMILIES,
  type DetectorFamily,
} from "../src/shared/result_schemas.ts";

// ── fixture builders ────────────────────────────────────────────────────────

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
    writer: "1.0.0",
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

/** A red `done` whose failure reached the tests. */
function redDone(over: Partial<VerbEvent> = {}): Partial<VerbEvent> {
  return {
    verb: "done",
    outcome: "failed",
    failed_stage: "check/test",
    ...over,
  };
}

/** A timed gate step. */
function step(
  label: string,
  durationS: number,
  group = "Check & test",
): NonNullable<VerbEvent["steps"]>[number] {
  return {
    label,
    kind: "job",
    outcome: "ok",
    disposition: "run",
    group,
    duration_s: durationS,
  };
}

/** A `standards` reading carried on a verb event. */
function reading(
  name: string,
  value: number,
  limit: number,
): NonNullable<VerbEvent["standards"]>[number] {
  return { name, value, limit, direction: "up", verdict: "improved" };
}

/** A driver bundle carrying one invocation-scoped identity signal. */
function signalledDriver(agent: string, marker: string): VerbEvent["driver"] {
  return {
    session: "cli:1",
    json: true,
    tty: false,
    ci: false,
    agent_signals: [
      { agent, source: "process-environment", markers: [marker] },
    ],
  };
}

/** An MCP call whose client declaration the recorder did not recognize. */
function unknownMcpClient(name: string): Partial<VerbEvent> {
  return {
    surface: "mcp",
    driver: {
      session: "mcp:1",
      json: false,
      tty: false,
      ci: false,
      mcp_client: { name, version: "1.0.0" },
    },
  };
}

// ── the fixture table (keyed by detector id — the forcing tie) ──────────────

/** A quiet state that cannot exist gets a recorded reason instead of events. */
type QuietFixture = LogbookEvent[] | { impossible: string };

interface DetectorFixtures {
  /** Clears the threshold and produces at least one finding. */
  firing: LogbookEvent[];
  /** Clears the threshold and produces none. */
  quiet: QuietFixture;
  /** Sits below the threshold (and carries no boundary to attribute). */
  sparse: LogbookEvent[];
  /** Configured native providers the stream is read against, for detectors
   * whose verdict depends on config context (shared by all three streams). */
  configured_agents?: string[];
}

const FIXTURES: Record<string, DetectorFixtures> = {
  "done-thrash": {
    firing: run([redDone(), redDone(), redDone(), { verb: "done" }]),
    quiet: run([redDone(), { verb: "done" }, redDone(), { verb: "done" }]),
    sparse: run([redDone(), redDone(), redDone()]).slice(0, 3),
  },
  "refusal-loop": {
    firing: run([
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
    ]),
    quiet: run([
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
      { verb: "accept", outcome: "refused", error: "precondition_failed" },
      { verb: "standards", outcome: "refused", error: "unknown_standard" },
    ]),
    sparse: run([
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
      { verb: "update", outcome: "refused", error: "dirty_worktree" },
    ]),
  },
  "skipped-prepare": {
    firing: run([redDone(), redDone(), redDone(), { verb: "done" }]),
    quiet: run([redDone(), { verb: "prepare" }, redDone(), { verb: "done" }]),
    sparse: run([redDone(), redDone(), { verb: "done" }]),
  },
  "dirty-done-churn": {
    firing: run([
      redDone({ clean: false, tree: "t1" }),
      redDone({ clean: false, tree: "t2" }),
      redDone({ clean: false, tree: "t3" }),
      redDone({ clean: false, tree: "t4" }),
      redDone({ clean: false, tree: "t5" }),
      { verb: "done" },
    ]),
    quiet: run([
      { verb: "done" },
      { verb: "done" },
      { verb: "done" },
      { verb: "done" },
      { verb: "done" },
    ]),
    sparse: run([
      redDone({ clean: false, tree: "t1" }),
      redDone({ clean: false, tree: "t2" }),
      redDone({ clean: false, tree: "t3" }),
      redDone({ clean: false, tree: "t4" }),
    ]),
  },
  "trunk-edits": {
    firing: run([
      { verb: "status", branch: "main", clean: false, tree: "t1" },
      { verb: "prepare", branch: "main", clean: false, tree: "t2" },
      { verb: "test", branch: "main", clean: false, tree: "t3" },
    ]),
    quiet: run([
      { verb: "status", branch: "main" },
      { verb: "status", branch: "main" },
      { verb: "status", branch: "main" },
    ]),
    sparse: run([
      { verb: "status", branch: "main", clean: false, tree: "t1" },
      { verb: "status", branch: "main", clean: false, tree: "t2" },
    ]),
  },
  "force-habit": {
    firing: run([
      { verb: "standards", flags: ["force"] },
      { verb: "standards", flags: ["force"] },
      { verb: "worktree drop", flags: ["force"] },
    ]),
    quiet: run([
      { verb: "standards", flags: ["force"] },
      { verb: "status" },
      { verb: "status" },
    ]),
    sparse: run([
      { verb: "standards", flags: ["force"] },
      { verb: "standards", flags: ["force"] },
    ]),
  },
  "docs-gap": {
    firing: run([
      { verb: "help", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "help", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "help", target: "quickstart" },
      { verb: "map", target: "overview" },
      { verb: "help", target: "standards" },
    ]),
    quiet: run([
      { verb: "help", target: "a" },
      { verb: "help", target: "b" },
      { verb: "help", target: "c" },
      { verb: "map", target: "d" },
      { verb: "map", target: "e" },
    ]),
    sparse: run([
      { verb: "help", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "help", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "help", target: "quickstart" },
      { verb: "map", target: "overview" },
    ]),
  },
  "abandoned-worktrees": {
    firing: [
      verb({ at: t(0), branch: "agent/stale", ...redDone() }),
      verb({ at: t(24 * 10), branch: "agent/alive", verb: "done" }),
    ],
    quiet: [
      verb({ at: t(0), branch: "agent/a", verb: "done" }),
      verb({ at: t(24 * 10), branch: "agent/b", verb: "done" }),
    ],
    sparse: [verb({ at: t(0), branch: "agent/only", ...redDone() })],
  },
  "sequence-anomaly": {
    firing: run([
      redDone({ branch: "agent/rush" }),
      { verb: "accept", branch: "agent/rush" },
    ]),
    quiet: run([
      { verb: "done", branch: "agent/calm" },
      { verb: "accept", branch: "agent/calm" },
    ]),
    sparse: run([redDone()]),
  },
  "identity-gap": {
    firing: run([
      unknownMcpClient("mystery-agent"),
      unknownMcpClient("mystery-agent"),
      unknownMcpClient("mystery-agent"),
      { driver: signalledDriver("claude", "CLAUDECODE") },
      { driver: signalledDriver("claude", "CLAUDECODE") },
    ]),
    quiet: run([
      { driver: signalledDriver("claude", "CLAUDECODE") },
      { driver: signalledDriver("claude", "CLAUDECODE") },
      { driver: signalledDriver("codex", "CODEX_THREAD_ID") },
      { driver: signalledDriver("codex", "CODEX_THREAD_ID") },
      { driver: signalledDriver("codex", "CODEX_THREAD_ID") },
    ]),
    sparse: run([
      unknownMcpClient("mystery-agent"),
      unknownMcpClient("mystery-agent"),
      unknownMcpClient("mystery-agent"),
      { driver: signalledDriver("claude", "CLAUDECODE") },
    ]),
  },
  "provider-fit": {
    configured_agents: ["codex"],
    firing: run(
      Array.from({ length: 5 }, () => ({
        driver: signalledDriver("claude", "CLAUDECODE"),
      })),
    ),
    quiet: run(
      Array.from({ length: 5 }, () => ({
        driver: signalledDriver("codex", "CODEX_THREAD_ID"),
      })),
    ),
    sparse: run(
      Array.from({ length: 4 }, () => ({
        driver: signalledDriver("claude", "CLAUDECODE"),
      })),
    ),
  },
  "dominant-stage": {
    firing: run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        steps: [step("lint", 30), step("test", 5)],
      })),
    ),
    quiet: run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        steps: [step("lint", 5), step("test", 5), step("build", 5)],
      })),
    ),
    sparse: run(
      Array.from({ length: 4 }, () => ({
        verb: "done",
        steps: [step("lint", 30)],
      })),
    ),
  },
  "duration-creep": {
    firing: run(
      Array.from({ length: 8 }, (_, i) => ({
        verb: "done",
        duration_ms: i < 4 ? 10_000 : 20_000,
        change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
      })),
    ),
    quiet: run(
      Array.from({ length: 8 }, () => ({
        verb: "done",
        duration_ms: 10_000,
        change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
      })),
    ),
    sparse: run(
      Array.from({ length: 4 }, () => ({ verb: "done", duration_ms: 10_000 })),
    ),
  },
  "fix-stage-idle": {
    firing: run(
      Array.from({ length: 10 }, () => ({
        verb: "prepare",
        steps: [step("fmt", 4, "Fix"), step("lint", 2, "Check")],
      })),
    ),
    quiet: run(
      Array.from({ length: 10 }, () => ({
        verb: "prepare",
        steps: [step("fmt", 1, "Fix"), step("lint", 2, "Check")],
      })),
    ),
    sparse: run(
      Array.from({ length: 9 }, () => ({
        verb: "prepare",
        steps: [step("fmt", 4, "Fix")],
      })),
    ),
  },
  "recurring-diagnostic": {
    firing: run([
      redDone({
        branch: "agent/a",
        diagnostics: [{ tool: "lint", rule: "no-x" }],
      }),
      redDone({
        branch: "agent/a",
        diagnostics: [{ tool: "lint", rule: "no-x" }],
      }),
      redDone({
        branch: "agent/b",
        diagnostics: [{ tool: "lint", rule: "no-x" }],
      }),
      redDone({
        branch: "agent/b",
        diagnostics: [{ tool: "lint", rule: "no-x" }],
      }),
      redDone({
        branch: "agent/c",
        diagnostics: [{ tool: "lint", rule: "no-x" }],
      }),
    ]),
    quiet: run(
      Array.from({ length: 5 }, () => (
        redDone({ diagnostics: [{ tool: "lint", rule: "no-x" }] })
      )),
    ),
    sparse: run([
      redDone({ diagnostics: [{ tool: "lint", rule: "no-x" }] }),
      redDone({ diagnostics: [{ tool: "lint", rule: "no-x" }] }),
      redDone({ diagnostics: [{ tool: "lint", rule: "no-x" }] }),
      redDone({ diagnostics: [{ tool: "lint", rule: "no-x" }] }),
    ]),
  },
  "same-tree-flake": {
    firing: run([
      redDone({ head: "cafe123" }),
      { verb: "done", head: "cafe123" },
    ]),
    quiet: run([
      { verb: "done", head: "cafe123" },
      { verb: "done", head: "cafe123" },
    ]),
    sparse: run([
      { verb: "done", head: "cafe123" },
      { verb: "done", head: "beef456" },
    ]),
  },
  "loops-to-green": {
    firing: run([
      ...Array.from({ length: 6 }, () => redDone({ branch: "agent/grind" })),
      {
        verb: "done",
        branch: "agent/grind",
        change: { files: 3, insertions: 40, deletions: 5, commits: 2 },
      },
      { verb: "done", branch: "agent/swift" },
    ]),
    quiet: run([
      redDone({ branch: "agent/a" }),
      { verb: "done", branch: "agent/a" },
      redDone({ branch: "agent/b" }),
      { verb: "done", branch: "agent/b" },
    ]),
    sparse: run([redDone({ branch: "agent/a" }), {
      verb: "done",
      branch: "agent/a",
    }]),
  },
  "cycle-time": {
    firing: run([
      { verb: "start", branch: "main", target: "agent/a" },
      { verb: "accept", branch: "agent/a" },
      { verb: "start", branch: "main", target: "agent/b" },
      { verb: "accept", branch: "agent/b" },
      { verb: "start", branch: "main", target: "agent/c" },
      { verb: "accept", branch: "agent/c" },
    ]),
    quiet: {
      impossible:
        "informational: three or more completed cycles always yield the report",
    },
    sparse: run([
      { verb: "start", branch: "main", target: "agent/a" },
      { verb: "accept", branch: "agent/a" },
      { verb: "start", branch: "main", target: "agent/b" },
      { verb: "accept", branch: "agent/b" },
    ]),
  },
  "giant-commit-landing": {
    firing: run([
      {
        verb: "done",
        branch: "agent/monolith",
        change: { files: 12, insertions: 480, deletions: 60, commits: 1 },
      },
      {
        verb: "done",
        branch: "agent/tidy",
        change: { files: 4, insertions: 60, deletions: 10, commits: 5 },
      },
      {
        verb: "done",
        branch: "agent/small",
        change: { files: 1, insertions: 8, deletions: 2, commits: 1 },
      },
    ]),
    quiet: run([
      {
        verb: "done",
        branch: "agent/a",
        change: { files: 12, insertions: 480, deletions: 60, commits: 6 },
      },
      {
        verb: "done",
        branch: "agent/b",
        change: { files: 4, insertions: 60, deletions: 10, commits: 3 },
      },
      {
        verb: "done",
        branch: "agent/c",
        change: { files: 1, insertions: 8, deletions: 2, commits: 1 },
      },
    ]),
    sparse: run([
      {
        verb: "done",
        branch: "agent/a",
        change: { files: 12, insertions: 480, deletions: 60, commits: 1 },
      },
      {
        verb: "done",
        branch: "agent/b",
        change: { files: 4, insertions: 60, deletions: 10, commits: 3 },
      },
    ]),
  },
  "update-friction": {
    firing: run(
      Array.from({ length: 6 }, (_, i) => ({
        verb: "update",
        update: i < 3
          ? { behind: 1, files: 2, overlap: 0 }
          : { behind: 4, files: 9, overlap: 3 },
      })),
    ),
    quiet: run(
      Array.from({ length: 6 }, () => ({
        verb: "update",
        update: { behind: 1, files: 2, overlap: 0 },
      })),
    ),
    sparse: run(
      Array.from({ length: 5 }, () => ({
        verb: "update",
        update: { behind: 1, files: 2, overlap: 0 },
      })),
    ),
  },
  "standard-trajectory": {
    firing: run(
      Array.from({ length: 5 }, (_, i) => ({
        verb: "done",
        standards: [reading("cov", 81 + i, 80)],
      })),
    ),
    quiet: {
      impossible:
        "informational: five or more readings of a standard always yield its trajectory",
    },
    sparse: run(
      Array.from({ length: 4 }, (_, i) => ({
        verb: "done",
        standards: [reading("cov", 81 + i, 80)],
      })),
    ),
  },
  "red-rate-history": {
    firing: [
      verb({ at: "2026-05-02T10:00:00.000Z" }),
      verb({ at: "2026-05-03T10:00:00.000Z", ...redDone() }),
      verb({ at: "2026-06-02T10:00:00.000Z" }),
      verb({ at: "2026-06-03T10:00:00.000Z", ...redDone() }),
      verb({ at: "2026-07-02T10:00:00.000Z" }),
      verb({ at: "2026-07-03T10:00:00.000Z" }),
    ],
    quiet: {
      impossible:
        "informational: three or more months of outcomes always yield the series",
    },
    sparse: [
      verb({ at: "2026-06-02T10:00:00.000Z" }),
      verb({ at: "2026-07-02T10:00:00.000Z", ...redDone() }),
    ],
  },
};

// ── the registry invariants ─────────────────────────────────────────────────

Deno.test("patterns registry: ids are unique, kebab-case, and fully described", () => {
  const ids = DETECTORS.map((d) => d.id);
  assertEquals(ids.length, new Set(ids).size, "duplicate detector id");
  for (const d of DETECTORS) {
    assert(/^[a-z][a-z0-9-]*$/.test(d.id), `id "${d.id}" is not kebab-case`);
    assert(d.title.length > 0, `${d.id}: empty title`);
    assert(d.next_step.length > 0, `${d.id}: empty next step`);
    assert(
      Number.isInteger(d.threshold) && d.threshold >= 1,
      `${d.id}: threshold must be a positive integer`,
    );
  }
});

Deno.test("patterns registry: every family has at least one member", () => {
  const populated = new Set<DetectorFamily>(DETECTORS.map((d) => d.family));
  assertEquals([...populated].sort(), [...DETECTOR_FAMILIES].sort());
});

Deno.test("patterns registry: every detector supplies its three fixtures", () => {
  assertEquals(
    Object.keys(FIXTURES).sort(),
    DETECTORS.map((d) => d.id).sort(),
    "the fixture table must cover exactly the registry — a new detector " +
      "enrols here with firing/quiet/sparse streams (see DetectorFixtures)",
  );
});

// ── the three behaviours, parameterized ─────────────────────────────────────

function fixturesOf(d: Detector): DetectorFixtures {
  const fixtures = FIXTURES[d.id];
  assert(fixtures !== undefined, `no fixtures for ${d.id}`);
  return fixtures;
}

function report(d: Detector, events: LogbookEvent[]): DetectorReport {
  return runDetector(
    d,
    buildStreamFacts(events, "main", fixturesOf(d).configured_agents ?? []),
  );
}

for (const d of DETECTORS) {
  Deno.test(`patterns detector ${d.id}: fires on its firing stream with plain-count evidence`, () => {
    const r = report(d, fixturesOf(d).firing);
    assertEquals(
      r.status,
      "fired",
      `${d.id}: firing fixture must fire (considered ${r.considered}, threshold ${d.threshold})`,
    );
    assert(r.findings.length > 0, `${d.id}: firing fixture found nothing`);
    for (const f of r.findings) {
      assert(f.observed.length > 0, `${d.id}: empty observation`);
      const values = Object.values(f.evidence);
      assert(values.length > 0, `${d.id}: a finding carries no evidence`);
      for (const v of values) {
        assert(Number.isFinite(v), `${d.id}: non-finite evidence value`);
      }
      assert(f.strength > 0, `${d.id}: findings must carry a ranking strength`);
    }
  });

  Deno.test(`patterns detector ${d.id}: stays quiet with evidence but no pattern`, () => {
    const quiet = fixturesOf(d).quiet;
    if (!Array.isArray(quiet)) {
      assert(
        quiet.impossible.length > 0,
        `${d.id}: an impossible quiet state needs its recorded reason`,
      );
      return;
    }
    const r = report(d, quiet);
    assertEquals(
      r.status,
      "quiet",
      `${d.id}: quiet fixture must clear the threshold and find nothing (considered ${r.considered}, threshold ${d.threshold})`,
    );
    assertEquals(r.findings, []);
  });

  Deno.test(`patterns detector ${d.id}: reports insufficient evidence below threshold`, () => {
    const r = report(d, fixturesOf(d).sparse);
    assertEquals(
      r.status,
      "insufficient-evidence",
      `${d.id}: sparse fixture must sit below the threshold (considered ${r.considered}, threshold ${d.threshold})`,
    );
    assertEquals(
      r.findings,
      [],
      `${d.id}: below threshold a detector reports insufficient evidence, never findings`,
    );
  });

  Deno.test(`patterns detector ${d.id}: CI noise and previews reach no detector`, () => {
    const firing = fixturesOf(d).firing;
    const ci = firing.map((e): LogbookEvent =>
      e.kind === "verb" ? { ...e, driver: { ...e.driver, ci: true } } : e
    );
    // Prune digests are month-level history, not per-run driver signals, so
    // the CI cross-cut asserts on verb-event-driven populations only.
    const ciReport = report(d, ci.filter((e) => e.kind === "verb"));
    assertEquals(ciReport.considered, 0, `${d.id}: CI runs must not qualify`);
    assertEquals(ciReport.findings, [], `${d.id}: CI runs must not fire`);

    const previews = firing.map((e): LogbookEvent =>
      e.kind === "verb" ? { ...e, dry_run: true } : e
    );
    const previewReport = report(
      d,
      previews.filter((e) => e.kind === "verb"),
    );
    assertEquals(
      previewReport.considered,
      0,
      `${d.id}: dry-run previews must not qualify`,
    );
    assertEquals(previewReport.findings, []);
  });
}

// ── driver scoring from identity signals ────────────────────────────────────

/** One identity-evidence bundle for a driver-fact fixture. */
function signal(
  agent: string,
  source: (typeof AGENT_SIGNAL_SOURCES)[number],
  marker = "MARKER",
): NonNullable<NonNullable<VerbEvent["driver"]>["agent_signals"]>[number] {
  return { agent, source, markers: [marker] };
}

Deno.test("patterns driver scoring: every signal source behaves per its classified lifetime", () => {
  for (const source of AGENT_SIGNAL_SOURCES) {
    const lifetime = AGENT_SIGNAL_SOURCE_LIFETIMES[source];
    const quiet = verb({
      driver: {
        json: false,
        tty: false,
        ci: false,
        agent_signals: [signal("claude", source)],
      },
    });
    const interactive = verb({
      driver: {
        json: false,
        tty: true,
        ci: false,
        agent_signals: [signal("claude", source)],
      },
    });
    if (lifetime === "invocation") {
      assertEquals(
        driverKind(quiet),
        "agent",
        `${source}: an invocation-scoped signal marks an unmarked CLI agent`,
      );
      assertEquals(
        driverKind(interactive),
        "unknown",
        `${source}: a signal against a terminal is ambiguous — revoke the ` +
          `human verdict, never claim agent`,
      );
    } else {
      assertEquals(
        driverKind(quiet),
        "unknown",
        `${source}: ambient evidence must move nothing`,
      );
      assertEquals(
        driverKind(interactive),
        "human",
        `${source}: ambient evidence must move nothing`,
      );
    }
  }
});

Deno.test("patterns driver attribution: one identity names the driver; disagreement or ambient-only evidence names nothing", () => {
  const corroborated = verb({
    driver: {
      json: true,
      tty: false,
      ci: false,
      agent_signals: [
        signal("claude", "process-environment", "CLAUDECODE"),
        signal("claude", "mcp-client", "clientInfo.name"),
      ],
    },
  });
  assertEquals(driverAgent(corroborated), "claude");
  const disagreeing = verb({
    driver: {
      json: true,
      tty: false,
      ci: false,
      agent_signals: [
        signal("claude", "process-environment", "CLAUDECODE"),
        signal("codex", "process-environment", "CODEX_THREAD_ID"),
      ],
    },
  });
  assertEquals(driverAgent(disagreeing), undefined);
  const ambientOnly = verb({
    driver: {
      json: true,
      tty: false,
      ci: false,
      agent_signals: [signal("devin", "host-filesystem", "/opt/.devin")],
    },
  });
  assertEquals(driverAgent(ambientOnly), undefined);
  assertEquals(driverAgent(verb({})), undefined);
});

Deno.test("patterns driver scoring: a signalled interactive-looking run re-enters the analysis population", () => {
  const events = FIXTURES["done-thrash"]?.firing.map((e): LogbookEvent =>
    e.kind === "verb"
      ? {
        ...e,
        driver: {
          session: "cli:9",
          json: false,
          tty: true,
          ci: false,
          agent_signals: [
            signal("claude", "process-environment", "CLAUDECODE"),
          ],
        },
      }
      : e
  );
  assert(events !== undefined);
  const thrash = DETECTORS.find((d) => d.id === "done-thrash");
  assert(thrash !== undefined);
  const outcome = runDetector(thrash, buildStreamFacts(events, "main"));
  assertEquals(
    outcome.considered,
    events.length,
    "a terminal with an invocation-scoped signal is ambiguous, not human — " +
      "it must stay in the population",
  );
});

Deno.test("patterns provider-fit: a signal-only identity has nothing to configure and stays quiet", () => {
  const events = run(
    Array.from({ length: 5 }, () => ({
      driver: signalledDriver("replit", "REPL_ID"),
    })),
  );
  const fit = DETECTORS.find((d) => d.id === "provider-fit");
  assert(fit !== undefined);
  const outcome = runDetector(fit, buildStreamFacts(events, "main", []));
  assertEquals(outcome.considered, 5);
  assertEquals(
    outcome.findings,
    [],
    "an identity with no native integration must never be proposed as one",
  );
});

// ── segmentation and attribution ────────────────────────────────────────────

Deno.test("patterns segmentation: an interactive human's thrash never reads as agent pathology", () => {
  const human = FIXTURES["done-thrash"]?.firing.map((e): LogbookEvent =>
    e.kind === "verb"
      ? {
        ...e,
        driver: { session: "cli:9", json: false, tty: true, ci: false },
      }
      : e
  );
  assert(human !== undefined);
  const thrash = DETECTORS.find((d) => d.id === "done-thrash");
  assert(thrash !== undefined);
  const outcome = runDetector(thrash, buildStreamFacts(human, "main"));
  assertEquals(outcome.considered, 0);
  assertEquals(outcome.findings, []);
  const sample = human[0];
  assert(sample !== undefined && sample.kind === "verb");
  assertEquals(driverKind(sample), "human");
});

Deno.test("patterns attribution: a config change bounds the comparable window and is named", () => {
  const events: LogbookEvent[] = [
    ...run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        duration_ms: 10_000,
        epoch: "old1",
      })),
    ),
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: t(5),
      kind: "config-change",
      branch: "agent/task",
      sections: ["capabilities"],
      epoch: "new2",
    },
    ...Array.from(
      { length: 4 },
      (_, i) =>
        verb({
          at: t(6 + i),
          verb: "done",
          duration_ms: 30_000,
          epoch: "new2",
        }),
    ),
  ];
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(creep, buildStreamFacts(events, "main"));
  assertEquals(
    outcome.findings.length,
    1,
    "a boundary with too-short a tail must be attributed, not silent",
  );
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("[jobs]"),
    `the attribution must name the section that moved: ${finding.observed}`,
  );
  assert(
    finding.observed.includes("2026-07-01"),
    `the attribution must date the boundary: ${finding.observed}`,
  );
});

Deno.test("patterns attribution: a release boundary is attributed, never blended", () => {
  const events: LogbookEvent[] = [
    ...run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        duration_ms: 10_000,
        writer: "0.9.0",
      })),
    ),
    ...Array.from(
      { length: 4 },
      (_, i) =>
        verb({
          at: t(6 + i),
          verb: "done",
          duration_ms: 30_000,
          writer: "1.0.0",
        }),
    ),
  ];
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(creep, buildStreamFacts(events, "main"));
  assertEquals(outcome.findings.length, 1);
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("0.9.0 → 1.0.0"),
    `the attribution must name the release move: ${finding.observed}`,
  );
});

Deno.test("patterns attribution: comparableTail keeps only the newest epoch+writer run", () => {
  const events = [
    verb({ at: t(0), epoch: "a", writer: "1.0.0" }),
    verb({ at: t(1), epoch: "b", writer: "1.0.0" }),
    verb({ at: t(2), epoch: "b", writer: "1.0.0" }),
  ];
  const { tail, boundary } = comparableTail(events, events);
  assertEquals(tail.length, 2);
  assert(boundary !== undefined);
  assertEquals(boundary.prior, 1);
});

Deno.test("patterns attribution: a standard's series names the boundaries it crosses", () => {
  const events: LogbookEvent[] = [
    ...Array.from(
      { length: 3 },
      (_, i) =>
        verb({
          at: t(i),
          standards: [reading("cov", 70 + i, 80)],
          epoch: "old1",
        }),
    ),
    ...Array.from(
      { length: 3 },
      (_, i) =>
        verb({
          at: t(3 + i),
          standards: [reading("cov", 73 + i, 80)],
          epoch: "new2",
        }),
    ),
  ];
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  assertEquals(outcome.findings.length, 1);
  assert(
    outcome.findings[0]?.observed.includes("boundar"),
    `the series must note crossed boundaries: ${outcome.findings[0]?.observed}`,
  );
});

Deno.test("patterns trajectory: sustained slack proposes the pin", () => {
  const firing = FIXTURES["standard-trajectory"]?.firing;
  assert(firing !== undefined);
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const outcome = runDetector(trajectory, buildStreamFacts(firing, "main"));
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.next_step !== undefined && finding.next_step.includes("--pin"),
    `sustained slack should route to the pin: ${finding.next_step}`,
  );
});

Deno.test("patterns trajectory: the limit's own history reads out of pin events", () => {
  const events: LogbookEvent[] = [
    ...Array.from(
      { length: 5 },
      (_, i) =>
        verb({
          at: t(i),
          standards: [reading("cov", 81 + i, 80)],
        }),
    ),
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: t(6),
      kind: "pin",
      branch: "agent/task",
      standard: "cov",
      from: 80,
      to: 85,
      measured: 85,
    },
  ];
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("80 → 85"),
    `the limit's move must read out of the pin events: ${finding.observed}`,
  );
  assertEquals(finding.evidence.pins, 1);
});

Deno.test("patterns coarse history: prune digests extend the red-rate series, marked coarse", () => {
  const events: LogbookEvent[] = [
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: "2026-06-01T00:00:00.000Z",
      kind: "prune",
      removed: [
        { file: "2026-04.jsonl", events: 10, ok: 6, failed: 4 },
        { file: "2026-05.jsonl", events: 8, ok: 8 },
      ],
    },
    verb({ at: "2026-06-02T10:00:00.000Z" }),
    verb({ at: "2026-06-03T10:00:00.000Z", ...redDone() }),
  ];
  const history = DETECTORS.find((d) => d.id === "red-rate-history");
  assert(history !== undefined);
  const outcome = runDetector(history, buildStreamFacts(events, "main"));
  assertEquals(outcome.considered, 3);
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("2026-04 40% (coarse)"),
    `digest months must appear, marked coarse: ${finding.observed}`,
  );
  assert(
    finding.observed.includes("2026-06 50%"),
    `live months must appear unmarked: ${finding.observed}`,
  );
});
