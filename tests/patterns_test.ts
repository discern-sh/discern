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
 *    marked coarse;
 *  - **writer/reader parity**: every event kind and top-level driver signal in
 *    the tolerant schema is consumed by the reader layer or recorded as
 *    deliberately unread with a reason — exactly one of the two.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  AGENT_SIGNAL_SOURCES,
} from "../src/shared/agent_catalogue.ts";
import {
  COHORT_MINIMUMS,
  denominatorClause,
  driverAgent,
  driverKind,
} from "../src/engine/logbook/cohorts.ts";
import {
  buildStreamFacts,
  comparableTail,
  type Detector,
  type DetectorReport,
  DETECTORS,
  runDetector,
} from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  logbookEventSchema,
  type VerbEvent,
  verbEventSchema,
} from "../src/engine/logbook/schema.ts";
import {
  DETECTOR_FAMILIES,
  type DetectorFamily,
  PATTERN_FINDING_TONES,
} from "../src/shared/patterns_vocabulary.ts";
import { type HintFollowThroughRule, HINTS } from "../src/shared/hints.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

// ── writer/reader parity ───────────────────────────────────────────────────

/** The reader layer whose source-level references account for the schema's
 * event kinds and raw driver signals. This deliberately observes the existing
 * seam; readers do not register themselves with a framework for the test. */
const LOGBOOK_READER_MODULES = [
  "src/engine/logbook/patterns.ts",
  "src/engine/logbook/detectors.ts",
  "src/engine/logbook/cohorts.ts",
  "src/engine/logbook/read.ts",
] as const;

/** Schema members a reader deliberately does not consume, each with its
 * reason. Empty today: every live event kind and driver signal is read. */
const DELIBERATELY_UNREAD_EVENT_KINDS: Readonly<Record<string, string>> = {};
const DELIBERATELY_UNREAD_DRIVER_SIGNALS: Readonly<
  Record<string, string>
> = {};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether reader code branches on one event kind. */
function readsEventKind(source: string, kind: string): boolean {
  const literal = `["']${escapeRegExp(kind)}["']`;
  return new RegExp(
    `(?:\\.kind\\s*(?:===|!==)\\s*${literal}|case\\s+${literal})`,
  ).test(source);
}

/** Whether reader code reads one top-level `driver` field. */
function readsDriverSignal(source: string, field: string): boolean {
  return new RegExp(
    `\\.driver\\??\\.${escapeRegExp(field)}\\b`,
  ).test(source);
}

/** Exactly-one-of coverage: a member is read or deliberately unread. */
function readerCoverageOffenders(
  members: readonly string[],
  isRead: (member: string) => boolean,
  deliberatelyUnread: Readonly<Record<string, string>>,
  label: string,
): string[] {
  const live = new Set(members);
  const offenders: string[] = [];
  for (const member of members) {
    const read = isRead(member);
    const recorded = Object.hasOwn(deliberatelyUnread, member);
    if (!read && !recorded) {
      offenders.push(
        `${label} "${member}" is not consumed by the logbook readers and ` +
          "has no deliberate-unread reason",
      );
    }
    if (read && recorded) {
      offenders.push(
        `${label} "${member}" is consumed by the logbook readers but also ` +
          "recorded deliberately unread — delete the stale record",
      );
    }
  }
  for (const [member, reason] of Object.entries(deliberatelyUnread)) {
    if (!live.has(member)) {
      offenders.push(
        `${label} "${member}" is recorded deliberately unread but is not ` +
          "a live schema member — delete the stale record",
      );
    }
    if (reason.trim().length === 0) {
      offenders.push(`${label} "${member}" needs a deliberate-unread reason`);
    }
  }
  return offenders;
}

async function logbookReaderSource(): Promise<string> {
  return (await Promise.all(
    LOGBOOK_READER_MODULES.map((path) =>
      Deno.readTextFile(join(REPO_ROOT, path))
    ),
  )).join("\n");
}

Deno.test("patterns reader coverage: every event kind and driver signal is consumed or deliberately unread", async () => {
  const source = await logbookReaderSource();
  const eventKinds = logbookEventSchema.options.map((option) =>
    option.shape.kind.value
  );
  const driverSignals = Object.keys(
    verbEventSchema.shape.driver.unwrap().shape,
  );
  const offenders = [
    ...readerCoverageOffenders(
      eventKinds,
      (kind) => readsEventKind(source, kind),
      DELIBERATELY_UNREAD_EVENT_KINDS,
      "event kind",
    ),
    ...readerCoverageOffenders(
      driverSignals,
      (field) => readsDriverSignal(source, field),
      DELIBERATELY_UNREAD_DRIVER_SIGNALS,
      "driver signal",
    ),
  ];
  assertEquals(
    offenders,
    [],
    "the logbook writer vocabulary and reader coverage drifted apart:\n  " +
      offenders.join("\n  "),
  );
});

Deno.test("patterns reader coverage control: synthetic event and driver members fail until read", () => {
  const source = 'if (event.kind === "verb") event.driver?.json;';
  const events = readerCoverageOffenders(
    ["verb", "future-event"],
    (kind) => readsEventKind(source, kind),
    {},
    "event kind",
  );
  assertEquals(events.length, 1, "an unread fifth event kind must offend");
  assert(events[0]?.includes("future-event"));

  const signals = readerCoverageOffenders(
    ["json", "future_signal"],
    (field) => readsDriverSignal(source, field),
    {},
    "driver signal",
  );
  assertEquals(signals.length, 1, "an unread driver field must offend");
  assert(signals[0]?.includes("future_signal"));
});

Deno.test("patterns reader coverage control: deliberate unread reasons are exclusive and live", () => {
  const source = 'if (event.kind === "verb") event.driver?.json;';
  assertEquals(
    readerCoverageOffenders(
      ["future-event"],
      (kind) => readsEventKind(source, kind),
      { "future-event": "reserved for a future reader" },
      "event kind",
    ),
    [],
    "a live unread member with a reason is accounted for",
  );
  assertEquals(
    readerCoverageOffenders(
      ["verb"],
      (kind) => readsEventKind(source, kind),
      { verb: "stale reason" },
      "event kind",
    ).length,
    1,
    "a member cannot be both read and recorded unread",
  );
});

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

/** A red `done` whose failure reached the tests. */
function redDone(over: Partial<VerbEvent> = {}): Partial<VerbEvent> {
  return {
    verb: "done",
    outcome: "failed",
    failed_stage: "check/test",
    ...over,
  };
}

/** One successful acceptance with recorded consent and changed-scope names. */
function accepted(
  source: NonNullable<VerbEvent["consent"]>["source"],
  scopes: string[] = ["docs"],
): Partial<VerbEvent> {
  return {
    verb: "accept",
    outcome: "ok",
    scopes: [...scopes],
    consent: source === "standing-grant"
      ? { source, scopes: [...scopes] }
      : { source },
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
  direction: "up" | "down" = "up",
): NonNullable<VerbEvent["standards"]>[number] {
  return { name, value, limit, direction, verdict: "improved" };
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

/** One agent-attributed run: an identity signal plus the given overrides. */
function cohortRun(
  agent: string,
  marker: string,
  over: Partial<VerbEvent> = {},
): Partial<VerbEvent> {
  return { driver: signalledDriver(agent, marker), ...over };
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
      mcp_client: { name, version: "9.9.9" },
    },
  };
}

interface MeasuredHint {
  id: string;
  followThrough: HintFollowThroughRule;
}

/** Every hint that declares an outcome rule. The registry is the population:
 * adding a measured hint enrolls it in the followed/not-followed class test. */
function measuredHints(): MeasuredHint[] {
  return Object.values(HINTS).flatMap((hint) =>
    hint.followThrough === undefined
      ? []
      : [{ id: hint.id, followThrough: hint.followThrough }]
  );
}

type EpisodeVerdict = "followed" | "not-followed";

function firedHint(
  hint: MeasuredHint,
  over: Partial<VerbEvent> = {},
): Partial<VerbEvent> {
  const rule = hint.followThrough;
  switch (rule.kind) {
    case "branch-action-before-boundary":
      return {
        verb: "done",
        outcome: "failed",
        failed_stage: "check/test",
        hint_ids: [hint.id],
        ...over,
      };
    case "session-action-before-repeat":
      return { verb: "status", hint_ids: [hint.id], ...over };
    case "main-session-start-before-dirty":
      return {
        verb: "worktree ensure",
        branch: "main",
        hint_ids: [hint.id],
        ...over,
      };
  }
}

/** Three resolved episodes plus one censored firing, for one live registry
 * member. Each rule kind supplies its own observable boundary. */
function followThroughFixture(
  hint: MeasuredHint,
  verdict: EpisodeVerdict,
): LogbookEvent[] {
  const events: Partial<VerbEvent>[] = [];
  const rule = hint.followThrough;
  switch (rule.kind) {
    case "branch-action-before-boundary":
      for (let i = 0; i < 3; i += 1) {
        const actionVerb = rule.actionVerbs[i % rule.actionVerbs.length];
        assert(actionVerb !== undefined, `${hint.id}: no action verb`);
        events.push(
          firedHint(hint),
          verdict === "followed"
            ? { verb: actionVerb }
            : { verb: rule.boundaryVerb },
        );
      }
      events.push(firedHint(hint));
      break;
    case "session-action-before-repeat":
      if (verdict === "followed") {
        for (let i = 0; i < 3; i += 1) {
          events.push(firedHint(hint), { verb: rule.actionVerb });
        }
        events.push(
          firedHint(hint),
          {
            verb: rule.actionVerb,
            surface: "mcp",
            driver: {
              session: "mcp:other",
              json: false,
              tty: false,
              ci: false,
            },
          },
        );
      } else {
        events.push(
          firedHint(hint),
          firedHint(hint),
          firedHint(hint),
          firedHint(hint),
          {
            verb: rule.actionVerb,
            surface: "mcp",
            driver: {
              session: "mcp:other",
              json: false,
              tty: false,
              ci: false,
            },
          },
        );
      }
      break;
    case "main-session-start-before-dirty":
      for (let i = 0; i < 3; i += 1) {
        events.push(
          firedHint(hint),
          verdict === "followed" ? { verb: rule.actionVerb, branch: "main" } : {
            verb: "status",
            branch: "main",
            clean: false,
            tree: `dirty-${i}`,
          },
        );
      }
      events.push(
        firedHint(hint),
        {
          verb: rule.actionVerb,
          surface: "mcp",
          branch: "main",
          driver: {
            session: "mcp:other",
            json: false,
            tty: false,
            ci: false,
          },
        },
      );
      break;
  }
  return run(events);
}

function measuredHint(id: string): MeasuredHint {
  const hint = measuredHints().find((entry) => entry.id === id);
  assert(hint !== undefined, `${id} carries no follow-through rule`);
  return hint;
}

const STATUS_UPDATE_HINT = measuredHint("status-branch-behind");

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
  "hint-follow-through": {
    firing: followThroughFixture(STATUS_UPDATE_HINT, "not-followed"),
    quiet: {
      impossible:
        "informational: three resolved episodes always report the family's raw outcomes, including an all-followed result",
    },
    sparse: run([
      firedHint(STATUS_UPDATE_HINT),
      firedHint(STATUS_UPDATE_HINT),
      firedHint(STATUS_UPDATE_HINT),
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
  "confirmed-rerun": {
    firing: run([
      { verb: "done", flags: ["confirmed"] },
      { verb: "done", flags: ["confirmed"] },
      { verb: "done", flags: ["confirmed"] },
    ]),
    quiet: run([
      { verb: "done", flags: ["confirmed"] },
      { verb: "done" },
      { verb: "done" },
    ]),
    sparse: run([
      { verb: "done", flags: ["confirmed"] },
      { verb: "done", flags: ["confirmed"] },
    ]),
  },
  "pre-authorized-landings": {
    firing: run([
      accepted("conversation"),
      accepted("conversation"),
      accepted("conversation"),
      accepted("conversation"),
      accepted("standing-grant"),
      accepted("standing-grant"),
      accepted("standing-grant"),
      accepted("effort-grant"),
    ]),
    quiet: run(
      Array.from({ length: 8 }, () => accepted("conversation")),
    ),
    sparse: run([
      accepted("conversation"),
      accepted("conversation"),
      accepted("conversation"),
      accepted("conversation"),
      accepted("standing-grant"),
      accepted("standing-grant"),
      accepted("standing-grant"),
    ]),
  },
  "grant-suggestion": {
    firing: run(
      Array.from({ length: 12 }, () => accepted("conversation")),
    ),
    quiet: run([
      ...Array.from({ length: 6 }, () => accepted("conversation")),
      accepted("conversation", ["engine"]),
      ...Array.from({ length: 5 }, () => accepted("conversation")),
    ]),
    sparse: run(
      Array.from({ length: 11 }, () => accepted("conversation")),
    ),
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
  // The cohort fixtures model the observed fleet shapes: firing streams are
  // balanced two-cohort corpora, sparse streams are single-cohort ones. All
  // are attributed through process evidence alone — version-blind cohorts —
  // so the cohort guards can also assert nothing renders version attribution.
  "cohort-done-thrash": {
    firing: run([
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/thrash" }),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/calm" }),
      ...Array.from(
        { length: 5 },
        (): Partial<VerbEvent> =>
          cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/steady" }),
      ),
    ]),
    quiet: run([
      ...Array.from(
        { length: 5 },
        (_, i): Partial<VerbEvent> =>
          cohortRun("claude", "CLAUDECODE", {
            branch: i < 3 ? "agent/a" : "agent/b",
          }),
      ),
      ...Array.from(
        { length: 5 },
        (): Partial<VerbEvent> =>
          cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/steady" }),
      ),
    ]),
    sparse: run([
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/thrash" })),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/thrash" }),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/calm" }),
    ]),
  },
  "guidance-parity": {
    // Modeled on the live differential this wave was tuned against: one
    // cohort repeatedly refused a precondition its peer never hit.
    firing: run([
      ...Array.from(
        { length: 3 },
        (): Partial<VerbEvent> =>
          cohortRun("claude", "CLAUDECODE", {
            outcome: "refused",
            error: "unchanged_tree_rerun",
          }),
      ),
      cohortRun("claude", "CLAUDECODE", {}),
      cohortRun("claude", "CLAUDECODE", {}),
      ...Array.from(
        { length: 5 },
        (): Partial<VerbEvent> => cohortRun("codex", "CODEX_THREAD_ID", {}),
      ),
    ]),
    // A gap every cohort hits is a shared gap — it stays un-split.
    quiet: run([
      ...Array.from(
        { length: 3 },
        (): Partial<VerbEvent> =>
          cohortRun("claude", "CLAUDECODE", {
            outcome: "refused",
            error: "dirty_worktree",
          }),
      ),
      cohortRun("claude", "CLAUDECODE", {}),
      cohortRun("claude", "CLAUDECODE", {}),
      ...Array.from(
        { length: 3 },
        (): Partial<VerbEvent> =>
          cohortRun("codex", "CODEX_THREAD_ID", {
            outcome: "refused",
            error: "dirty_worktree",
          }),
      ),
      cohortRun("codex", "CODEX_THREAD_ID", {}),
      cohortRun("codex", "CODEX_THREAD_ID", {}),
    ]),
    sparse: run([
      ...Array.from(
        { length: 3 },
        (): Partial<VerbEvent> =>
          cohortRun("claude", "CLAUDECODE", {
            outcome: "refused",
            error: "unchanged_tree_rerun",
          }),
      ),
      cohortRun("claude", "CLAUDECODE", {}),
      cohortRun("claude", "CLAUDECODE", {}),
    ]),
  },
  "cohort-loops-to-green": {
    firing: run([
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/a" })),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/a" }),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/b" })),
      cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/b" })),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/b" }),
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/c" }),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/d" })),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/d" })),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/d" })),
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/d" }),
    ]),
    // Comparative on runs, but one cohort holds a single green branch — a
    // median of one branch is no median, so the split stays quiet.
    quiet: run([
      ...Array.from(
        { length: 4 },
        (): Partial<VerbEvent> =>
          cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/solo" })),
      ),
      cohortRun("claude", "CLAUDECODE", { branch: "agent/solo" }),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/c1" })),
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/c1" }),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/c2" })),
      cohortRun("codex", "CODEX_THREAD_ID", redDone({ branch: "agent/c2" })),
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/c2" }),
    ]),
    sparse: run([
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/c1" }),
      ...Array.from(
        { length: 4 },
        (): Partial<VerbEvent> =>
          cohortRun(
            "codex",
            "CODEX_THREAD_ID",
            redDone({ branch: "agent/c2" }),
          ),
      ),
      cohortRun("codex", "CODEX_THREAD_ID", { branch: "agent/c2" }),
    ]),
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
      PATTERN_FINDING_TONES.includes(d.tone),
      `${d.id}: unknown default tone ${d.tone}`,
    );
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

function detector(id: string): Detector {
  const found = DETECTORS.find((entry) => entry.id === id);
  assert(found !== undefined, `no detector ${id}`);
  return found;
}

Deno.test("hint follow-through: every declaring registry entry resolves followed, not-followed, and censored episodes", () => {
  const entries = measuredHints();
  assert(entries.length > 0, "the hint registry carries no outcome rules");
  const gateRemedies = Object.values(HINTS).filter((hint) =>
    hint.family === "gate-failure-remedy"
  );
  assert(gateRemedies.length > 0, "the gate-failure remedy family is empty");
  for (const hint of gateRemedies) {
    assert(
      hint.followThrough !== undefined,
      `${hint.id}: every gate-failure remedy inherits the family outcome rule`,
    );
  }
  for (
    const required of [
      "status-branch-behind",
      "done-unchanged-tree-red",
      "ensure-main-worktree-first",
    ] as const
  ) {
    assert(
      HINTS[required].followThrough !== undefined,
      `${required}: required follow-through declaration is missing`,
    );
  }
  const familyRules = new Map<string, HintFollowThroughRule>();
  const followThrough = detector("hint-follow-through");
  assertEquals(followThrough.threshold, 3);

  for (const hint of entries) {
    const rule = hint.followThrough;
    assert(
      Object.isFrozen(rule),
      `${hint.id}: follow-through declarations are frozen shared data`,
    );
    if (rule.kind === "branch-action-before-boundary") {
      assert(
        Object.isFrozen(rule.actionVerbs),
        `${hint.id}: action verbs are frozen shared data`,
      );
    }
    const existing = familyRules.get(rule.family);
    if (existing === undefined) {
      familyRules.set(rule.family, rule);
    } else {
      assert(
        existing === rule,
        `${hint.id}: ${rule.family} must reuse its one shared rule object`,
      );
    }

    const ignored = runDetector(
      followThrough,
      buildStreamFacts(
        followThroughFixture(hint, "not-followed"),
        "main",
      ),
    );
    assertEquals(ignored.status, "fired", hint.id);
    assertEquals(ignored.considered, 3, hint.id);
    const ignoredFinding = ignored.findings.find((finding) =>
      finding.subject === rule.family
    );
    assert(ignoredFinding !== undefined, `${hint.id}: no ignored finding`);
    assertEquals(ignoredFinding.evidence, {
      fired: 4,
      followed: 0,
      not_followed: 3,
      censored: 1,
    }, hint.id);
    assertEquals(ignoredFinding.tone, "attention", hint.id);

    const followed = runDetector(
      followThrough,
      buildStreamFacts(
        followThroughFixture(hint, "followed"),
        "main",
      ),
    );
    assertEquals(followed.status, "fired", hint.id);
    assertEquals(followed.considered, 3, hint.id);
    const followedFinding = followed.findings.find((finding) =>
      finding.subject === rule.family
    );
    assert(followedFinding !== undefined, `${hint.id}: no followed finding`);
    assertEquals(followedFinding.evidence, {
      fired: 4,
      followed: 3,
      not_followed: 0,
      censored: 1,
    }, hint.id);
    assertEquals(
      followedFinding.tone,
      "good",
      `${hint.id}: all-followed evidence stays informational`,
    );
  }
});

Deno.test("hint follow-through stays distinct from skipped prepare", () => {
  const hintDetector = detector("hint-follow-through");
  const prepareDetector = detector("skipped-prepare");
  const doneOnly = run([
    redDone(),
    redDone(),
    redDone(),
    { verb: "done" },
  ]);

  assertEquals(
    runDetector(
      hintDetector,
      buildStreamFacts(doneOnly, "main"),
    ).status,
    "insufficient-evidence",
    "done-heavy iteration without a delivered hint is not hint evidence",
  );
  assertEquals(
    runDetector(
      prepareDetector,
      buildStreamFacts(doneOnly, "main"),
    ).status,
    "fired",
  );

  const gateHint = measuredHints().find((entry) =>
    entry.followThrough.kind === "branch-action-before-boundary"
  );
  assert(gateHint !== undefined, "no red-gate outcome rule");
  const followed = followThroughFixture(gateHint, "followed");
  assertEquals(
    runDetector(
      hintDetector,
      buildStreamFacts(followed, "main"),
    ).findings[0]?.tone,
    "good",
  );
  assertEquals(
    runDetector(
      prepareDetector,
      buildStreamFacts(followed, "main"),
    ).status,
    "quiet",
    "prepare/test follow-through does not erase skipped-prepare's independent population",
  );
});

Deno.test("pre-authorized landings reports mixed consent sources, granted scopes, and a rate shift", () => {
  const detectorUnderTest = detector("pre-authorized-landings");
  const audit = report(
    detectorUnderTest,
    fixturesOf(detectorUnderTest).firing,
  );
  assertEquals(audit.status, "fired");
  assertEquals(audit.considered, 8);
  const summary = audit.findings.find((finding) =>
    finding.subject === undefined
  );
  assert(summary !== undefined);
  assertEquals(summary.evidence, {
    consent_recorded_landings: 8,
    pre_authorized_landings: 4,
    pre_authorized_share_pct: 50,
    standing_grant_landings: 3,
    effort_grant_landings: 1,
    longest_pre_authorized_streak: 4,
    current_pre_authorized_streak: 4,
    earlier_share_pct: 0,
    later_share_pct: 100,
  });
  assert(
    summary.observed.includes(
      "3 used a standing grant and 1 used an effort grant",
    ),
  );
  assert(
    summary.observed.includes(
      "share moved from 0% across the earlier 4 landings to 100%",
    ),
  );
  const docs = audit.findings.find((finding) => finding.subject === "docs");
  assertEquals(docs?.evidence, {
    scope_landings: 3,
    standing_grant_landings: 3,
  });
});

Deno.test("pre-authorized landings calls out a current single-source streak", () => {
  const events = run([
    ...Array.from({ length: 4 }, () => accepted("conversation")),
    ...Array.from({ length: 4 }, () => accepted("standing-grant")),
  ]);
  const audit = runDetector(
    detector("pre-authorized-landings"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(audit.status, "fired");
  const summary = audit.findings.find((finding) =>
    finding.subject === undefined
  );
  assert(summary !== undefined);
  assert(
    summary.brief.includes("current run 4 standing grant"),
    summary.brief,
  );
  assert(
    summary.observed.includes(
      "current run is 4 pre-authorized landings under the standing grant",
    ),
    summary.observed,
  );
});

Deno.test("grant suggestion names the scope after a dozen uninterrupted conversational landings", () => {
  const detectorUnderTest = detector("grant-suggestion");
  const suggestion = report(
    detectorUnderTest,
    fixturesOf(detectorUnderTest).firing,
  );
  assertEquals(suggestion.status, "fired");
  assertEquals(suggestion.considered, 12);
  assertEquals(suggestion.findings.length, 1);
  const finding = suggestion.findings[0];
  assertEquals(finding?.subject, "docs");
  assertEquals(finding?.evidence, {
    consecutive_conversational_landings: 12,
    scopes: 1,
    intervening_refusals: 0,
  });
  assert(
    finding?.next_step?.includes(
      "adding `docs` to `[acceptance].pre_authorized`",
    ),
  );
  assert(finding?.next_step?.includes("discern never writes grants"));
});

Deno.test("grant suggestion stays silent when a refusal interrupts the conversational run", () => {
  const events = run([
    ...Array.from({ length: 6 }, () => accepted("conversation")),
    {
      verb: "accept",
      outcome: "refused",
      error: "awaiting_consent",
    },
    ...Array.from({ length: 6 }, () => accepted("conversation")),
  ]);
  const suggestion = runDetector(
    detector("grant-suggestion"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(suggestion.considered, 13);
  assertEquals(suggestion.status, "quiet");
  assertEquals(suggestion.findings, []);
});

Deno.test("grant suggestion stays silent when a second scope interrupts the run", () => {
  const events = run([
    ...Array.from({ length: 6 }, () => accepted("conversation")),
    accepted("conversation", ["engine"]),
    ...Array.from({ length: 5 }, () => accepted("conversation")),
  ]);
  const suggestion = runDetector(
    detector("grant-suggestion"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(suggestion.considered, 12);
  assertEquals(suggestion.status, "quiet");
  assertEquals(suggestion.findings, []);
});

Deno.test("landing-authority detectors stay silent on an empty logbook", () => {
  const facts = buildStreamFacts([], "main");
  for (
    const id of ["pre-authorized-landings", "grant-suggestion"] as const
  ) {
    const outcome = runDetector(detector(id), facts);
    assertEquals(outcome.status, "insufficient-evidence", id);
    assertEquals(outcome.considered, 0, id);
    assertEquals(outcome.findings, [], id);
  }
});

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
      assert(f.brief.length > 0, `${d.id}: empty brief`);
      assert(
        PATTERN_FINDING_TONES.includes(f.tone ?? d.tone),
        `${d.id}: unknown finding tone ${f.tone ?? d.tone}`,
      );
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

// ── the cohort guards, parameterized off the registry flag ──────────────────

const COHORT_DETECTORS = DETECTORS.filter((d) => d.cohorts === true);

Deno.test("patterns cohorts: the cohort-capable set exists and declares honest routing", () => {
  assert(
    COHORT_DETECTORS.length >= 3,
    "the registry must declare its cohort-capable detectors",
  );
  for (const d of COHORT_DETECTORS) {
    assertEquals(
      d.tier,
      "batch",
      `${d.id}: longitudinal cohort analysis never rides a working surface`,
    );
    assertEquals(
      d.scope,
      "project",
      `${d.id}: a cohort split is a project-level reading`,
    );
    assertEquals(
      d.threshold,
      COHORT_MINIMUMS.cohorts,
      `${d.id}: considered counts qualifying cohorts against the seam's bar`,
    );
  }
});

Deno.test("patterns cohorts: denominator prose uses the shared human-number boundary", () => {
  assertEquals(
    denominatorClause({
      speaking: [{
        agent: "claude",
        label: "Claude Code",
        units: [],
        runs: 157_053_944,
      }],
      belowMinimum: [{
        agent: "codex",
        label: "Codex",
        units: [],
        runs: 2_400_000_000,
      }],
      unattributedUnits: 0,
      unattributedRuns: 1_234,
    }),
    "Claude Code 157.1M · 2.4B below the reporting minimums · 1,234 unattributed",
  );
});

for (const d of COHORT_DETECTORS) {
  Deno.test(`patterns cohorts ${d.id}: findings carry per-cohort denominators and the unattributed share`, () => {
    const r = report(d, fixturesOf(d).firing);
    assertEquals(r.status, "fired");
    for (const f of r.findings) {
      assertEquals(
        typeof f.evidence.unattributed_runs,
        "number",
        `${d.id}: the unattributed share is always reported`,
      );
      const denominators = Object.keys(f.evidence).filter((k) =>
        k.endsWith("_runs") && k !== "unattributed_runs" &&
        k !== "below_minimum_runs"
      );
      assert(
        denominators.length >= 2,
        `${d.id}: a cohort finding needs at least two per-cohort ` +
          `denominators, got ${Object.keys(f.evidence).join(", ")}`,
      );
      assert(
        f.observed.includes("unattributed"),
        `${d.id}: the sentence must state the unattributed share: ${f.observed}`,
      );
    }
  });

  Deno.test(`patterns cohorts ${d.id}: ambient evidence mints no cohort`, () => {
    const ambient = fixturesOf(d).firing.map((e): LogbookEvent =>
      e.kind === "verb"
        ? {
          ...e,
          driver: {
            ...e.driver,
            agent_signals: (e.driver?.agent_signals ?? []).map((s) => ({
              ...s,
              source: "host-filesystem" as const,
            })),
          },
        }
        : e
    );
    const r = report(d, ambient);
    assertEquals(
      r.status,
      "insufficient-evidence",
      `${d.id}: with only ambient identity evidence there is no cohort`,
    );
    assertEquals(r.considered, 0);
  });

  Deno.test(`patterns cohorts ${d.id}: a single-cohort corpus reports insufficient evidence`, () => {
    const single = fixturesOf(d).firing.map((e): LogbookEvent =>
      e.kind === "verb"
        ? {
          ...e,
          driver: {
            ...e.driver,
            agent_signals: (e.driver?.agent_signals ?? []).map((s) => ({
              ...s,
              agent: "codex",
            })),
          },
        }
        : e
    );
    const r = report(d, single);
    assertEquals(
      r.status,
      "insufficient-evidence",
      `${d.id}: one population is a description, not a comparison`,
    );
    assertEquals(r.findings, []);
  });

  Deno.test(`patterns cohorts ${d.id}: a version-blind cohort renders without version attribution`, () => {
    for (const e of fixturesOf(d).firing) {
      if (e.kind === "verb") {
        assertEquals(
          e.driver?.mcp_client,
          undefined,
          `${d.id}: the cohort fixtures model process-attributed cohorts`,
        );
      }
    }
    const r = report(d, fixturesOf(d).firing);
    assertEquals(r.status, "fired");
    for (const f of r.findings) {
      assert(
        !f.observed.includes("client release"),
        `${d.id}: no version attribution without client evidence: ${f.observed}`,
      );
    }
  });
}

Deno.test("patterns cohorts: a near-single-cohort corpus with a trace second stays silent", () => {
  // The observed fleet shape the minimums were tuned against: hundreds of
  // runs beside a single-digit trace. The trace cohort clears the absolute
  // floor, so this is the share floor holding at the detector level.
  const events = run([
    ...Array.from(
      { length: 60 },
      (): Partial<VerbEvent> =>
        cohortRun(
          "codex",
          "CODEX_THREAD_ID",
          redDone({ branch: "agent/busy" }),
        ),
    ),
    ...Array.from(
      { length: 6 },
      (): Partial<VerbEvent> =>
        cohortRun("claude", "CLAUDECODE", redDone({ branch: "agent/trace" })),
    ),
  ]);
  const thrash = DETECTORS.find((d) => d.id === "cohort-done-thrash");
  assert(thrash !== undefined);
  const r = runDetector(thrash, buildStreamFacts(events, "main"));
  assertEquals(r.status, "insufficient-evidence");
  assertEquals(r.findings, []);
});

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
      sections: ["jobs"],
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
          writer: "9.9.9",
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
    finding.observed.includes("0.9.0 → 9.9.9"),
    `the attribution must name the release move: ${finding.observed}`,
  );
});

/** A driver bundle declaring an MCP client the recorder recognized. */
function recognizedMcpClient(
  agent: string,
  name: string,
  version: string,
): VerbEvent["driver"] {
  return {
    session: "mcp:1",
    json: false,
    tty: false,
    ci: false,
    agent_signals: [
      { agent, source: "mcp-client", markers: ["clientInfo.name"] },
    ],
    mcp_client: { name, version },
  };
}

Deno.test("patterns attribution: the dominant client's version change bounds the window, naming the client, version pair, and date", () => {
  const events: LogbookEvent[] = [
    ...Array.from(
      { length: 5 },
      (_, i) =>
        verb({
          at: t(i),
          verb: "done",
          surface: "mcp",
          duration_ms: 10_000,
          driver: recognizedMcpClient(
            "codex",
            "codex-mcp-client",
            "0.145.0-alpha.27",
          ),
        }),
    ),
    ...Array.from(
      { length: 4 },
      (_, i) =>
        verb({
          at: t(6 + i),
          verb: "done",
          surface: "mcp",
          duration_ms: 30_000,
          driver: recognizedMcpClient(
            "codex",
            "codex-mcp-client",
            "0.145.0-alpha.30",
          ),
        }),
    ),
  ];
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(creep, buildStreamFacts(events, "main"));
  assertEquals(
    outcome.findings.length,
    1,
    "a client-release boundary with too short a tail must be attributed, not silent",
  );
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes(
      "Codex 0.145.0-alpha.27 → 0.145.0-alpha.30 client release",
    ),
    `the attribution must name the client and version pair: ${finding.observed}`,
  );
  assert(
    finding.observed.includes("2026-07-01"),
    `the attribution must date the boundary: ${finding.observed}`,
  );
});

Deno.test("patterns attribution: a version-blind stream trends normally — absence of client evidence is silent", () => {
  // The same shift with no client declarations anywhere: the trend compares
  // across the whole window and reports the creep itself, with no client
  // attribution and no error.
  const events: LogbookEvent[] = [
    ...Array.from(
      { length: 4 },
      (_, i) => verb({ at: t(i), verb: "done", duration_ms: 10_000 }),
    ),
    ...Array.from(
      { length: 4 },
      (_, i) => verb({ at: t(6 + i), verb: "done", duration_ms: 30_000 }),
    ),
  ];
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(creep, buildStreamFacts(events, "main"));
  assertEquals(outcome.findings.length, 1);
  assert(
    !(outcome.findings[0]?.observed.includes("client release") ?? true),
    `no client attribution may appear without client evidence: ${
      outcome.findings[0]?.observed
    }`,
  );
});

Deno.test("patterns attribution: comparableTail keeps only the newest epoch+writer run", () => {
  const events = [
    verb({ at: t(0), epoch: "a", writer: "9.9.9" }),
    verb({ at: t(1), epoch: "b", writer: "9.9.9" }),
    verb({ at: t(2), epoch: "b", writer: "9.9.9" }),
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
  assertEquals(finding.tone, "good");
  assertEquals(finding.evidence.limit_first, 80);
  assertEquals(finding.evidence.limit_last, 80);
});

Deno.test("patterns trajectory: direction-aware facts decide tone without changing rank", () => {
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const cases = [
    {
      label: "up moves away",
      values: [80, 81, 82, 83, 84],
      limit: 90,
      direction: "up" as const,
      tone: "good",
      wording: "improving",
      limitWord: "floor",
    },
    {
      label: "down moves away",
      values: [105, 104, 103, 102, 101],
      limit: 100,
      direction: "down" as const,
      tone: "good",
      wording: "improving",
      limitWord: "ceiling",
    },
    {
      label: "up drifts toward",
      values: [89, 88, 87, 86, 85],
      limit: 90,
      direction: "up" as const,
      tone: "attention",
      wording: "headroom shrinking",
      limitWord: "floor",
    },
    {
      label: "flat",
      values: [80, 80, 80, 80, 80],
      limit: 90,
      direction: "up" as const,
      tone: "neutral",
      wording: "holding",
      limitWord: "floor",
    },
    {
      label: "down has sustained slack",
      values: [99, 98, 97, 96, 95],
      limit: 100,
      direction: "down" as const,
      tone: "good",
      wording: "beating its limit",
      limitWord: "ceiling",
    },
  ] as const;
  for (const item of cases) {
    const events = run(item.values.map((value) => ({
      standards: [reading("metric", value, item.limit, item.direction)],
    })));
    const outcome = runDetector(
      trajectory,
      buildStreamFacts(events, "main"),
    );
    const finding = outcome.findings[0];
    assert(finding !== undefined, item.label);
    assertEquals(finding.tone, item.tone, item.label);
    assert(
      finding.brief.includes(item.wording),
      `${item.label}: ${finding.brief}`,
    );
    assert(
      finding.brief.includes(item.limitWord),
      `${item.label}: ${finding.brief}`,
    );
    assertEquals(finding.strength, item.values.length);
  }
});

Deno.test("patterns trajectory: the brief compares today's value with today's limit", () => {
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const values = [825, 830, 850, 880, 900];
  const limits = [900, 900, 900, 837, 837];
  const events = run(values.map((value, i) => ({
    standards: [reading("guidance", value, limits[i] ?? 837, "down")],
  })));
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assertEquals(
    finding.brief,
    "825 → 900 vs ceiling 837 — headroom shrinking",
  );
  assertEquals(finding.tone, "attention");
  assertEquals(finding.evidence.limit_first, 900);
  assertEquals(finding.evidence.limit_last, 837);
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

Deno.test("patterns red-rate history counts partial effects in live and rotated months", () => {
  const events: LogbookEvent[] = [
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: "2026-06-01T00:00:00.000Z",
      kind: "prune",
      removed: [
        { file: "2026-04.jsonl", events: 5, ok: 4, partial: 1 },
        { file: "2026-05.jsonl", events: 4, ok: 3, partial: 1 },
      ],
    },
    verb({ at: "2026-06-02T10:00:00.000Z", outcome: "ok" }),
    verb({
      at: "2026-06-03T10:00:00.000Z",
      verb: "accept",
      outcome: "partial",
    }),
  ];
  const history = DETECTORS.find((d) => d.id === "red-rate-history");
  assert(history !== undefined);
  const outcome = runDetector(history, buildStreamFacts(events, "main"));
  assertEquals(outcome.considered, 3);
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("2026-04 20% (coarse)"),
    `rotated partial effects must remain red: ${finding.observed}`,
  );
  assert(
    finding.observed.includes("2026-06 50%"),
    `live partial effects must remain red: ${finding.observed}`,
  );
});
