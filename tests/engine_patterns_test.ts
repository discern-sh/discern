/**
 * `discern patterns` integration tests — the verb driven black-box through the
 * engine (`runAgent`) in scaffolded temp repos, proving the wired surface the
 * unit harness (`patterns_test.ts`) can't: the CLI's JSON envelope validates
 * against the published output schema, an empty logbook is a helpful
 * first-class state, a seeded logbook produces ranked plain-count findings,
 * the human rendering carries the advisory boundary, and the reset removes
 * exactly the logbook — nothing beside it — with a faithful dry-run.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { DISCERN_MARK } from "../src/shared/brand.ts";
import {
  assertTerminalTextIncludes,
  unexpectedTerminalControls,
  withTempDir,
} from "./helpers.ts";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import type { PatternsData } from "../src/shared/result_schemas.ts";
import {
  DETECTOR_FAMILIES,
  PATTERN_EVIDENCE_CONDITION_VALUES_MAX,
  PATTERN_FINDING_TONES,
  PATTERNS_FINDINGS_PER_DETECTOR,
  PATTERNS_SERIES_MAX_POINTS,
} from "../src/shared/patterns_vocabulary.ts";
import { HINTS } from "../src/shared/hints.ts";
import { TIPS } from "../src/shared/tips.ts";
import { displayWidth, sparkline } from "../src/lib/text.ts";
import { terminalMultiline } from "../src/lib/terminal.ts";
import { formatHumanNumber } from "../src/shared/human_number.ts";
import {
  PATTERNS_ATTENTION_HEADING,
  PATTERNS_ATTENTION_LIMIT,
  PATTERNS_FAMILY_SECTIONS,
  PATTERNS_TONE_RESULT_STATE,
  PATTERNS_TRAJECTORY_CAVEAT,
  patternsResult,
  STATS_EMPTY_DESCRIPTION,
  STATS_EMPTY_TITLE,
  STATS_PROVENANCE,
  STATS_SECTIONS,
} from "../src/engine/logbook/patterns.ts";
import {
  DETECTORS,
  inclusiveSpanDays,
} from "../src/engine/logbook/detectors.ts";
import { logbookArchiveDir } from "../src/engine/logbook/store.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";

/** One synthetic format-selected CLI event on its own branch. */
function seededEvent(
  at: string,
  outcome: "ok" | "failed",
  branch = "agent/seeded",
): string {
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:7", json: true, tty: false, ci: false },
    branch,
    head: "abc1234",
    clean: true,
    outcome,
    ...(outcome === "failed" ? { failed_stage: "check/test" } : {}),
    duration_ms: 1200,
    epoch: "e1",
  });
}

/** One timed gate run where two generated groups take most recorded job time. */
function seededGeneratorGateEvent(at: string): string {
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:8", json: true, tty: false, ci: false },
    branch: "agent/generated",
    head: "def5678",
    clean: true,
    outcome: "ok",
    duration_ms: 50_000,
    epoch: "e2",
    validation: {
      version: 1,
      state: {
        version: 1,
        complete: true,
        capture: "after-fix-build",
        elapsed_ms: 1,
        digest: "generated-state",
        components: {},
        counts: {
          index_entries: 1,
          tracked_paths: 0,
          untracked_paths: 0,
          submodules: 0,
        },
        bytes: {
          index_manifest: 40,
          tracked_content: 0,
          untracked_content: 0,
        },
        exclusions: [],
      },
      execution: {
        version: 1,
        complete: true,
        mode: "full-gate",
        writer: "9.9.9",
        config_digest: "generated-config",
        setup_digest: "generated-setup",
        jobs: [{
          id: "test",
          stage: "test",
          kind: "known",
          definition_digest: "test-definition",
          outcome: "passed",
          concurrent_siblings: true,
        }],
      },
    },
    steps: [
      {
        label: "generated:schemas",
        kind: "job",
        outcome: "ok",
        disposition: "run",
        group: "Build",
        duration_s: 20,
      },
      {
        label: "generated:docs",
        kind: "job",
        outcome: "ok",
        disposition: "run",
        group: "Build",
        duration_s: 10,
      },
      {
        label: "lint",
        kind: "job",
        outcome: "ok",
        disposition: "run",
        group: "Check & test",
        duration_s: 10,
      },
      {
        label: "test",
        kind: "job",
        outcome: "ok",
        disposition: "run",
        group: "Check & test",
        duration_s: 10,
      },
    ],
  });
}

/** One current Standard observation carrying Gate-owned pin evidence. */
function seededDecisionStandardEvent(at: string, value: number): string {
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:decision", json: true, tty: false, ci: false },
    branch: "agent/decision",
    head: `head-${value}`,
    clean: true,
    outcome: "ok",
    duration_ms: 1_000,
    epoch: "decision-epoch",
    standards: [{
      name: "coverage",
      direction: "up",
      limit: 80,
      margin: 2,
      measurement: "measured",
      value,
      verdict: "improved",
      pin_eligible: true,
      pin_target: value - 2,
    }],
  });
}

/** One complete v1 validation event for strict and cross-context findings. */
function seededValidationEvent(
  at: string,
  job: string,
  outcome: "passed" | "failed",
  mode: "full-gate" | "standalone-test",
  sibling = "lint",
  additionalSiblings: readonly string[] = [],
): string {
  const fullGate = mode === "full-gate";
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: fullGate ? "done" : "test",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:validation", json: true, tty: false, ci: false },
    branch: "agent/validation",
    head: "abc1234",
    clean: true,
    outcome: outcome === "failed" ? "failed" : "ok",
    duration_ms: 1_200,
    epoch: "validation-epoch",
    validation: {
      version: 1,
      state: {
        version: 1,
        complete: true,
        capture: fullGate ? "after-fix-build" : "before-test-group",
        elapsed_ms: 1,
        digest: "state-a",
        components: {},
        counts: {
          index_entries: 1,
          tracked_paths: 0,
          untracked_paths: 0,
          submodules: 0,
        },
        bytes: {
          index_manifest: 40,
          tracked_content: 0,
          untracked_content: 0,
        },
        exclusions: [],
      },
      execution: {
        version: 1,
        complete: true,
        mode,
        writer: "9.9.9",
        config_digest: "config-a",
        setup_digest: "setup-a",
        jobs: [
          {
            id: job,
            stage: "test",
            kind: "known",
            definition_digest: `definition-${job}`,
            outcome,
            concurrent_siblings: fullGate,
          },
          ...(fullGate
            ? [sibling, ...additionalSiblings].map((siblingId) => ({
              id: siblingId,
              stage: "check",
              kind: "known",
              definition_digest: `definition-${siblingId}`,
              outcome: "passed" as const,
              concurrent_siblings: true,
            }))
            : []),
        ],
      },
    },
  });
}

/** Seed one strict relationship and one mode/context relationship. */
async function seedValidationFindings(dir: string): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    [
      seededValidationEvent(
        "2026-07-01T10:00:00.000Z",
        "strict-test",
        "failed",
        "standalone-test",
      ),
      seededValidationEvent(
        "2026-07-01T11:00:00.000Z",
        "strict-test",
        "passed",
        "standalone-test",
      ),
      seededValidationEvent(
        "2026-07-01T12:00:00.000Z",
        "context-test",
        "failed",
        "standalone-test",
      ),
      seededValidationEvent(
        "2026-07-01T13:00:00.000Z",
        "context-test",
        "passed",
        "full-gate",
      ),
    ].join("\n") + "\n",
  );
}

/** Seed more controlled sibling contexts than one condition may display. */
async function seedHighCardinalityValidationFinding(
  dir: string,
): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  const contexts = PATTERN_EVIDENCE_CONDITION_VALUES_MAX + 1;
  const largeRoster = Array.from(
    { length: 200 },
    (_, index) => `roster-${String(index + 1).padStart(3, "0")}`,
  );
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    Array.from({ length: contexts }, (_, index) =>
      seededValidationEvent(
        `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
        "bounded-context-test",
        index === 0 ? "failed" : "passed",
        "full-gate",
        `sibling-${String(index + 1).padStart(2, "0")}`,
        index === 0 ? largeRoster : [],
      )).join("\n") + "\n",
  );
}

Deno.test("patterns calendar span counts inclusive UTC dates, not elapsed 24-hour blocks", () => {
  assertEquals(
    inclusiveSpanDays(
      "2026-07-20T23:59:00.000Z",
      "2026-07-21T00:01:00.000Z",
    ),
    2,
  );
  assertEquals(
    inclusiveSpanDays(
      "2026-07-20T01:00:00.000Z",
      "2026-07-22T23:00:00.000Z",
    ),
    3,
  );
  assertEquals(
    inclusiveSpanDays(
      "2026-07-20T23:00:00-02:00",
      "2026-07-21T02:00:00.000Z",
    ),
    1,
    "the displayed/reporting calendar is UTC",
  );
});

/** Seed one month file holding a done-thrash stream, a torn line, and a pin. */
async function seedLogbook(dir: string): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-06.jsonl"),
    [
      seededEvent("2026-06-01T10:00:00.000Z", "failed"),
      seededEvent("2026-06-01T11:00:00.000Z", "failed"),
      seededEvent("2026-06-01T12:00:00.000Z", "failed"),
      seededEvent("2026-06-01T13:00:00.000Z", "ok"),
      // One identity-bearing run: the invocation-scoped Claude marker names
      // the driver; the ambient host marker beside it must attribute nothing.
      JSON.stringify({
        schema: 1,
        at: "2026-06-01T13:30:00.000Z",
        kind: "verb",
        verb: "status",
        surface: "cli",
        writer: "9.9.9",
        driver: {
          session: "cli:7",
          json: true,
          tty: false,
          ci: false,
          agent_signals: [
            {
              agent: "claude",
              source: "process-environment",
              markers: ["CLAUDECODE"],
            },
            {
              agent: "devin",
              source: "host-filesystem",
              markers: ["/opt/.devin"],
            },
          ],
        },
        branch: "agent/seeded",
        head: "abc1234",
        clean: true,
        outcome: "ok",
        duration_ms: 100,
        epoch: "e1",
      }),
      '{"schema":1,"kind":"ver',
      JSON.stringify({
        schema: 1,
        at: "2026-06-01T14:00:00.000Z",
        kind: "pin",
        branch: "agent/seeded",
        standard: "cov",
        from: 80,
        to: 85,
        measured: 85,
      }),
    ].join("\n") + "\n",
  );
}

/** Seed one identical red-streak arc per branch, so each branch-scoped
 * detector that fires produces one finding per branch — a corpus whose
 * uncapped finding count scales with recorded history. */
async function seedManyBranchLogbook(
  dir: string,
  branches: number,
): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  const lines: string[] = [];
  for (let b = 0; b < branches; b++) {
    const day = String(1 + (b % 27)).padStart(2, "0");
    const branch = `agent/streak-${b}`;
    for (
      const [hour, outcome] of [
        ["10", "failed"],
        ["11", "failed"],
        ["12", "failed"],
        ["13", "ok"],
      ] as const
    ) {
      lines.push(
        seededEvent(
          `2026-06-${day}T${hour}:0${b % 10}:00.000Z`,
          outcome,
          branch,
        ),
      );
    }
  }
  await Deno.writeTextFile(
    join(logDir, "2026-06.jsonl"),
    lines.join("\n") + "\n",
  );
}

/** Seed the minimum comparable timed history for generator gate-share. */
async function seedGeneratorGateLogbook(dir: string): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    Array.from({ length: 5 }, (_, index) =>
      seededGeneratorGateEvent(
        `2026-07-01T1${index}:00:00.000Z`,
      )).join("\n") + "\n",
  );
}

/** Seed historical MCP events whose writer retained raw metadata but had no
 * catalogue match to store. Five Cursor calls must become attributable under
 * current catalogue knowledge; the genuinely unknown client must stay loud. */
async function seedHistoricalMcpIdentityLogbook(dir: string): Promise<string> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const path = join(logDir, "2026-06.jsonl");
  await Deno.mkdir(logDir, { recursive: true });
  const events = [
    ...Array.from({ length: 5 }, (_, index) => ({
      name: "cursor-vscode",
      index,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      name: "mystery-agent",
      index: index + 5,
    })),
  ].map(({ name, index }) => ({
    schema: 1,
    at: new Date(Date.UTC(2026, 5, 1, index)).toISOString(),
    kind: "verb",
    verb: "status",
    surface: "mcp",
    writer: "0.0.old",
    driver: {
      session: "mcp:historical",
      json: false,
      tty: false,
      ci: false,
      mcp_client: { name, version: "1" },
    },
    branch: "agent/historical",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 100,
    epoch: "e1",
  }));
  const raw = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await Deno.writeTextFile(path, raw);
  return path;
}

/** Seed two complete start→green→accept arcs plus one pin: enough history to
 * put a number in every stats section. Hours are chosen so the check time and
 * both cycle durations land on round, assertable values; every event carries
 * an invocation-scoped identity signal so the agents section speaks, and the
 * green `done` runs carry standard readings so the ratchet's most-improved
 * reading has a trajectory to read. */
async function seedStatsLogbook(dir: string): Promise<void> {
  const events: Record<string, unknown>[] = [];
  const add = (hour: number, over: Record<string, unknown>): void => {
    events.push({
      schema: 1,
      at: new Date(Date.UTC(2026, 6, 1, hour)).toISOString(),
      kind: "verb",
      surface: "cli",
      writer: "9.9.9",
      driver: {
        session: "cli:stats",
        json: true,
        tty: false,
        ci: false,
        agent_signals: [{
          agent: "claude",
          source: "process-environment",
          markers: ["CLAUDECODE"],
        }],
      },
      head: `head-${hour}`,
      clean: true,
      outcome: "ok",
      duration_ms: 1_000,
      epoch: "e1",
      ...over,
    });
  };
  add(0, { verb: "start", branch: "main", target: "agent/b1" });
  add(1, {
    verb: "done",
    branch: "agent/b1",
    outcome: "failed",
    failed_stage: "check/test",
    duration_ms: 3_600_000,
    checkpoints: {
      fired: [{ id: "api-review", definition: "d1", subject: "s1" }],
    },
  });
  add(2, {
    verb: "done",
    branch: "agent/b1",
    duration_ms: 3_600_000,
    standards: [{ name: "coverage", direction: "up", limit: 80, value: 80 }],
    checkpoints: {
      declared: [{
        id: "api-review",
        conclusion: "met",
        revised: false,
        definition: "d1",
        subject: "s1",
        elapsed_ms: 60_000,
      }],
    },
  });
  add(3, {
    verb: "accept",
    branch: "agent/b1",
    change: { files: 2, insertions: 120, deletions: 30, commits: 3 },
  });
  add(4, { verb: "start", branch: "main", target: "agent/b2" });
  add(5, {
    verb: "done",
    branch: "agent/b2",
    duration_ms: 3_600_000,
    standards: [{ name: "coverage", direction: "up", limit: 80, value: 84 }],
  });
  add(6, {
    verb: "accept",
    branch: "agent/b2",
    change: { files: 1, insertions: 10, deletions: 0, commits: 1 },
  });
  events.push({
    schema: 1,
    at: new Date(Date.UTC(2026, 6, 1, 7)).toISOString(),
    kind: "pin",
    branch: "agent/b2",
    standard: "coverage",
    from: 80,
    to: 85,
    measured: 85,
  });
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

/** Seed resolved and censored episodes for every initial follow-through family. */
async function seedHintFollowThroughLogbook(dir: string): Promise<void> {
  const events: Record<string, unknown>[] = [];
  let hour = 0;
  const cliDriver = {
    session: "cli:follow-through",
    json: true,
    tty: false,
    ci: false,
  };
  const add = (over: Record<string, unknown>): void => {
    events.push({
      schema: 1,
      at: new Date(Date.UTC(2026, 6, 1, hour++)).toISOString(),
      kind: "verb",
      verb: "status",
      surface: "cli",
      writer: "9.9.9",
      driver: cliDriver,
      branch: "agent/seeded",
      head: `head-${hour}`,
      clean: true,
      outcome: "ok",
      duration_ms: 100,
      epoch: "e1",
      ...over,
    });
  };

  // Branch update: four firings produce three ignored repeats and one
  // cross-surface censored tail.
  for (let i = 0; i < 4; i += 1) {
    add({
      verb: "status",
      hint_ids: [HINTS["status-branch-behind"].id],
    });
  }
  add({
    verb: "update",
    surface: "mcp",
    driver: {
      session: "mcp:other",
      json: false,
      tty: false,
      ci: false,
    },
  });

  // Red-gate remedy: two prepare actions, one next-done boundary, and a
  // trailing unresolved firing.
  add({
    verb: "done",
    outcome: "failed",
    failed_stage: "check",
    hint_ids: [HINTS["gate-failure-check"].id],
  });
  add({ verb: "prepare" });
  add({
    verb: "done",
    outcome: "failed",
    failed_stage: "check",
    hint_ids: [HINTS["gate-failure-check"].id],
  });
  add({ verb: "done" });
  add({
    verb: "done",
    outcome: "failed",
    failed_stage: "check",
    hint_ids: [HINTS["gate-failure-check"].id],
  });
  add({ verb: "prepare" });
  add({
    verb: "done",
    outcome: "failed",
    failed_stage: "check",
    hint_ids: [HINTS["gate-failure-check"].id],
  });

  // Main-worktree-first: start, dirty-trunk activity, start, then one
  // cross-surface start that cannot be correlated to the CLI session.
  add({
    verb: "worktree ensure",
    branch: "main",
    hint_ids: [HINTS["ensure-main-worktree-first"].id],
  });
  add({ verb: "start", branch: "main" });
  add({
    verb: "worktree ensure",
    branch: "main",
    hint_ids: [HINTS["ensure-main-worktree-first"].id],
  });
  add({
    verb: "status",
    branch: "main",
    clean: false,
    tree: "dirty-main",
  });
  add({
    verb: "worktree ensure",
    branch: "main",
    hint_ids: [HINTS["ensure-main-worktree-first"].id],
  });
  add({ verb: "start", branch: "main" });
  add({
    verb: "worktree ensure",
    branch: "main",
    hint_ids: [HINTS["ensure-main-worktree-first"].id],
  });
  add({
    verb: "start",
    branch: "main",
    surface: "mcp",
    driver: {
      session: "mcp:other",
      json: false,
      tty: false,
      ci: false,
    },
  });

  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

/** Seed one attention tip and one fully-followed tip, including adoption over
 * MCP after a CLI desk showing. */
async function seedTipAdoptionLogbook(dir: string): Promise<{
  attention: string;
  good: string;
}> {
  const patternsTip = TIPS.find((tip) =>
    tip.followThrough?.verbs.includes("patterns")
  );
  const standardsTip = TIPS.find((tip) =>
    tip.followThrough?.verbs.includes("standards")
  );
  assert(patternsTip !== undefined, "no tip declares patterns adoption");
  assert(standardsTip !== undefined, "no tip declares standards adoption");

  const events: Record<string, unknown>[] = [];
  let hour = 0;
  const add = (over: Record<string, unknown>): void => {
    events.push({
      schema: 1,
      at: new Date(Date.UTC(2026, 6, 2, hour++)).toISOString(),
      kind: "verb",
      verb: "desk",
      surface: "cli",
      writer: "9.9.9",
      driver: {
        session: "cli:tip-adoption",
        json: false,
        tty: true,
        ci: false,
      },
      branch: "main",
      head: `head-${hour}`,
      clean: true,
      outcome: "ok",
      duration_ms: 100,
      epoch: "e1",
      ...over,
    });
  };
  const show = (id: string): void => add({ tip_ids: [id] });

  show(patternsTip.id);
  add({ verb: "patterns" });
  show(patternsTip.id);
  add({
    verb: "patterns",
    surface: "mcp",
    branch: "agent/delegated",
    driver: {
      session: "mcp:delegated",
      json: false,
      tty: false,
      ci: false,
      mcp_client: {
        name: "synthetic-client",
        version: "8.8.8",
      },
    },
  });
  show(patternsTip.id);
  show(patternsTip.id);

  for (let i = 0; i < 3; i += 1) {
    show(standardsTip.id);
    add({ verb: "standards" });
  }
  show(standardsTip.id);

  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  return { attention: patternsTip.id, good: standardsTip.id };
}

const REPORT_STANDARD_NAMES = Array.from(
  { length: 16 },
  (_, index) => `metric-${String(index + 1).padStart(2, "0")}`,
);

/** Generate varied up/down standard readings so the report must rank and collapse a large set. */
function reportStandards(reading: number, total: number): unknown[] {
  return REPORT_STANDARD_NAMES.map((name, index) => {
    switch (index % 3) {
      case 0: {
        const value = 82 + reading / total;
        return {
          name,
          direction: "up",
          limit: 80,
          margin: 0,
          measurement: "measured",
          value,
          verdict: "improved",
          pin_eligible: true,
          pin_target: value,
        };
      }
      case 1:
        return {
          name,
          direction: "down",
          limit: 100,
          value: 90 + (reading / Math.max(1, total - 1)) * 20,
          verdict: "regressed",
        };
      default:
        return {
          name,
          direction: "up",
          limit: 80,
          value: 80,
          verdict: "unchanged",
        };
    }
  });
}

/** Seed a report-sized corpus: many findings per detector across every family,
 * plus one config/release boundary inside each standard series. */
async function seedCollapsedReportLogbook(dir: string): Promise<void> {
  const branches = Array.from(
    { length: 20 },
    (_, index) => `agent/report-${String(index + 1).padStart(2, "0")}`,
  );
  const doneReadings = branches.length * 7;
  const events: Record<string, unknown>[] = [];
  let sequence = 0;
  let reading = 0;
  const at = (): string =>
    new Date(
      Date.UTC(2026, 6, 1, 9) + sequence++ * 3_600_000,
    ).toISOString();

  for (const branch of branches) {
    const session = `cli:${branch}`;
    events.push({
      schema: 1,
      at: at(),
      kind: "verb",
      verb: "prepare",
      surface: "cli",
      writer: reading < doneReadings / 2 ? "9.9.8" : "9.9.9",
      driver: { session, json: true, tty: false, ci: false },
      branch,
      head: `prepare-${branch}`,
      clean: true,
      outcome: "ok",
      duration_ms: 1000,
      epoch: reading < doneReadings / 2 ? "e1" : "e2",
    });
    for (let run = 0; run < 7; run += 1) {
      const failed = run < 6;
      const beforeBoundary = reading < doneReadings / 2;
      events.push({
        schema: 1,
        at: at(),
        kind: "verb",
        verb: "done",
        surface: "cli",
        writer: beforeBoundary ? "9.9.8" : "9.9.9",
        driver: { session, json: true, tty: false, ci: false },
        branch,
        head: `head-${branch}-${run}`,
        clean: true,
        outcome: failed ? "failed" : "ok",
        ...(failed ? { failed_stage: "check/test" } : {}),
        duration_ms: 21_000,
        scopes: ["engine"],
        steps: [
          {
            label: "scope:docs",
            kind: "scope-gate",
            outcome: failed ? "failed" : "ok",
            disposition: "run",
            group: "Check & test",
            duration_s: 20,
          },
          {
            label: "lint",
            kind: "job",
            outcome: "ok",
            disposition: "run",
            group: "Check & test",
            duration_s: 1,
          },
        ],
        standards: reportStandards(reading, doneReadings),
        epoch: beforeBoundary ? "e1" : "e2",
      });
      reading += 1;
    }
  }

  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

/** Seed enough landing history for both authority readers: 8 pre-authorized
 * landings followed by a dozen conversational docs-only landings. */
async function seedLandingAuthorityLogbook(dir: string): Promise<void> {
  const events: Record<string, unknown>[] = [];
  const sources = [
    ...Array.from({ length: 4 }, () => "standing-grant" as const),
    ...Array.from({ length: 4 }, () => "effort-grant" as const),
    ...Array.from({ length: 12 }, () => "conversation" as const),
  ];
  for (const [index, source] of sources.entries()) {
    events.push({
      schema: 1,
      at: new Date(Date.UTC(2026, 6, 1, index)).toISOString(),
      kind: "verb",
      verb: "accept",
      surface: "cli",
      writer: "9.9.9",
      driver: {
        session: `cli:landing-${index}`,
        json: true,
        tty: false,
        ci: false,
      },
      branch: `agent/landing-${index}`,
      head: `head-${index}`,
      clean: true,
      outcome: "ok",
      duration_ms: 1_000,
      scopes: ["map"],
      consent: source === "standing-grant"
        ? { source, scopes: ["map"] }
        : { source },
      landing: {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: true,
        branch_deleted: true,
      },
      epoch: "e1",
    });
  }
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

/** Seed 200 readings whose value dips and recovers to its exact first value. */
async function seedLongTrajectoryLogbook(dir: string): Promise<number[]> {
  const total = 200;
  const midpoint = (total - 1) / 2;
  const values = Array.from(
    { length: total },
    (_, index) => 70 + (Math.abs(index - midpoint) / midpoint) * 10,
  );
  const events = values.map((value, index) => ({
    schema: 1,
    at: new Date(
      Date.UTC(2026, 6, 1) + index * 3_600_000,
    ).toISOString(),
    kind: "verb",
    verb: "standards",
    surface: "cli",
    writer: "9.9.9",
    driver: {
      session: "cli:trajectory",
      json: true,
      tty: false,
      ci: false,
    },
    branch: "agent/trajectory",
    head: `trajectory-${index}`,
    clean: true,
    outcome: "ok",
    duration_ms: 100,
    standards: [{
      name: "recovery",
      direction: "up",
      limit: 90,
      value,
      verdict: "unchanged",
    }],
    epoch: "e1",
  }));
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  return values;
}

/** Collapse presentation whitespace before comparing wrapped human reports. */
function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Count literal report fragments while defining an empty needle as no match. */
function occurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  return haystack.split(needle).length - 1;
}

interface SeededAdminSibling {
  path: string;
  contents: string;
}

/** Seed every registered artifact except the logbook reset owns. */
async function seedAdminSiblings(dir: string): Promise<SeededAdminSibling[]> {
  const seeded: SeededAdminSibling[] = [];
  for (const key of GIT_ADMIN_STATE_KEYS) {
    if (key === "logbook") {
      continue;
    }
    const entry = GIT_ADMIN_STATE[key];
    const resolved = await gitAdminStatePath(dir, key);
    assert(resolved !== undefined, `could not resolve ${key}`);
    const path = entry.kind === "directory"
      ? join(resolved, "reset-must-preserve")
      : resolved;
    const contents = `${key}\n`;
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
    seeded.push({ path, contents });
  }
  return seeded;
}

Deno.test("patterns: an empty logbook is a first-class state with a helpful message", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(r.code, 0, r.output);
    const parsed = decodeCliResult(r.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assertEquals(parsed.ok, true);
    const data = parsed.data;
    assertEquals(data.logbook.events, 0);
    assertEquals(data.population, {
      analyzed: 0,
      agent: 0,
      human: 0,
      automation: 0,
      unknown: 0,
      identities: [],
    });
    assertEquals(data.findings, []);
    assert(
      data.detectors.every((d) => d.status === "insufficient-evidence"),
      "with no history every detector reports insufficient evidence",
    );
    assertHasHint(parsed, HINTS["patterns-logbook-empty"]);
  });
});

Deno.test("patterns: a seeded logbook yields two-layer findings that validate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    const r = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(r.code, 0, r.output);
    const parsed = decodeCliResult(r.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assertEquals(parsed.ok, true);
    const data = parsed.data;
    assert(data.logbook.events >= 5, "the seeded events must be read");
    assertEquals(
      data.logbook.unparsed,
      1,
      "the torn line is counted, not fatal",
    );

    // The driver split states the segmentation. A result format is not caller
    // identity evidence, so the four format-only calls remain unknown; only
    // the invocation-scoped Claude signal attributes the fifth call.
    assertEquals(data.population.analyzed, 5);
    assertEquals(data.population.agent, 1);
    assertEquals(data.population.human, 0);
    assertEquals(data.population.automation, 0);
    assertEquals(data.population.unknown, 4);
    assertEquals(data.population.identities, [
      { agent: "claude", label: "Claude Code", runs: 1 },
    ]);

    const thrash = data.findings.find((f) => f.detector === "done-thrash");
    assert(thrash !== undefined, "the seeded 3-streak must fire done-thrash");
    assertEquals(thrash.evidence.consecutive_failures, 3);
    assertStringIncludes(thrash.observed, "3 consecutive runs");
    assertEquals(thrash.tone, "attention");
    assertStringIncludes(thrash.summary, "repeated red Gates");
    assertEquals("brief" in thrash, false);
    assertStringIncludes(thrash.next_step, "discern-cure-a-bug");
    assertEquals(thrash.scope, "branch");

    // The report stays honest about what it could NOT judge.
    assert(
      data.detectors.some((d) => d.status === "insufficient-evidence"),
      "a young logbook must report its insufficient detectors",
    );
    // Advisory, structurally: findings never flip the envelope.
    assertEquals(parsed.ok, true);
  });
});

Deno.test("patterns: the report keeps each detector's strongest findings and --all lifts the bound", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const branches = PATTERNS_FINDINGS_PER_DETECTOR + 2;
    await seedManyBranchLogbook(dir, branches);

    const capped = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(capped.code, 0, capped.output);
    const parsed = decodeCliResult(capped.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assertEquals(parsed.ok, true);
    const data = parsed.data;
    const thrash = data.findings.filter((f) => f.detector === "done-thrash");
    assertEquals(
      thrash.length,
      PATTERNS_FINDINGS_PER_DETECTOR,
      "one finding per branch must cap at the per-detector bound",
    );
    const row = data.detectors.find((d) => d.id === "done-thrash");
    assert(row !== undefined);
    assertEquals(row.findings, branches, "detector rows keep the true count");

    const all = await runAgent(dir, ["patterns", "--json", "--all"]);
    assertEquals(all.code, 0, all.output);
    const allParsed = decodeCliResult(all.stdout, "patterns");
    assertResultDataKey(allParsed, "logbook");
    const allData = allParsed.data;
    assertEquals(
      allData.findings.filter((f) => f.detector === "done-thrash").length,
      branches,
      "--all must report one finding per branch",
    );
    assertEquals(
      data.findings_total,
      allData.findings.length,
      "the capped report must declare the complete list's size",
    );
    assertEquals(
      allData.findings_total,
      undefined,
      "a complete list needs no elision marker",
    );

    // The bound filters the existing rank order without re-sorting it.
    const fullOrder = allData.findings.map((f) => JSON.stringify(f));
    let previous = -1;
    for (const finding of data.findings) {
      const index = fullOrder.indexOf(JSON.stringify(finding));
      assert(index > previous, "capped findings must keep the full rank order");
      previous = index;
    }

    const hintParams = {
      shown: data.findings.length,
      total: allData.findings.length,
    };
    assertHasHint(parsed, HINTS["patterns-findings-capped"], hintParams);
    assertLacksHint(allParsed, HINTS["patterns-findings-capped"], hintParams);

    // The human report names each detector's elision and the escape hatch.
    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "200", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(
      human.output,
      `${
        branches - PATTERNS_FINDINGS_PER_DETECTOR
      } more findings remain for this detector.`,
    );
    assertTerminalTextIncludes(human.output, "Run: discern patterns --all");
  });
});

Deno.test("patterns: the wire result plateaus as recorded history grows", async () => {
  const findingCounts: number[] = [];
  const wireBytes: number[] = [];
  for (const branches of [6, 18]) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      await seedManyBranchLogbook(dir, branches);
      const result = await patternsResult(dir);
      assert(result.ok && result.data !== undefined);
      assert(
        result.data.findings.length <=
          DETECTORS.length * PATTERNS_FINDINGS_PER_DETECTOR,
        "the report is bounded by the registry, never the stream",
      );
      findingCounts.push(result.data.findings.length);
      wireBytes.push(JSON.stringify(result).length);
    });
  }
  assertEquals(
    findingCounts[1],
    findingCounts[0],
    "tripling the recorded branches must not grow the findings list",
  );
  const [small, large] = wireBytes;
  assert(small !== undefined && large !== undefined);
  assert(
    large <= small * 1.15,
    `the serialized result must plateau: ${small} bytes grew to ${large}`,
  );
});

Deno.test("patterns: generator gate share names the heaviest generated groups on the JSON wire", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedGeneratorGateLogbook(dir);

    const result = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = decodeCliResult(result.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assertEquals(parsed.ok, true);
    const data = parsed.data;
    const findings = data.findings.filter((finding) =>
      finding.detector === "generator-gate-share"
    );
    assertEquals(
      findings.map((finding) => finding.subject),
      ["generated:schemas", "generated:docs"],
    );
    assertEquals(findings[0]?.evidence, {
      runs: 5,
      group_share_pct: 40,
      group_mean_seconds: 20,
      generated_share_pct: 60,
      generated_mean_seconds: 30,
      unchanged_reruns: 4,
    });
    assertEquals(findings[0]?.basis?.coverage, {
      comparable: 5,
      denominator: 5,
      unit: "Gate runs",
    });
    assertStringIncludes(findings[0]?.next_step ?? "", "Restructure");
    assertEquals(
      data.detectors.find((entry) => entry.id === "generator-gate-share")
        ?.status,
      "fired",
    );
  });
});

Deno.test("patterns: decision evidence is identical from active and sealed history", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const raw = `${
      [85, 86, 87, 88, 89].map((value, index) =>
        seededDecisionStandardEvent(
          `2026-07-01T1${index}:00:00.000Z`,
          value,
        )
      ).join("\n")
    }\n`;
    const activeDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(activeDir, { recursive: true });
    await Deno.writeTextFile(join(activeDir, "2026-07.jsonl"), raw);
    const filename = "logbook-20260812T120000Z.jsonl";
    const archives = logbookArchiveDir(join(dir, ".git"));
    await Deno.mkdir(archives, { recursive: true });
    await Deno.writeTextFile(join(archives, filename), raw);

    const active = await patternsResult(dir, { all: true });
    const historical = await patternsResult(dir, {
      all: true,
      logbookFile: filename,
    });
    assert(active.ok && active.data !== undefined);
    assert(historical.ok && historical.data !== undefined);
    const decisionFindings = (data: PatternsData) =>
      data.findings.filter((finding) =>
        finding.detector === "standard-trajectory"
      );
    assertEquals(
      decisionFindings(historical.data),
      decisionFindings(active.data),
      "archive selection changes provenance, never detector arithmetic",
    );
    const finding = decisionFindings(historical.data)[0];
    assertEquals(finding?.evidence.recommendation_supported, 1);
    assertStringIncludes(finding?.next_step ?? "", "--pin coverage");
    assertEquals(historical.data.logbook.source, {
      kind: "archive",
      filename,
    });
  });
});

Deno.test("patterns: Standard variance investigations retain raw findings across JSON, terminal, and archives", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const raw = `${
      [85, 88, 86, 89, 87].map((value, index) =>
        seededDecisionStandardEvent(
          `2026-07-01T1${index}:00:00.000Z`,
          value,
        )
      ).join("\n")
    }\n`;
    const activeDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(activeDir, { recursive: true });
    await Deno.writeTextFile(join(activeDir, "2026-07.jsonl"), raw);
    const filename = "logbook-20260812T130000Z.jsonl";
    const archives = logbookArchiveDir(join(dir, ".git"));
    await Deno.mkdir(archives, { recursive: true });
    await Deno.writeTextFile(join(archives, filename), raw);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const activeResult = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(activeResult, "logbook");
    const active = activeResult.data;
    const investigation = active.investigations[0];
    assertEquals(investigation?.id, "standard-variance/coverage");
    assertEquals(investigation?.finding_ids, ["standard-trajectory"]);
    assertEquals(
      investigation?.observations[0]?.denominator,
      { value: 5, unit: "Standard readings" },
    );
    assertStringIncludes(investigation?.diagnostic_action ?? "", "standards");
    assertStringIncludes(investigation?.falsifier ?? "", "Three current");
    assert(
      active.findings.some((finding) =>
        finding.detector === "standard-trajectory" &&
        finding.subject === "coverage"
      ),
      "synthesis must not hide its raw Standard finding",
    );

    const historical = await patternsResult(dir, {
      all: true,
      logbookFile: filename,
    });
    assert(historical.ok && historical.data !== undefined);
    assertEquals(
      historical.data.investigations,
      active.investigations,
      "archive provenance must not change synthesis arithmetic",
    );

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "60", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "INVESTIGATION PATHS");
    assertTerminalTextIncludes(human.output, "Standard variance · coverage");
    assertTerminalTextIncludes(
      human.output,
      "comparable readings are unstable",
    );
    assertStringIncludes(human.output, "Evidence:");
    assertTerminalTextIncludes(normalized(human.output), "5 readings");
    assertStringIncludes(human.output, "Falsifier:");
    for (const [index, line] of human.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 60,
        `60-column investigation line ${index + 1} is too wide: ${line}`,
      );
    }
  });
});

Deno.test("patterns: current catalogue knowledge reinterprets historical raw MCP identity without rewriting it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[project]\nlogbook = false\n");
    await gitInit(dir);
    const path = await seedHistoricalMcpIdentityLogbook(dir);
    const before = await Deno.readTextFile(path);

    const result = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = decodeCliResult(result.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    const data = parsed.data;
    assertEquals(data.population.identities, [
      { agent: "cursor", label: "Cursor", runs: 5 },
    ]);
    const gaps = data.findings.filter((finding) =>
      finding.detector === "identity-gap"
    );
    assertEquals(gaps.map((finding) => finding.subject), ["mystery-agent"]);
    assert(
      !gaps.some((finding) => finding.subject === "cursor-vscode"),
      "the five historical Cursor calls must leave the anonymous cohort",
    );
    assertEquals(
      await Deno.readTextFile(path),
      before,
      "read-time reinterpretation must not migrate or rewrite logbook lines",
    );
  });
});

Deno.test("patterns --stats: the wire and the card carry the same counted feats", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Recording off keeps the seeded stream the whole stream — the harness's
    // own patterns runs would otherwise join the counts (the report still
    // reads existing history either way).
    await writeConfig(dir, "[project]\nlogbook = false\n");
    await gitInit(dir);
    await seedStatsLogbook(dir);

    // Without the flag, the payload stays lean: no stats key at all.
    const plain = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(plain.code, 0, plain.output);
    const plainResult = decodeCliResult(plain.stdout, "patterns");
    assertResultDataKey(plainResult, "logbook");
    const plainData = plainResult.data;
    assert(!("stats" in plainData), "stats is computed only when asked for");

    const json = await runAgent(dir, ["patterns", "--stats", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assertEquals(parsed.ok, true);
    const stats = parsed.data.stats;
    assert(stats !== undefined, "the flag must carry data.stats");
    assertEquals(stats.accepted, {
      count: 2,
      branches: 2,
      insertions: 130,
      deletions: 30,
      files: 3,
      commits: 4,
      cleanups: 0,
      biggest: { branch: "agent/b1", lines: 150, files: 2, day: "2026-07-01" },
      best_day: { day: "2026-07-01", accepted: 2 },
      longest_streak: 1,
    });
    assertEquals(stats.gate, {
      runs: 3,
      greens: 2,
      first_try_green_branches: 1,
      gated_branches: 2,
      longest_green_streak: 2,
      current_green_streak: 2,
      check_hours: 3,
    });
    assertEquals(stats.checkpoints, {
      efforts: 2,
      omitted: 0,
      rows: [{
        id: "api-review",
        efforts_fired: 1,
        efforts_landed: 1,
        fires: 1,
        declared: 1,
        declared_unchanged: 1,
        declared_unmet: 0,
        reopened: 0,
        variances: 0,
        abandoned: 0,
        median_declare_s: 60,
      }],
    });
    assertEquals(stats.validation_workflows.cycles, {
      total: 2,
      branches: 2,
      routes: [
        {
          route: "test-first",
          cycles: 0,
          branches: 0,
          runs: 0,
          successful_cycles: 0,
          successful_runs: 0,
          failed_cycles: 0,
          failed_runs: 0,
          retried_cycles: 0,
          retry_runs: 0,
        },
        {
          route: "commit-first",
          cycles: 2,
          branches: 2,
          runs: 3,
          successful_cycles: 2,
          successful_runs: 2,
          failed_cycles: 1,
          failed_runs: 1,
          retried_cycles: 1,
          retry_runs: 1,
        },
        {
          route: "unattributed",
          cycles: 0,
          branches: 0,
          runs: 0,
          successful_cycles: 0,
          successful_runs: 0,
          failed_cycles: 0,
          failed_runs: 0,
          retried_cycles: 0,
          retry_runs: 0,
        },
      ],
      precommit_to_clean_gate: {
        cycles: 0,
        branches: 0,
        runs: 0,
        retry_runs: 0,
      },
    });
    assertEquals(stats.validation_workflows.runs.evidence, {
      denominator: 3,
      complete: 0,
      incomplete: 0,
      unattributed: 3,
    });
    assertEquals(stats.cycles, {
      started: 2,
      completed: 2,
      under_day: 2,
      median_hours: 2.5,
      fastest_hours: 2,
    });
    assertEquals(stats.standards, {
      pins: 1,
      standards: 1,
      most_improved: {
        standard: "coverage",
        from: 80,
        to: 84,
        better_percent: 5,
      },
    });
    assertEquals(stats.agents, {
      detected: 1,
      identities: [{
        agent: "claude",
        label: "Claude Code",
        runs: 7,
        done_runs: 3,
        greens: 2,
      }],
      unattributed_runs: 0,
    });
    assertEquals(stats.breadth.branches, 3);
    assertEquals(stats.breadth.busiest_day, {
      day: "2026-07-01",
      branches: 3,
    });
    assertEquals(
      stats.breadth.peak_in_flight,
      { branches: 1, day: "2026-07-01" },
      "sequential arcs never overlap",
    );
    assertEquals(
      stats.series_days_per_point,
      undefined,
      "a one-day span carries no cadence series",
    );

    const human = await runAgent(dir, ["patterns", "--stats"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    const card = normalized(human.output);
    assertStringIncludes(card, "discern patterns --stats");
    assertStringIncludes(card, STATS_PROVENANCE);
    for (const label of Object.values(STATS_SECTIONS)) {
      assertStringIncludes(card, label.toUpperCase());
    }
    assertStringIncludes(card, DISCERN_MARK);
    assertStringIncludes(
      card,
      "2 changes accepted from 2 branches · 4 commits",
    );
    assertStringIncludes(
      card,
      "+130 −30",
    );
    assertStringIncludes(card, "3 files · 4.3 lines added per line removed");
    assertStringIncludes(
      card,
      "biggest: `agent/b1` · 150 changed lines · 2 files (2026-07-01)",
    );
    assertStringIncludes(card, "best day: 2026-07-01 · 2 accepted");
    assertStringIncludes(card, "2 of 3 `done` runs green (67%)");
    assertStringIncludes(card, "1 of 2 branches green first try (50%)");
    assertStringIncludes(card, "1 red run stopped at the Gate");
    assertStringIncludes(
      card,
      "`api-review` fired on 1 of 2 efforts (1 serving); declared 1 " +
        "(1 on an unchanged subject); median time to declare 60s",
    );
    assertStringIncludes(
      card,
      "`done`: 3 runs across 2 branches · 3 clean · 0 dirty · 0 unknown · 2 ok · 1 failed · 1 retry",
    );
    assertStringIncludes(
      card,
      "commit-first: 2 cycles / 3 runs across 2 branches · 2 ok / 1 failed runs · 2 reached a clean Gate / 1 had a failure · 1 retried cycle / 1 retry run",
    );
    assertStringIncludes(
      card,
      "evidence across 3 runs: complete 0 (0%) · incomplete 0 (0%) · unattributed 3 (100%)",
    );
    assert(
      !card.includes("never shipped") && !card.includes("shipped"),
      "the card speaks in accepted, not shipped",
    );
    assertStringIncludes(
      card,
      "longest green streak 2 · current 2 · 3h of checks run (`done` · `prepare` · `test`)",
    );
    assertStringIncludes(card, "Green Gate runs");
    assertStringIncludes(
      card,
      "[ 66%]",
      "the package proportion Meter renders",
    );
    assertStringIncludes(card, "2 of 2 starts were accepted (100%)");
    assertStringIncludes(
      card,
      "start-to-accept across 2 measured cycles · median 2.5h · fastest 2h · 2 inside a day",
    );
    assertStringIncludes(
      card,
      "1 limit tightened across 1 standard. Loosening fails the Gate.",
    );
    assertStringIncludes(
      card,
      "most improved: `coverage` 80 → 84 (5% better)",
    );
    assertStringIncludes(card, "1 agent identity");
    assertStringIncludes(
      card,
      "Claude Code · 7 runs · 2 of 3 `done` runs green (67%)",
    );
    assertStringIncludes(card, "3 branches driven · active 1 of 1 day");
    assert(
      !card.includes("in flight at once"),
      "a peak of one stays off the card",
    );
    assert(
      !card.includes(PATTERNS_ATTENTION_HEADING.toUpperCase()),
      "the card replaces the detector report, never interleaves it",
    );
    for (const [index, line] of human.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column stats line ${index + 1} is ${
          displayWidth(line)
        } columns: ${line}`,
      );
    }
  });
});

Deno.test("patterns --stats: an empty logbook renders the empty state, and the wire carries zeros", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[project]\nlogbook = false\n");
    await gitInit(dir);

    const human = await runAgent(dir, ["patterns", "--stats"], {
      env: { COLUMNS: "100", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    const empty = normalized(human.output);
    assertStringIncludes(empty, STATS_EMPTY_TITLE);
    assertStringIncludes(empty, STATS_EMPTY_DESCRIPTION);

    const json = await runAgent(dir, ["patterns", "--stats", "--json"]);
    assertEquals(json.code, 0, json.output);
    const result = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(result, "logbook");
    const stats = result.data.stats;
    assert(stats !== undefined);
    assertEquals(stats.accepted.count, 0);
    assertEquals(stats.gate.runs, 0);
    assertEquals(stats.cycles, undefined);
    assertEquals(stats.agents.detected, 0);
  });
});

Deno.test("patterns: seeded hint episodes report raw outcomes through JSON and the compact human report", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedHintFollowThroughLogbook(dir);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assert(parsed.ok && parsed.data !== undefined);
    const data = parsed.data;
    const findings = data.findings.filter((finding) =>
      finding.detector === "hint-follow-through"
    );
    assertEquals(
      findings.map((finding) => finding.subject).sort(),
      ["branch-update", "main-worktree-first", "red-gate-remedy"],
    );
    const expected = {
      "branch-update": {
        fired: 4,
        followed: 0,
        not_followed: 3,
        censored: 1,
      },
      "red-gate-remedy": {
        fired: 4,
        followed: 2,
        not_followed: 1,
        censored: 1,
      },
      "main-worktree-first": {
        fired: 4,
        followed: 2,
        not_followed: 1,
        censored: 1,
      },
    } as const;
    for (const finding of findings) {
      assert(finding.subject !== undefined);
      assertEquals(
        finding.evidence,
        expected[finding.subject as keyof typeof expected],
      );
      assertEquals(finding.tone, "attention");
    }

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "Hint follow-through by family");
    for (const family of Object.keys(expected)) {
      assertStringIncludes(human.output, family);
    }
  });
});

Deno.test("patterns: seeded tip episodes report cross-surface adoption and favorable evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ids = await seedTipAdoptionLogbook(dir);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assert(parsed.ok && parsed.data !== undefined);
    const findings = parsed.data.findings.filter((finding) =>
      finding.detector === "tip-adoption"
    );
    assertEquals(
      findings.map((finding) => finding.subject).sort(),
      [ids.attention, ids.good].sort(),
    );
    const attention = findings.find((finding) =>
      finding.subject === ids.attention
    );
    assert(attention !== undefined);
    assertEquals(attention.scope, "project");
    assertEquals(attention.tone, "attention");
    assertEquals(attention.evidence, {
      fired: 4,
      followed: 2,
      not_followed: 1,
      censored: 1,
    });
    assertStringIncludes(attention.next_step, `\`${ids.attention}\``);

    const good = findings.find((finding) => finding.subject === ids.good);
    assert(good !== undefined);
    assertEquals(good.tone, "good");
    assertEquals(good.evidence, {
      fired: 4,
      followed: 3,
      not_followed: 0,
      censored: 1,
    });

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "Tip adoption by tip");
    assertStringIncludes(human.output, ids.attention);
    assertStringIncludes(human.output, ids.good);
  });
});

Deno.test("patterns: the human report carries the findings and the advisory boundary", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    const result = await patternsResult(dir);
    assert(result.ok && result.data !== undefined);
    const thrash = result.data.findings.find((finding) =>
      finding.detector === "done-thrash"
    );
    assert(thrash !== undefined);
    assertEquals(thrash.series, undefined);
    const r = await runAgent(dir, ["patterns"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.output, "discern patterns");
    assertTerminalTextIncludes(r.output, "Consecutive red done runs");
    assertTerminalTextIncludes(normalized(r.output), "driven by agents");
    assertTerminalTextIncludes(normalized(r.output), "Claude Code 1");
    assertTerminalTextIncludes(
      normalized(r.output),
      "The report is advisory and does not change the Gate.",
    );
    assertTerminalTextIncludes(normalized(r.output), "Next action:");
    assertStringIncludes(
      normalized(r.output),
      normalized(
        `${thrash.summary} · Subject: ${thrash.subject ?? ""}`,
      ),
      "a wrapped row must retain its exact subject and canonical summary",
    );
    assertStringIncludes(
      normalized(r.output),
      normalized(`Evidence: ${thrash.observed}`),
    );
  });
});

Deno.test("patterns: 39, 80, 104, and capped reports keep hostile Logbook facts inert", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[project]\nlogbook = false\n");
    await gitInit(dir);
    const branch = "agent/測試-evil\u001b[31m\tb\u0007c\nz\u009b";
    const safeBranch = "agent/測試-evil␛[31m␉b␇c␊z<U+009B>";
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    await Deno.writeTextFile(
      join(logDir, "2026-06.jsonl"),
      `${
        ["10", "11", "12", "13"].map((hour, index) =>
          seededEvent(
            `2026-06-01T${hour}:00:00.000Z`,
            index === 3 ? "ok" : "failed",
            branch,
          )
        ).join("\n")
      }\n`,
    );

    const observed = await patternsResult(dir);
    assert(observed.ok && observed.data !== undefined);
    const finding = observed.data.findings.find((candidate) =>
      candidate.detector === "done-thrash"
    );
    assertEquals(finding?.subject, branch);

    const outputs = new Map<number, string>();
    for (const width of [39, 80, 104, 400]) {
      const run = await runAgent(dir, ["patterns"], {
        env: {
          COLUMNS: String(width),
          LINES: "24",
          NO_COLOR: "1",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
        },
      });
      assertEquals(run.code, 0, run.output);
      outputs.set(width, run.stdout);
      const plain = normalized(run.stdout);
      assertStringIncludes(run.stdout.replaceAll(/\s+/gu, ""), safeBranch);
      assertStringIncludes(plain, normalized(finding?.summary ?? ""));
      assertStringIncludes(
        run.stdout.replaceAll(/\s+/gu, ""),
        terminalMultiline(finding?.observed ?? "").replaceAll(/\s+/gu, ""),
      );
      assert(!run.stdout.includes("\u001b[31m"));
      assert(!run.stdout.includes("\u009b"));
      assert(
        unexpectedTerminalControls(run.stdout).length === 0,
        `${width}-column Patterns output contains a raw terminal control`,
      );
      const budget = Math.min(width, 104);
      for (const line of run.stdout.split("\n")) {
        assert(
          displayWidth(line) <= budget,
          `${width}-column Patterns line is ${
            displayWidth(line)
          } columns: ${line}`,
        );
      }
    }
    assertEquals(outputs.get(400), outputs.get(104));
  });
});
Deno.test("patterns: validation relationships preserve structured evidence and compact terminal parity", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedValidationFindings(dir);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assert(parsed.ok && parsed.data !== undefined);
    const data = parsed.data;
    const strict = data.findings.find((finding) =>
      finding.detector === "same-tree-flake"
    );
    const contextual = data.findings.find((finding) =>
      finding.detector === "execution-context-divergence"
    );
    assertEquals(strict?.subject, "strict-test");
    assertEquals(strict?.basis?.kind, "complete-validation-state");
    assertEquals(strict?.basis?.coverage, {
      comparable: 2,
      denominator: 2,
      unit: "job-runs",
    });
    assertEquals(contextual?.subject, "context-test");
    assertEquals(
      contextual?.basis?.differing_conditions.map((condition) =>
        condition.dimension
      ),
      [
        "capture-boundary",
        "execution-mode",
        "concurrency",
        "sibling-context",
      ],
    );

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(
      human.output,
      "Divergent outcomes under matched recorded conditions",
    );
    assertTerminalTextIncludes(
      human.output,
      "Divergent outcomes between recorded execution contexts",
    );
    assertStringIncludes(human.output, "strict-test");
    assertStringIncludes(human.output, "context-test");
    assert(!human.output.includes("exact same tree"));
    for (const [index, line] of human.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
  });
});

Deno.test("patterns: high-cardinality validation contexts stay bounded and disclose omissions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedHighCardinalityValidationFinding(dir);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assert(parsed.ok && parsed.data !== undefined);
    const data = parsed.data;
    const finding = data.findings.find((candidate) =>
      candidate.detector === "execution-context-divergence"
    );
    assertEquals(finding?.subject, "bounded-context-test");
    assertEquals(
      finding?.evidence.contexts,
      PATTERN_EVIDENCE_CONDITION_VALUES_MAX + 1,
    );
    const siblings = finding?.basis?.differing_conditions.find((condition) =>
      condition.dimension === "sibling-context"
    );
    assertEquals(
      siblings?.values.length,
      PATTERN_EVIDENCE_CONDITION_VALUES_MAX,
    );
    assertEquals(
      siblings?.distinct,
      PATTERN_EVIDENCE_CONDITION_VALUES_MAX + 1,
    );
    assertEquals(siblings?.omitted, 1);
    assert(
      (finding?.observed.length ?? Number.POSITIVE_INFINITY) <= 1_000,
      `bounded observed prose grew to ${finding?.observed.length} characters`,
    );
    assertStringIncludes(
      finding?.observed ?? "",
      "additional contexts omitted from this summary",
    );
    assertStringIncludes(
      finding?.observed ?? "",
      "additional siblings omitted",
    );

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.output, "bounded-context-test");
    assertTerminalTextIncludes(
      human.output,
      "Divergent outcomes between recorded execution contexts",
    );
    const lines = human.output.trimEnd().split("\n");
    assert(
      lines.length <= 80,
      `bounded terminal result grew to ${lines.length} lines`,
    );
    assert(
      human.output.length <= 5_000,
      `bounded terminal result grew to ${human.output.length} characters`,
    );
    for (const [index, line] of lines.entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
  });
});

Deno.test("patterns: a 200-reading standard stays bounded on the wire and renders one sparkline", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const rawValues = await seedLongTrajectoryLogbook(dir);

    const json = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(json.code, 0, json.output);
    const parsed = decodeCliResult(json.stdout, "patterns");
    assertResultDataKey(parsed, "logbook");
    assert(parsed.ok && parsed.data !== undefined);
    const data = parsed.data;
    const trajectory = data.findings.find((finding) =>
      finding.detector === "standard-trajectory" &&
      finding.subject === "recovery"
    );
    assert(trajectory !== undefined);
    assert(trajectory.series !== undefined);
    assert(
      trajectory.series.length <= PATTERNS_SERIES_MAX_POINTS,
      `${trajectory.series.length}-point series exceeds the wire cap`,
    );
    assertEquals(trajectory.series[0], rawValues[0]);
    assertEquals(
      trajectory.series[trajectory.series.length - 1],
      rawValues[rawValues.length - 1],
    );
    assertEquals(
      data.findings.filter((finding) => finding.series !== undefined).length,
      1,
      "only the standard trajectory may carry a series",
    );

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assert(!human.output.includes("\x1b["), "NO_COLOR must emit no ANSI");
    assertStringIncludes(human.output, sparkline(trajectory.series));
    assert(
      !human.output.includes(PATTERNS_ATTENTION_HEADING.toUpperCase()),
      "a neutral trajectory must not grow an empty attention banner",
    );
    for (const [index, line] of human.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
  });
});

Deno.test("patterns: landing authority findings render in the overview and behavior report", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLandingAuthorityLogbook(dir);

    const result = await patternsResult(dir);
    assert(result.ok && result.data !== undefined);
    const audit = result.data.findings.filter((finding) =>
      finding.detector === "pre-authorized-landings"
    );
    assertEquals(audit.length, 2, "summary plus the docs grant split");
    const suggestion = result.data.findings.find((finding) =>
      finding.detector === "grant-suggestion"
    );
    assertEquals(suggestion?.subject, "map");

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "100", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    const plain = normalized(human.output);
    assertStringIncludes(
      plain,
      "Recorded landing authority handled part of this project's landings.",
    );
    assertStringIncludes(plain, "Detector: Pre-authorized landings ·");
    assertStringIncludes(
      plain,
      "Repeated conversational landings in one scope",
    );
    assertStringIncludes(
      plain,
      "Consider adding `map` to `[acceptance].pre_authorized`",
    );
    assertEquals(
      occurrences(plain, "Detector: Pre-authorized landings ·"),
      1,
      "the detailed detector block keeps one title",
    );
  });
});

Deno.test("patterns: the compact human report enrolls every family, tone, detector, and finding", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedCollapsedReportLogbook(dir);

    // Read the exact pre-command result the human invocation will project.
    // `patternsResult` is pure observation and records no new event.
    const result = await patternsResult(dir);
    assert(result.ok && result.data !== undefined);
    const data = result.data;
    assertEquals(data.detectors.length, DETECTORS.length);
    for (const family of DETECTOR_FAMILIES) {
      assert(
        data.findings.some((finding) => finding.family === family),
        `${family} needs a fired detector in the report fixture`,
      );
    }

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assert(!human.output.includes("\x1b["), "NO_COLOR must emit no ANSI");
    const plain = normalized(human.output);
    const lines = human.output.trimEnd().split("\n");
    for (const [index, line] of lines.entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
    assertEquals(
      data.population.agent + data.population.human +
        data.population.automation + data.population.unknown,
      data.population.analyzed,
      "the named driver partition must reconcile to analyzed runs",
    );
    const identified = data.population.identities.reduce(
      (sum, identity) => sum + identity.runs,
      0,
    );
    assert(
      identified <= data.population.agent,
      "named identities are a labeled subset of agent runs",
    );
    assertStringIncludes(
      plain,
      `${formatHumanNumber(data.population.analyzed)} analyzed runs`,
    );
    if (identified > 0) {
      assertStringIncludes(plain, "(identified:");
    }

    // The banner filters the existing strength order without re-sorting it,
    // carries no body prose, and points to blocks that remain below.
    const attention = data.findings.filter((finding) =>
      finding.tone === "attention"
    );
    assert(
      attention.length > PATTERNS_ATTENTION_LIMIT,
      "the fixture needs enough attention findings to prove the cap",
    );
    const bannerStart = lines.findIndex((line) =>
      line.includes(PATTERNS_ATTENTION_HEADING.toUpperCase())
    );
    assert(bannerStart >= 0, "attention findings need a banner");
    const firstSection = lines.findIndex((line) =>
      line.includes(PATTERNS_FAMILY_SECTIONS.trajectory.heading.toUpperCase())
    );
    assert(firstSection > bannerStart, "the banner belongs above the sections");
    const bannerLines = lines.slice(bannerStart + 1, firstSection);
    const bannerDiagnosticLines = bannerLines.filter((line) =>
      /^(?:\*|◇) Changed:/u.test(line)
    );
    assertEquals(bannerDiagnosticLines.length, PATTERNS_ATTENTION_LIMIT);
    const bannerText = normalized(bannerLines.join("\n"));
    const titleById = new Map(
      data.detectors.map((detector) => [detector.id, detector.title]),
    );
    let previousFinding = -1;
    for (const finding of attention.slice(0, PATTERNS_ATTENTION_LIMIT)) {
      const title = titleById.get(finding.detector) ?? finding.detector;
      const subject = finding.subject === undefined
        ? ""
        : `${finding.subject}: `;
      const index = bannerText.indexOf(
        normalized(`${subject}${finding.summary}`),
      );
      assert(
        index > previousFinding,
        `${finding.detector} is out of rank order`,
      );
      previousFinding = index;
      assert(
        normalized(lines.slice(firstSection).join("\n")).includes(
          normalized(`Detector: ${title} ·`),
        ),
        `${title} must also name its full block below`,
      );
    }

    // The canonical family vocabulary owns section order. The total
    // presentation record makes a new family fail type-checking until titled.
    let previousSection = -1;
    for (const family of DETECTOR_FAMILIES) {
      const heading = PATTERNS_FAMILY_SECTIONS[family].heading;
      const index = human.output.indexOf(heading.toUpperCase());
      assert(index > previousSection, `${family} is out of canonical order`);
      assertEquals(occurrences(human.output, heading.toUpperCase()), 1);
      previousSection = index;
    }

    // A detector block owns one mixed-state Result-summary collection. Its
    // semantic state labels vary in width, but every fact begins in the same
    // package-computed column.
    const mixedGroup = human.output.split("\n\n").find((block) =>
      block.includes("Detector:") &&
      (block.includes("◇ Changed:") || block.includes("✓ Passed:"))
    );
    assert(mixedGroup !== undefined, "the fixture needs a mixed-state group");
    const prefix = /^(?:= Unchanged:|◇ Changed:|✓ Passed:)(\s+)(?=\S)/u;
    const summaryLines = mixedGroup.split("\n").flatMap((line) => {
      const match = prefix.exec(line);
      return match === null ? [] : [{ line, factColumn: match[0].length }];
    });
    assert(summaryLines.length >= 2);
    assertEquals(
      new Set(summaryLines.map((line) => line.factColumn)).size,
      1,
      summaryLines.map((line) => line.line).join("\n"),
    );

    // Each fired detector becomes one package summary, even when it emitted
    // many rows.
    for (const detector of data.detectors.filter((d) => d.status === "fired")) {
      assertEquals(
        occurrences(plain, normalized(`Detector: ${detector.title} ·`)),
        1,
        `${detector.id} must render its title once`,
      );
    }

    // The package-state adapter and every rendered finding auto-enrol from the
    // closed tone vocabulary. Normalize wrapping to prove no fact disappeared.
    assertEquals(
      Object.keys(PATTERNS_TONE_RESULT_STATE).sort(),
      [...PATTERN_FINDING_TONES].sort(),
    );
    const seriesFindings = data.findings.filter((finding) =>
      finding.series !== undefined
    );
    const sparklineRows = lines.filter((line) => /[▁▂▃▄▅▆▇█]/u.test(line));
    assertEquals(sparklineRows.length, seriesFindings.length);
    for (const finding of seriesFindings) {
      assertEquals(finding.detector, "standard-trajectory");
      assert(finding.series !== undefined);
      assertStringIncludes(human.output, sparkline(finding.series));
    }
    const rowKeys = new Map<string, number>();
    for (const finding of data.findings) {
      const key = normalized(
        [
          finding.summary,
          ...(finding.subject === undefined
            ? []
            : [`Subject: ${finding.subject}`]),
          ...(finding.series === undefined
            ? []
            : [`Series: ${sparkline(finding.series)}`]),
          `Evidence: ${finding.observed}`,
        ].join(" · "),
      );
      rowKeys.set(key, (rowKeys.get(key) ?? 0) + 1);
    }
    for (const [key, count] of rowKeys) {
      assert(
        occurrences(plain, key) >= count,
        `report dropped ${count - occurrences(plain, key)} row(s): ${key}`,
      );
    }

    // Repeated detector instructions appears once. Subject-specific standard pins
    // collapse into one named action, and the boundary caveat appears once.
    const steps = new Map<string, number>();
    for (const finding of data.findings) {
      if (finding.next_step.includes("discern standards --pin")) {
        continue;
      }
      steps.set(
        finding.next_step,
        (steps.get(finding.next_step) ?? 0) + 1,
      );
    }
    for (const [step, count] of steps) {
      if (count > 1) {
        assertEquals(
          occurrences(plain, normalized(step)),
          1,
          `repeated next step rendered more than once: ${step}`,
        );
      }
    }
    assertEquals(occurrences(plain, "`discern standards --pin`"), 1);
    assertEquals(
      occurrences(plain, normalized(PATTERNS_TRAJECTORY_CAVEAT)),
      1,
    );

    const fired = data.detectors.filter((d) => d.status === "fired").length;
    const quiet = data.detectors.filter((d) => d.status === "quiet").length;
    const insufficient = data.detectors.filter((d) =>
      d.status === "insufficient-evidence"
    ).length;
    assertEquals(fired + quiet + insufficient, DETECTORS.length);
    assertStringIncludes(
      plain,
      `${DETECTORS.length} detectors · ${fired} fired · ${quiet} quiet · ${insufficient} insufficient evidence`,
    );

    // The old renderer spent four lines per finding, plus seven fixed lines.
    // This corpus is intentionally repetition-heavy: the recurring report must
    // stay at or below half that legacy account of the full corpus. The
    // closing account is measured out first: its length scales with the
    // detector registry (every quiet or young title is named), not with
    // findings, so registry growth must not read as a compactness regression.
    const closingStart = lines.findIndex((line) =>
      line.includes("The report is advisory")
    );
    assert(closingStart >= 0, "the closing account must render");
    // The measured span is only honest while the closing account sits BELOW
    // every family section: a renderer reorder that floated it upward would
    // silently shrink the measured finding body to nothing.
    const lastSectionLine = Math.max(
      ...DETECTOR_FAMILIES.map((family) =>
        lines.findIndex((line) =>
          line.includes(PATTERNS_FAMILY_SECTIONS[family].heading.toUpperCase())
        )
      ),
    );
    assert(
      closingStart > lastSectionLine,
      "the closing account must follow the last family section",
    );
    const findingLines = closingStart;
    const legacyLines = (data.findings_total ?? data.findings.length) * 4 + 7;
    assert(
      findingLines <= Math.floor(legacyLines / 2),
      `compact report used ${findingLines} lines; legacy shape used ${legacyLines}`,
    );

    const narrow = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "60", NO_COLOR: "1" },
    });
    assertEquals(narrow.code, 0, narrow.output);
    for (const [index, line] of narrow.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 60,
        `60-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
    const narrowPlain = normalized(narrow.output);
    for (const detector of data.detectors) {
      assertStringIncludes(narrowPlain, normalized(detector.title));
    }
    for (const key of rowKeys.keys()) {
      assertStringIncludes(narrowPlain, key);
    }
  });
});

realPtyTest({
  name:
    "patterns reset: preview is read-only and terminal apply removes exactly the active logbook",
  contracts: ["platform-transport"],
  canary: false,
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      await seedLogbook(dir);
      // Every registered sibling must survive: "the whole logbook directory"
      // means the logbook directory alone. New registry members auto-enrol.
      const siblings = await seedAdminSiblings(dir);
      const logDir = join(dir, ".git", "discern", "logbook");
      const sealedArchive = join(
        dir,
        ".git",
        "discern",
        "logbook-archives",
        "logbook-20260811T120000Z.jsonl",
      );
      const sealedContents = `${
        seededEvent(
          "2026-08-11T12:00:00.000Z",
          "ok",
        )
      }\n`;
      await Deno.writeTextFile(sealedArchive, sealedContents);

      // The preview lists the files and removes nothing.
      const preview = await runAgent(dir, [
        "patterns",
        "reset",
        "--dry-run",
        "--json",
      ]);
      assertEquals(preview.code, 0, preview.output);
      const previewParsed = decodeCliResult(preview.stdout, "patterns reset");
      assertResultDataKey(previewParsed, "removed");
      assertEquals(previewParsed.dry_run, true);
      const previewData = previewParsed.data;
      assert(
        previewData.removed.some((f) => f.file === "2026-06.jsonl"),
        "the plan must list the month file",
      );
      assert(
        (await Deno.stat(join(logDir, "2026-06.jsonl"))).isFile,
        "a dry-run removes nothing",
      );

      // Machine apply refuses without changing the active bytes.
      const before = await Deno.readFile(join(logDir, "2026-06.jsonl"));
      const refused = await runAgent(dir, ["patterns", "reset", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const refusedParsed = decodeCliResult(refused.stdout, "patterns reset");
      assertEquals(refusedParsed.error, "confirmation_required");
      assertEquals(
        await Deno.readFile(join(logDir, "2026-06.jsonl")),
        before,
      );

      // A terminal operator's explicit Yes removes the active history.
      const apply = await runAgentPty(dir, ["patterns", "reset"], {
        input: "y\n",
      });
      assertEquals(apply.code, 0, apply.output);
      assertTerminalTextIncludes(
        normalized(apply.output),
        "Removed the active Logbook",
      );
      let logbookGone = false;
      try {
        await Deno.stat(logDir);
      } catch {
        logbookGone = true;
      }
      assert(logbookGone, "reset itself must not recreate the active Logbook");
      for (const sibling of siblings) {
        assertEquals(
          await Deno.readTextFile(sibling.path),
          sibling.contents,
          `reset must preserve ${sibling.path}`,
        );
      }
      assertEquals(
        await Deno.readTextFile(sealedArchive),
        sealedContents,
        "reset must preserve every sealed archive",
      );

      // Afterwards the verb reports a genuinely fresh active logbook.
      const after = await runAgent(dir, ["patterns", "--json"]);
      assertEquals(after.code, 0, after.output);
      const afterResult = decodeCliResult(after.stdout, "patterns");
      assertResultDataKey(afterResult, "logbook");
      const afterData = afterResult.data;
      assert(
        afterData.logbook.events === 0,
        `the history must be gone, saw ${afterData.logbook.events} events`,
      );
      assertEquals(afterData.findings, []);
    });
  },
});

Deno.test("patterns reset: even an empty apply refuses outside a terminal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["patterns", "reset", "--json"]);
    assertEquals(r.code, 1, r.output);
    const parsed = decodeCliResult(r.stdout, "patterns reset");
    assertResultDataKey(parsed, "removed");
    assertEquals(parsed.ok, false);
    assertEquals(parsed.error, "confirmation_required");
    assertEquals(parsed.data.removed, []);
  });
});

Deno.test("patterns: dead-checkpoint candidates are the firable set — a dormant entry is waiting, not dead", async () => {
  // The seam guard for the candidate set: the shipped gotchas entry with no
  // doc configured expands to the match-nothing pattern (dormant by
  // configuration), while an authored checkpoint with a real selector that
  // simply never fired IS the dead-checkpoint signal.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "true"

[checkpoints.gotchas-playbook]

[checkpoints.ghost-rule]
paths = ["never-touched/**"]
question = "A judgment nothing here ever triggers."
`,
    );
    await gitInit(dir);
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    const lines: string[] = [];
    for (let b = 0; b < 8; b++) {
      lines.push(
        seededEvent(
          `2026-06-${String(b + 1).padStart(2, "0")}T10:00:00.000Z`,
          "ok",
          `agent/effort-${b}`,
        ),
      );
    }
    await Deno.writeTextFile(
      join(logDir, "2026-06.jsonl"),
      `${lines.join("\n")}\n`,
    );
    const result = await patternsResult(dir, { all: true });
    assert(result.ok && result.data !== undefined);
    const dead = result.data.findings.filter(
      (finding) => finding.detector === "checkpoint-dead",
    );
    assertEquals(dead.map((finding) => finding.subject), ["ghost-rule"]);
  });
});
