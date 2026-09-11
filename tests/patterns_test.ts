import {
  canaryMiss,
  detector,
  failedValidationCycle,
  redDone,
  repeatedGreenRuns,
  run,
  step,
  t,
  timedEvents,
  timedRun,
  validation,
  type ValidationFixtureOptions,
  verb,
} from "./patterns_event_fixtures.ts";
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
 *  - **setup attribution**: a trend whose candidates ran under several setups
 *    (config epoch, writer release, client version) compares only the runs
 *    sharing the newest run's setup — by equality, never contiguity, so
 *    parallel-worktree interleaving cannot fragment a series — and names the
 *    excluded setups instead of comparing across them or going silent; the
 *    windowed guards iterate every `windowed` detector, so a new trend
 *    detector inherits the interleaving invariants by marking itself;
 *  - **coarse-history honesty**: rotation digests extend the red-rate series,
 *    marked coarse;
 *  - **writer/reader parity**: every event kind and top-level driver signal in
 *    the tolerant schema is consumed by the reader layer or recorded as
 *    deliberately unread with a reason — exactly one of the two.
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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
  splitByCohort,
} from "../src/engine/logbook/cohorts.ts";
import {
  buildStreamFacts,
  comparableSeries,
  type Detector,
  type DetectorFinding,
  type DetectorReport,
  DETECTORS,
  DORMANT_VERB_EXEMPTIONS,
  dormantWatchedVerbs,
  runDetector,
  tipAdoptionOutcome,
} from "../src/engine/logbook/detectors.ts";
import { routedFindingData } from "../src/engine/logbook/routing.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  logbookEventSchema,
  type VerbEvent,
  verbEventSchema,
} from "../src/engine/logbook/schema.ts";
import { VALIDATION_EVIDENCE_SCHEMA_FIELDS } from "../src/engine/logbook/validation.ts";
import {
  VALIDATION_COMPARISON_FIELD_ACCOUNTING,
  VALIDATION_COMPARISON_IDENTITY_SOURCES,
  VALIDATION_COMPATIBILITY_DETECTOR_ID,
  VALIDATION_CONTROLLED_CONDITIONS,
  VALIDATION_FINDING_RELATIONSHIPS,
} from "../src/engine/logbook/validation_findings.ts";
import {
  boundedPatternEvidenceCondition,
  DETECTOR_FAMILIES,
  type DetectorFamily,
  PATTERN_EVIDENCE_CONDITION_VALUES_MAX,
  PATTERN_FINDING_TONES,
  PatternEvidenceConditionSchema,
  PATTERNS_SERIES_MAX_POINTS,
  PatternsFindingSchema,
} from "../src/shared/patterns_vocabulary.ts";
import { type HintFollowThroughRule, HINTS } from "../src/shared/hints.ts";
import {
  defineTip,
  type RegisteredTip,
  type TipFollowThroughRule,
  TIPS,
} from "../src/shared/tips.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

// ── writer/reader parity ───────────────────────────────────────────────────

/** The reader layer whose source-level references account for the schema's
 * event kinds and raw driver signals. This deliberately observes the existing
 * seam; readers do not register themselves with a framework for the test. */
const LOGBOOK_READER_MODULES = [
  "src/engine/logbook/agent_identity.ts",
  "src/engine/logbook/patterns.ts",
  "src/engine/logbook/completion_report.ts",
  "src/engine/logbook/detectors.ts",
  "src/engine/logbook/cohorts.ts",
  "src/engine/logbook/read.ts",
  "src/engine/logbook/stats.ts",
] as const;

/** Schema members a reader deliberately does not consume, each with its
 * reason. */
const DELIBERATELY_UNREAD_EVENT_KINDS: Readonly<Record<string, string>> = {};
const DELIBERATELY_UNREAD_DRIVER_SIGNALS: Readonly<
  Record<string, string>
> = {
  json: "A requested format is not evidence of the caller's identity.",
  markdown: "A requested format is not evidence of the caller's identity.",
};

/** Quote event and driver field names before scanning reader source. */
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

/** Combine every enrolled logbook reader module for closed-set consumption checks. */
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

/** A red `done` where a quick check failed and the long suite was cancelled
 * mid-flight (`"cancelled"`) or never started (`"skipped"`) — the first half
 * of a masked-failures instance. */
function maskedRed(suiteOutcome: "cancelled" | "skipped"): Partial<VerbEvent> {
  return redDone({
    steps: [
      { ...step("lint", 1), outcome: "failed" },
      { ...step("test", 150), outcome: suiteOutcome },
    ],
  });
}

/** The revealing follow-up run: the check is fixed and the suite's own,
 * independent failure surfaces — the second half of a masked-failures
 * instance. */
function suiteReveal(): Partial<VerbEvent> {
  return redDone({
    steps: [step("lint", 1), { ...step("test", 150), outcome: "failed" }],
  });
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

/** A clean Gate stopped because a declared regeneration was stale. */
function regenerationDrift(head: string): Partial<VerbEvent> {
  return {
    verb: "done",
    head,
    clean: true,
    outcome: "failed",
    failed_stage: "generated_drift",
  };
}

/** A clean Gate stopped at the early checkpoint after only its fixer ran. */
function fixDrift(head: string): Partial<VerbEvent> {
  return {
    verb: "done",
    head,
    clean: true,
    outcome: "failed",
    failed_stage: "tree_drift",
    steps: [step("fmt", 1, "Fix")],
  };
}

/** A `standards` reading carried on a verb event. */
function reading(
  name: string,
  value: number,
  limit: number,
  direction: "up" | "down" = "up",
): NonNullable<VerbEvent["standards"]>[number] {
  const eligible = direction === "up" ? value > limit : value < limit;
  return {
    name,
    value,
    limit,
    direction,
    margin: 0,
    measurement: "measured",
    verdict: eligible ? "improved" : "regressed",
    pin_eligible: eligible,
    ...(eligible ? { pin_target: value } : {}),
  };
}

/** A current Standard reading carrying the Gate-owned pin decision evidence. */
function decisionReading(
  name: string,
  value: number | undefined,
  limit: number,
  over: {
    direction?: "up" | "down";
    margin?: number;
    /** Logbook history may still carry `deferred` from the retired
     * on-demand mode; the live vocabulary no longer produces it. */
    measurement?: "measured" | "replayed" | "deferred" | "skipped";
    verdict?: "improved" | "held" | "regressed";
    pinEligible?: boolean;
    pinTarget?: number;
  } = {},
): NonNullable<VerbEvent["standards"]>[number] {
  return {
    name,
    direction: over.direction ?? "up",
    limit,
    margin: over.margin ?? 0,
    measurement: over.measurement ?? "measured",
    ...(value !== undefined ? { value } : {}),
    ...(over.verdict !== undefined ? { verdict: over.verdict } : {}),
    ...(over.pinEligible !== undefined
      ? { pin_eligible: over.pinEligible }
      : {}),
    ...(over.pinTarget !== undefined ? { pin_target: over.pinTarget } : {}),
  } as unknown as NonNullable<VerbEvent["standards"]>[number];
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

/** Construct the event shape that fires a hint's declared follow-through rule. */
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
    case "checkpoint-revision-before-declaration":
      return {
        verb: "done",
        outcome: "refused",
        error: "awaiting_declaration",
        hint_ids: [hint.id],
        checkpoints: {
          fired: [{ id: "api-review", definition: "d1", subject: "s1" }],
        },
        ...over,
      };
  }
}

/** The declaring event that resolves one checkpoint-declaration episode. */
function declaredCheckpoint(revised: boolean): Partial<VerbEvent> {
  return {
    verb: "done",
    checkpoints: {
      ...(revised
        ? { reopened: [{ id: "api-review", definition: "d1", subject: "s2" }] }
        : {}),
      declared: [{
        id: "api-review",
        conclusion: "met",
        revised,
        definition: "d1",
        subject: revised ? "s2" : "s1",
        elapsed_ms: 60_000,
      }],
    },
  };
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
    case "checkpoint-revision-before-declaration":
      for (let i = 0; i < 3; i += 1) {
        events.push(
          firedHint(hint),
          declaredCheckpoint(verdict === "followed"),
        );
      }
      // A trailing serving the history ends on stays censored.
      events.push(firedHint(hint));
      break;
  }
  return run(events);
}

/** Resolve a registered hint that declares observable follow-through, failing if it does not. */
function measuredHint(id: string): MeasuredHint {
  const hint = measuredHints().find((entry) => entry.id === id);
  assert(hint !== undefined, `${id} carries no follow-through rule`);
  return hint;
}

const STATUS_UPDATE_HINT = measuredHint("status-branch-behind");

interface MeasuredTip {
  id: string;
  followThrough: TipFollowThroughRule;
}

/** Every tip that declares an observable adoption. Passing a synthetic
 * registry proves the evaluator enrolls declarations instead of consulting a
 * detector-side id table. */
function measuredTips(
  registry: readonly RegisteredTip[] = TIPS,
): MeasuredTip[] {
  return registry.flatMap((tip) =>
    tip.followThrough === undefined
      ? []
      : [{ id: tip.id, followThrough: tip.followThrough }]
  );
}

/** Record a desk event that displayed one adoption-measured tip. */
function shownTip(
  tip: MeasuredTip,
  over: Partial<VerbEvent> = {},
): Partial<VerbEvent> {
  return { verb: "desk", tip_ids: [tip.id], ...over };
}

/** Build the first declared adoption action for a measured tip. */
function tippedVerb(
  tip: MeasuredTip,
  over: Partial<VerbEvent> = {},
): Partial<VerbEvent> {
  const verb = tip.followThrough.verbs[0];
  assert(verb !== undefined, `${tip.id}: no adoption verb`);
  return { verb, ...over };
}

/** Three resolved episodes plus one history-end censor for one declaring tip. */
function tipAdoptionFixture(
  tip: MeasuredTip,
  verdict: EpisodeVerdict,
  actionSurface: VerbEvent["surface"] = "cli",
): LogbookEvent[] {
  const events: Partial<VerbEvent>[] = [];
  if (verdict === "followed") {
    for (let i = 0; i < 3; i += 1) {
      events.push(
        shownTip(tip),
        tippedVerb(
          tip,
          actionSurface === "mcp"
            ? {
              surface: "mcp",
              driver: {
                session: `mcp:tip-${i}`,
                json: false,
                tty: false,
                ci: false,
              },
            }
            : {},
        ),
      );
    }
    events.push(shownTip(tip));
  } else {
    events.push(
      shownTip(tip),
      shownTip(tip),
      shownTip(tip),
      shownTip(tip),
    );
  }
  return run(events);
}

/** Resolve a registered tip that declares observable adoption, failing if it does not. */
function measuredTip(id: string): MeasuredTip {
  const tip = measuredTips().find((entry) => entry.id === id);
  assert(tip !== undefined, `${id} carries no adoption rule`);
  return tip;
}

const PATTERNS_TIP = measuredTip("patterns-practice-report");

/** Distinct gate-run efforts with no checkpoint activity, `offset` onward. */
function gateEfforts(count: number, offset = 0): Partial<VerbEvent>[] {
  return Array.from({ length: count }, (_, i) => ({
    branch: `agent/e${offset + i}`,
  }));
}

/** Distinct gate-run efforts each served one checkpoint firing. */
function servedEfforts(id: string, count: number): Partial<VerbEvent>[] {
  return Array.from({ length: count }, (_, i) => ({
    branch: `agent/e${i}`,
    checkpoints: { fired: [{ id, subject: `s${i}` }] },
  }));
}

/** One landed effort where a checkpoint fired — with or without an
 * owner-authorized variance carried by the landing. */
function variedEffort(
  id: string,
  index: number,
  withVariance: boolean,
): Partial<VerbEvent>[] {
  return [
    {
      branch: `agent/v${index}`,
      checkpoints: { fired: [{ id, subject: `s${index}` }] },
    },
    {
      branch: `agent/v${index}`,
      verb: "accept",
      ...(withVariance
        ? { checkpoints: { variances: [{ id, subject: `s${index}` }] } }
        : {}),
    },
  ];
}

// ── the fixture table (keyed by detector id — the forcing tie) ──────────────

/** A quiet state that cannot exist gets a recorded reason instead of events. */
type QuietFixture = LogbookEvent[] | { impossible: string };

interface DetectorFixtures {
  /** Clears the threshold and produces at least one finding. */
  firing: LogbookEvent[];
  /** Clears the threshold and produces none. */
  quiet: QuietFixture;
  /** Sits below the threshold (and carries no other-setup runs to attribute). */
  sparse: LogbookEvent[];
  /** Configured native providers the stream is read against, for detectors
   * whose verdict depends on config context (shared by all three streams). */
  configured_agents?: string[];
  /** Configured checkpoint ids the stream is read against, for the checkpoint
   * hygiene detectors (shared by all three streams). */
  configured_checkpoints?: string[];
}

const FIXTURES: Record<string, DetectorFixtures> = {
  "canary-drift": {
    firing: run(Array.from({ length: 5 }, (_, i) => canaryMiss(i))),
    quiet: run(
      Array.from(
        { length: 5 },
        (_, i) => canaryMiss(i, `tests/file-${i}_test.ts`),
      ),
    ),
    sparse: run(Array.from({ length: 4 }, (_, i) => canaryMiss(i))),
  },
  "done-thrash": {
    firing: failedValidationCycle(),
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
  "tip-adoption": {
    firing: tipAdoptionFixture(PATTERNS_TIP, "not-followed"),
    quiet: {
      impossible:
        "informational: three resolved episodes always report the tip's raw outcomes, including an all-followed result",
    },
    sparse: run([
      shownTip(PATTERNS_TIP),
      shownTip(PATTERNS_TIP),
      shownTip(PATTERNS_TIP),
    ]),
  },
  "skipped-prepare": {
    firing: run([regenerationDrift("head-a"), fixDrift("head-b")]),
    quiet: run([
      redDone({ head: "head-a" }),
      redDone({ head: "head-b" }),
    ]),
    sparse: run([regenerationDrift("head-a")]),
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
      { verb: "done", flags: ["rerun"] },
      { verb: "done", flags: ["rerun"] },
      // The compatibility spelling remains enrolled while callers migrate.
      { verb: "done", flags: ["confirmed"] },
    ]),
    quiet: run([
      { verb: "done", flags: ["rerun"] },
      { verb: "done" },
      { verb: "done" },
    ]),
    sparse: run([
      { verb: "done", flags: ["rerun"] },
      { verb: "done", flags: ["rerun"] },
    ]),
  },
  "dormant-verbs": {
    // The quiet stream derives from the watched universe itself (padded past
    // the threshold), so a newly registered verb keeps it complete by
    // construction.
    firing: run(
      Array.from({ length: 25 }, () => ({ verb: "done" as const })),
    ),
    quiet: run([
      ...[...dormantWatchedVerbs()].sort().map((name) => ({ verb: name })),
      ...Array.from({ length: 25 }, () => ({ verb: "done" })),
    ]),
    sparse: run(
      Array.from({ length: 19 }, () => ({ verb: "done" as const })),
    ),
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
      { verb: "docs", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "docs", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "docs", target: "quickstart" },
      { verb: "map", target: "overview" },
      { verb: "docs", target: "standards" },
    ]),
    quiet: run([
      { verb: "docs", target: "a" },
      { verb: "docs", target: "b" },
      { verb: "docs", target: "c" },
      { verb: "map", target: "d" },
      { verb: "map", target: "e" },
    ]),
    sparse: run([
      { verb: "docs", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "docs", target: "gates", outcome: "refused", error: "not_found" },
      { verb: "docs", target: "quickstart" },
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
    firing: repeatedGreenRuns(),
    quiet: run(Array.from({ length: 3 }, (_, i) => ({
      invocation: `distinct-${i}`,
      gate_ran: true,
      validation: validation("passed", {
        mode: "full-gate",
        digest: `state-${i}`,
      }),
    }))),
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
  "instruction-parity": {
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
        scopes: ["engine"],
        steps: [
          { ...step("scope:docs", 30), kind: "scope-gate" },
          step("test", 5),
        ],
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
  "generator-gate-share": {
    firing: run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        validation: validation("passed", { digest: "generated-state" }),
        steps: [
          step("generated:schemas", 20, "Build"),
          step("generated:docs", 10, "Build"),
          step("lint", 10),
          step("test", 10),
        ],
      })),
    ),
    quiet: run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        steps: [
          step("generated:schemas", 10, "Build"),
          step("lint", 10),
          step("test", 10),
        ],
      })),
    ),
    sparse: run(
      Array.from({ length: 4 }, () => ({
        verb: "done",
        steps: [step("generated:schemas", 20, "Build"), step("lint", 5)],
      })),
    ),
  },
  "slot-contention": {
    firing: run(
      Array.from({ length: 6 }, () => ({
        verb: "done",
        duration_ms: 160_000,
        waited_ms: 60_000,
      })),
    ),
    quiet: run(
      Array.from({ length: 6 }, () => ({
        verb: "done",
        duration_ms: 110_000,
        waited_ms: 10_000,
      })),
    ),
    sparse: run(
      Array.from({ length: 5 }, () => ({
        verb: "done",
        duration_ms: 160_000,
        waited_ms: 60_000,
      })),
    ),
  },
  "masked-failures": {
    // Alternating mask/reveal pairs; one pair uses the never-started (barrier)
    // variant. The quiet stream repeats one persistent suite failure beside a
    // cancelled sibling — attribution unsafe there, so never an instance.
    firing: run([
      maskedRed("cancelled"),
      suiteReveal(),
      maskedRed("skipped"),
      suiteReveal(),
      maskedRed("cancelled"),
      suiteReveal(),
      maskedRed("cancelled"),
      suiteReveal(),
    ]),
    quiet: run(
      Array.from({ length: 8 }, () =>
        redDone({
          steps: [
            { ...step("test", 150), outcome: "failed" },
            { ...step("lint", 1), outcome: "cancelled" },
          ],
        })),
    ),
    sparse: run([
      maskedRed("cancelled"),
      suiteReveal(),
      maskedRed("cancelled"),
      suiteReveal(),
    ]),
  },
  "duration-creep": {
    firing: timedRun(
      Array.from({ length: 8 }, (_, i) => ({
        verb: "done",
        duration_ms: i < 4 ? 10_000 : 20_000,
        change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
      })),
    ),
    quiet: timedRun(
      Array.from({ length: 8 }, () => ({
        verb: "done",
        duration_ms: 10_000,
        change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
      })),
    ),
    sparse: timedRun(
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
      {
        verb: "test",
        outcome: "failed",
        validation: validation("failed", { job: "future-verifier" }),
      },
      {
        verb: "test",
        validation: validation("passed", { job: "future-verifier" }),
      },
    ]),
    quiet: run([
      { verb: "test", validation: validation("passed") },
      { verb: "test", validation: validation("passed") },
    ]),
    sparse: run([
      { verb: "test", validation: validation("passed") },
    ]),
  },
  "execution-context-divergence": {
    firing: run([
      {
        verb: "test",
        outcome: "failed",
        validation: validation("failed"),
      },
      {
        verb: "done",
        validation: validation("passed", {
          mode: "full-gate",
          concurrent: true,
          siblings: [{ id: "lint", outcome: "passed", stage: "check" }],
        }),
      },
    ]),
    quiet: run([
      { verb: "test", validation: validation("passed") },
      {
        verb: "done",
        validation: validation("passed", { mode: "full-gate" }),
      },
    ]),
    sparse: run([
      { verb: "test", validation: validation("failed") },
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
  "checkpoint-dead": {
    firing: run(gateEfforts(8)),
    quiet: run([
      ...gateEfforts(8),
      {
        branch: "agent/e0",
        checkpoints: { fired: [{ id: "silent-rule" }] },
      },
    ]),
    sparse: run(gateEfforts(7)),
    configured_checkpoints: ["silent-rule"],
  },
  "checkpoint-noisy": {
    firing: run([
      ...servedEfforts("chatty-rule", 8),
      ...gateEfforts(2, 8),
    ]),
    quiet: run([
      ...servedEfforts("chatty-rule", 3),
      ...gateEfforts(7, 3),
    ]),
    sparse: run(servedEfforts("chatty-rule", 7)),
  },
  "checkpoint-varied": {
    firing: run([
      ...variedEffort("soft-rule", 0, true),
      ...variedEffort("soft-rule", 1, true),
      ...variedEffort("soft-rule", 2, true),
    ]),
    quiet: run([
      ...variedEffort("soft-rule", 0, true),
      ...variedEffort("soft-rule", 1, false),
      ...variedEffort("soft-rule", 2, false),
    ]),
    sparse: run([
      ...variedEffort("soft-rule", 0, true),
      ...variedEffort("soft-rule", 1, true),
    ]),
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

Deno.test("patterns registry: every detector stays bounded on a large history", () => {
  const standards = Array.from(
    { length: 12 },
    (_, index) => reading(`large-history-${index}`, 100 + index, 80),
  );
  const events = Array.from({ length: 1_200 }, (_, index) =>
    verb({
      at: t(index),
      duration_ms: index % 2 === 0 ? 5_000 : 10_000,
      outcome: "failed",
      failed_stage: "check/test",
      driver: {
        session: "mcp:large-history",
        json: true,
        tty: false,
        ci: false,
        mcp_client: {
          name: "synthetic-client",
          version: `9.9.${Math.floor(index / 300)}`,
        },
      },
      standards,
      steps: index % 2 === 0
        ? [
          { ...step("lint", 1), outcome: "failed" },
          { ...step("test", 0), outcome: "cancelled" },
        ]
        : [
          step("lint", 1),
          { ...step("test", 10), outcome: "failed" },
        ],
    }));
  const facts = buildStreamFacts(events, "main");
  const timings: { id: string; milliseconds: number }[] = [];
  const started = SYSTEM_CLOCK.monotonicNow();
  for (const entry of DETECTORS) {
    const detectorStarted = SYSTEM_CLOCK.monotonicNow();
    runDetector(entry, facts);
    timings.push({
      id: entry.id,
      milliseconds: SYSTEM_CLOCK.monotonicNow() - detectorStarted,
    });
  }
  const elapsed = SYSTEM_CLOCK.monotonicNow() - started;
  const slow = timings.filter((timing) => timing.milliseconds >= 2_000);
  assertEquals(
    slow,
    [],
    `large-history detectors exceeded 2s: ${JSON.stringify(slow)}`,
  );
  assert(
    elapsed < 6_000,
    `the enrolled detector registry took ${Math.round(elapsed)}ms on 1,200 ` +
      `events: ${JSON.stringify(timings)}`,
  );
});

Deno.test("patterns registry: every detector supplies its three fixtures", () => {
  assertEquals(
    Object.keys(FIXTURES).sort(),
    DETECTORS.map((d) => d.id).sort(),
    "the fixture table must cover exactly the registry — a new detector " +
      "enrols here with firing/quiet/sparse streams (see DetectorFixtures)",
  );
});

Deno.test("patterns registry: dormant-verb exemptions name known verbs with recorded reasons", () => {
  // The class: an exemption must be a deliberate, readable decision about a
  // real verb — a stale or reasonless entry silently narrows what dormancy
  // watching covers.
  for (const [name, reason] of Object.entries(DORMANT_VERB_EXEMPTIONS)) {
    assert(KNOWN_VERBS.has(name), `exemption ${name} names no known verb`);
    assert(reason.length > 0, `exemption ${name} carries no reason`);
  }
  const watched = dormantWatchedVerbs();
  for (const name of Object.keys(DORMANT_VERB_EXEMPTIONS)) {
    assert(!watched.has(name), `exempt verb ${name} is still watched`);
  }
  assert(watched.size > 0, "the dormancy universe must not be empty");
});

Deno.test("validation finding registry: relationships have unique detector ids and one retained compatibility id", () => {
  const relationshipIds = VALIDATION_FINDING_RELATIONSHIPS.map((relationship) =>
    relationship.detectorId
  );
  assertEquals(
    relationshipIds.length,
    new Set(relationshipIds).size,
    "one relationship cannot publish a duplicate finding under another registry row",
  );
  const enrolled = DETECTORS.filter((entry) =>
    entry.validationRelationship !== undefined
  );
  assertEquals(
    enrolled.map((entry) => entry.id).sort(),
    [...relationshipIds].sort(),
    "every validation relationship and detector must enroll each other",
  );
  assertEquals(
    VALIDATION_FINDING_RELATIONSHIPS.filter((relationship) =>
      "compatibility" in relationship
    ).map((relationship) => relationship.detectorId),
    [VALIDATION_COMPATIBILITY_DETECTOR_ID],
  );
  assertEquals(
    VALIDATION_COMPATIBILITY_DETECTOR_ID,
    "same-tree-flake",
    "the published compatibility id remains the sole retained id",
  );
});

Deno.test("validation finding registry: every relationship fixture carries the common evidence basis", () => {
  for (const relationship of VALIDATION_FINDING_RELATIONSHIPS) {
    const entry = detector(relationship.detectorId);
    const outcome = report(entry, fixturesOf(entry).firing);
    assertEquals(outcome.status, "fired", relationship.kind);
    for (const finding of outcome.findings) {
      const basis = findingBasis(finding);
      assertEquals(
        Object.keys(basis.values).sort(),
        Object.keys(finding.evidence).sort(),
        relationship.kind,
      );
      for (const [key, value] of Object.entries(finding.evidence)) {
        assertEquals(
          basis.values[key]?.value,
          value,
          `${relationship.kind}:${key}`,
        );
      }
    }
  }
});

Deno.test("validation comparison accounting: every live schema field has one declared role", () => {
  for (const layer of ["evidence", "state", "execution", "job"] as const) {
    assertEquals(
      Object.keys(VALIDATION_COMPARISON_FIELD_ACCOUNTING[layer]).sort(),
      [...VALIDATION_EVIDENCE_SCHEMA_FIELDS[layer]].sort(),
      `${layer}: a new evidence field must declare how comparison handles it`,
    );
  }
});

Deno.test("validation comparison accounting: every identity and controlled field enters the pure projection", () => {
  const projected = new Set<string>([
    ...VALIDATION_COMPARISON_IDENTITY_SOURCES,
    ...VALIDATION_CONTROLLED_CONDITIONS.flatMap((condition) =>
      condition.sources
    ),
  ]);
  const required: string[] = [];
  for (
    const [layer, fields] of Object.entries(
      VALIDATION_COMPARISON_FIELD_ACCOUNTING,
    )
  ) {
    for (const [field, role] of Object.entries(fields)) {
      if (
        role === "comparison-identity" || role === "controlled-condition" ||
        role === "recorded-job-enrollment" || role === "job-identity"
      ) {
        required.push(`${layer}.${field}`);
      }
    }
  }
  assertEquals(
    [...projected].sort(),
    required.sort(),
    "comparison identity and controlled conditions must derive from every classified v1 field",
  );
  assertEquals(
    VALIDATION_CONTROLLED_CONDITIONS.map((condition) => condition.id).length,
    new Set(VALIDATION_CONTROLLED_CONDITIONS.map((condition) => condition.id))
      .size,
    "controlled-condition ids are unique",
  );
});

// ── the three behaviours, parameterized ─────────────────────────────────────

/** Require the firing, quiet, and evidence-limited fixtures enrolled for one detector. */
function fixturesOf(d: Detector): DetectorFixtures {
  const fixtures = FIXTURES[d.id];
  assert(fixtures !== undefined, `no fixtures for ${d.id}`);
  return fixtures;
}

/** Build detector-specific stream facts, including configured agents, before evaluating a fixture. */
function report(d: Detector, events: LogbookEvent[]): DetectorReport {
  return runDetector(
    d,
    buildStreamFacts(
      events,
      "main",
      fixturesOf(d).configured_agents ?? [],
      fixturesOf(d).configured_checkpoints ?? [],
    ),
  );
}

interface FindingBasisView {
  kind: string;
  coverage: { comparable: number; denominator: number; unit: string };
  validation_state: { version: number | null; complete: boolean };
  matched_conditions: Array<{
    dimension: string;
    values: string[];
    distinct: number;
    omitted: number;
  }>;
  differing_conditions: Array<{
    dimension: string;
    values: string[];
    distinct: number;
    omitted: number;
  }>;
  excluded_events: number;
  limitations: string[];
  values: Record<string, { value: number; kind: string }>;
}

/** Read the additive evidence contract before its inferred type exists. */
function findingBasis(
  finding: DetectorReport["findings"][number] | undefined,
): FindingBasisView {
  assert(finding !== undefined, "expected a finding");
  const basis = (finding as unknown as { basis?: FindingBasisView }).basis;
  assert(basis !== undefined, "expected structured finding basis");
  return basis;
}

/** Every controlled-condition dimension named by a finding, in stable order. */
function differingDimensions(basis: FindingBasisView): string[] {
  return basis.differing_conditions.map((condition) => condition.dimension);
}

Deno.test("validation findings: each recorded job auto-enrols in strict same-envelope divergence", () => {
  for (const mode of ["standalone-test", "full-gate"] as const) {
    const fired = runDetector(
      detector("same-tree-flake"),
      buildStreamFacts(
        run([
          {
            verb: mode === "full-gate" ? "done" : "test",
            outcome: "failed",
            validation: validation("failed", {
              mode,
              job: "future-verifier",
              siblings: [{ id: "unrelated-check", outcome: "passed" }],
            }),
          },
          {
            verb: mode === "full-gate" ? "done" : "test",
            validation: validation("passed", {
              mode,
              job: "future-verifier",
              siblings: [{ id: "unrelated-check", outcome: "passed" }],
            }),
          },
        ]),
        "main",
      ),
    );
    assertEquals(fired.status, "fired", mode);
    assertEquals(fired.findings.length, 1, mode);
    const finding = fired.findings[0];
    assertEquals(finding?.subject, "future-verifier", mode);
    assertEquals(finding?.evidence, {
      runs: 2,
      denominator: 2,
      red: 1,
      green: 1,
      excluded_outcomes: 0,
    });
    const basis = findingBasis(finding);
    assertEquals(basis.kind, "complete-validation-state");
    assertEquals(basis.coverage, {
      comparable: 2,
      denominator: 2,
      unit: "job-runs",
    });
    assertEquals(basis.validation_state, { version: 1, complete: true });
    assertEquals(basis.differing_conditions, []);
    assert(
      basis.matched_conditions.some((condition) =>
        condition.dimension === "sibling-context"
      ),
      "the same-envelope basis must cover the whole planned sibling set",
    );
    assert(
      basis.limitations.some((limitation) =>
        limitation.includes("external context")
      ),
      "the finding must disclose the material unrecorded-context boundary",
    );
  }
});

Deno.test("validation findings: strict comparison is per job, not one event-level suite verdict", () => {
  const outcome = runDetector(
    detector("same-tree-flake"),
    buildStreamFacts(
      run([
        {
          verb: "test",
          validation: validation("failed", {
            job: "unit",
            siblings: [{ id: "smoke", outcome: "passed" }],
          }),
        },
        {
          verb: "test",
          validation: validation("passed", {
            job: "unit",
            siblings: [{ id: "smoke", outcome: "passed" }],
          }),
        },
      ]),
      "main",
    ),
  );
  assertEquals(outcome.findings.map((finding) => finding.subject), ["unit"]);
});

Deno.test("validation findings regression: two event-level reds still expose each job's opposite verdict", () => {
  const outcome = runDetector(
    detector("same-tree-flake"),
    buildStreamFacts(
      run([
        {
          verb: "test",
          outcome: "failed",
          validation: validation("failed", {
            job: "unit",
            siblings: [{ id: "smoke", outcome: "passed" }],
          }),
        },
        {
          verb: "test",
          outcome: "failed",
          validation: validation("passed", {
            job: "unit",
            siblings: [{ id: "smoke", outcome: "failed" }],
          }),
        },
      ]),
      "main",
    ),
  );
  assertEquals(
    outcome.findings.map((finding) => finding.subject).sort(),
    ["smoke", "unit"],
    "suite-level red/red must not hide two per-job red/green changes",
  );
});

Deno.test("validation findings regression: validation-less historical runs do not form a divergence", () => {
  const outcome = runDetector(
    detector("same-tree-flake"),
    buildStreamFacts(
      run([
        {
          verb: "test",
          head: "shared-head",
          clean: true,
          outcome: "failed",
          steps: [{ ...step("unit", 1, "Test"), outcome: "failed" }],
        },
        {
          verb: "test",
          head: "shared-head",
          clean: true,
          steps: [step("smoke", 1, "Test")],
        },
      ]),
      "main",
    ),
  );
  assertEquals(
    outcome.findings,
    [],
    "event-level tree grouping must not compare unrelated validation jobs",
  );
});

Deno.test("validation findings: cross-context divergence names every changed controlled condition", () => {
  const strict = detector("same-tree-flake");
  const contextual = detector("execution-context-divergence");
  const facts = buildStreamFacts(
    run([
      {
        verb: "test",
        outcome: "failed",
        validation: validation("failed", { mode: "standalone-test" }),
      },
      {
        verb: "test",
        outcome: "failed",
        validation: validation("failed", { mode: "standalone-test" }),
      },
      {
        verb: "done",
        validation: validation("passed", {
          mode: "full-gate",
          concurrent: true,
          siblings: [{
            id: "lint",
            outcome: "passed",
            stage: "check",
            concurrent: true,
          }],
        }),
      },
      {
        verb: "done",
        validation: validation("passed", {
          mode: "full-gate",
          concurrent: true,
          siblings: [{
            id: "lint",
            outcome: "passed",
            stage: "check",
            concurrent: true,
          }],
        }),
      },
    ]),
    "main",
  );
  assertEquals(runDetector(strict, facts).status, "quiet");
  const outcome = runDetector(contextual, facts);
  assertEquals(outcome.status, "fired");
  const finding = outcome.findings[0];
  assertEquals(finding?.subject, "test");
  assertEquals(finding?.evidence, {
    runs: 4,
    denominator: 4,
    red: 2,
    green: 2,
    contexts: 2,
    full_gate_runs: 2,
    standalone_test_runs: 2,
    excluded_outcomes: 0,
  });
  assertStringIncludes(finding?.observed ?? "", "standalone test 2 red");
  assertStringIncludes(finding?.observed ?? "", "full gate 2 green");
  assertEquals(differingDimensions(findingBasis(finding)), [
    "capture-boundary",
    "execution-mode",
    "concurrency",
    "sibling-context",
  ]);
});

Deno.test("validation findings: sibling and concurrency context can diverge within one mode", () => {
  const outcome = runDetector(
    detector("execution-context-divergence"),
    buildStreamFacts(
      run([
        { verb: "test", validation: validation("failed") },
        {
          verb: "test",
          validation: validation("passed", {
            concurrent: true,
            siblings: [{ id: "smoke", outcome: "passed", concurrent: true }],
          }),
        },
      ]),
      "main",
    ),
  );
  assertEquals(outcome.status, "fired");
  assertEquals(differingDimensions(findingBasis(outcome.findings[0])), [
    "concurrency",
    "sibling-context",
  ]);
});

Deno.test("validation findings: unclassified context differences prevent every current comparison", () => {
  const cases: Array<[
    string,
    ValidationFixtureOptions,
    ValidationFixtureOptions,
  ]> = [
    ["state", { digest: "state-a" }, { digest: "state-b" }],
    ["definition", { definition: "job-a" }, { definition: "job-b" }],
    ["writer", { writer: "9.8.7" }, { writer: "9.8.8" }],
    ["config", { config: "config-a" }, { config: "config-b" }],
    ["setup", { setup: "setup-a" }, { setup: "setup-b" }],
  ];
  for (const [label, red, green] of cases) {
    const facts = buildStreamFacts(
      run([
        { verb: "test", validation: validation("failed", red) },
        {
          verb: "done",
          validation: validation("passed", { ...green, mode: "full-gate" }),
        },
      ]),
      "main",
    );
    for (const id of ["same-tree-flake", "execution-context-divergence"]) {
      assertEquals(
        runDetector(detector(id), facts).findings,
        [],
        `${label}:${id}`,
      );
    }
  }
});

Deno.test("validation findings: mixed outcomes inside one context never masquerade as cross-context divergence", () => {
  const facts = buildStreamFacts(
    run([
      { verb: "test", validation: validation("failed") },
      { verb: "test", validation: validation("passed") },
      {
        verb: "done",
        validation: validation("passed", { mode: "full-gate" }),
      },
    ]),
    "main",
  );
  assertEquals(runDetector(detector("same-tree-flake"), facts).status, "fired");
  assertEquals(
    runDetector(detector("execution-context-divergence"), facts).findings,
    [],
  );
});

Deno.test("validation findings: incomplete and non-verdict evidence cannot establish divergence", () => {
  const incomplete: Array<[string, ValidationFixtureOptions]> = [
    ["state", { complete: false }],
    ["execution", { executionComplete: false }],
  ];
  for (const [label, options] of incomplete) {
    const facts = buildStreamFacts(
      run([
        { verb: "test", validation: validation("failed", options) },
        { verb: "test", validation: validation("passed", options) },
      ]),
      "main",
    );
    for (const id of ["same-tree-flake", "execution-context-divergence"]) {
      assertEquals(
        runDetector(detector(id), facts).findings,
        [],
        `${label}:${id}`,
      );
    }
  }

  for (const excluded of ["skipped", "cancelled", "unavailable"] as const) {
    const facts = buildStreamFacts(
      run([
        { verb: "test", validation: validation("failed") },
        { verb: "test", validation: validation(excluded) },
      ]),
      "main",
    );
    assertEquals(
      runDetector(detector("same-tree-flake"), facts).findings,
      [],
      excluded,
    );
  }
});

Deno.test("validation findings: skipped and cancelled outcomes stay visible only in the denominator", () => {
  for (const excluded of ["skipped", "cancelled", "unavailable"] as const) {
    const outcome = runDetector(
      detector("same-tree-flake"),
      buildStreamFacts(
        run([
          { verb: "test", validation: validation("failed") },
          { verb: "test", validation: validation("passed") },
          { verb: "test", validation: validation(excluded) },
        ]),
        "main",
      ),
    );
    assertEquals(outcome.status, "fired", excluded);
    assertEquals(outcome.findings[0]?.evidence, {
      runs: 2,
      denominator: 3,
      red: 1,
      green: 1,
      excluded_outcomes: 1,
    });
    assertEquals(findingBasis(outcome.findings[0]).excluded_events, 1);
  }
});

Deno.test("validation findings: staged, worktree, untracked, and mixed state identities never collapse", () => {
  const states: Array<[string, string, string]> = [
    ["staged-versus-worktree", "state-index", "state-worktree"],
    ["tracked-versus-untracked", "state-tracked", "state-untracked"],
    ["untracked-versus-mixed", "state-untracked", "state-mixed"],
  ];
  for (const [label, redState, greenState] of states) {
    const facts = buildStreamFacts(
      run([
        {
          verb: "test",
          validation: validation("failed", { digest: redState }),
        },
        {
          verb: "test",
          validation: validation("passed", { digest: greenState }),
        },
      ]),
      "main",
    );
    for (const id of ["same-tree-flake", "execution-context-divergence"]) {
      assertEquals(
        runDetector(detector(id), facts).findings,
        [],
        `${label}:${id}`,
      );
    }
  }
});

Deno.test("validation findings: evidence versions and validation-less records never blend", () => {
  const versionedFacts = buildStreamFacts(
    run([
      { verb: "test", validation: validation("failed", { version: 1 }) },
      { verb: "test", validation: validation("passed", { version: 2 }) },
    ]),
    "main",
  );
  assertEquals(
    runDetector(detector("same-tree-flake"), versionedFacts).findings,
    [],
  );

  const historicalAndCurrent = buildStreamFacts(
    run([
      {
        verb: "test",
        outcome: "failed",
        steps: [{ ...step("test", 1, "Test"), outcome: "failed" }],
      },
      { verb: "test", validation: validation("passed") },
    ]),
    "main",
  );
  assertEquals(
    runDetector(detector("same-tree-flake"), historicalAndCurrent).findings,
    [],
  );
});

Deno.test("patterns finding schema enforces additive evidence agreement without confidence", () => {
  const finding = {
    detector: "same-tree-flake",
    family: "gate-fit" as const,
    scope: "project" as const,
    tone: "attention" as const,
    subject: "test",
    summary: "This validation job changed verdict under matched conditions.",
    observed: "A recorded job passed and failed under matched conditions.",
    evidence: { runs: 2 },
    strength: 20,
    next_step: "Investigate the job.",
    basis: {
      kind: "complete-validation-state",
      coverage: { comparable: 2, denominator: 2, unit: "job-runs" },
      validation_state: { version: 1, complete: true },
      matched_conditions: [],
      differing_conditions: [],
      excluded_events: 0,
      limitations: ["External context was not recorded."],
      values: { runs: { value: 2, kind: "observed" } },
    },
  };
  assert(PatternsFindingSchema.safeParse(finding).success);
  assert(
    !PatternsFindingSchema.safeParse({
      ...finding,
      basis: {
        ...finding.basis,
        values: { runs: { value: 3, kind: "observed" } },
      },
    }).success,
    "the structured value must equal ordinary numerical evidence",
  );
  assert(
    !PatternsFindingSchema.safeParse({ ...finding, confidence: 0.9 }).success,
    "the strict wire contract must reject a confidence score",
  );
  assert(
    !PatternsFindingSchema.safeParse({ ...finding, brief: finding.summary })
      .success,
    "the retired brief field must be rejected even when it duplicates summary",
  );
});

Deno.test("patterns evidence conditions bound displayed values and disclose full cardinality", () => {
  const condition = boundedPatternEvidenceCondition(
    "sibling-context",
    Array.from(
      { length: PATTERN_EVIDENCE_CONDITION_VALUES_MAX + 1 },
      (_, index) => ({ key: `key-${index}`, label: `context-${index}` }),
    ),
  );
  assert(condition !== undefined);
  assertEquals(condition.values.length, PATTERN_EVIDENCE_CONDITION_VALUES_MAX);
  assertEquals(condition.distinct, PATTERN_EVIDENCE_CONDITION_VALUES_MAX + 1);
  assertEquals(condition.omitted, 1);
  assert(PatternEvidenceConditionSchema.safeParse(condition).success);
  assert(
    !PatternEvidenceConditionSchema.safeParse({
      ...condition,
      omitted: 0,
    }).success,
    "the schema must reject a bounded sample that hides its omitted value",
  );
});

Deno.test("generator gate share attributes generated groups heaviest first", () => {
  const detectorUnderTest = detector("generator-gate-share");
  assertEquals(detectorUnderTest.family, "gate-fit");
  assertEquals(detectorUnderTest.scope, "project");
  assertEquals(detectorUnderTest.tier, "batch");
  assertEquals(detectorUnderTest.threshold, 5);

  const audit = report(
    detectorUnderTest,
    fixturesOf(detectorUnderTest).firing,
  );
  assertEquals(audit.status, "fired");
  assertEquals(
    audit.findings.map((finding) => finding.subject),
    ["generated:schemas", "generated:docs"],
  );
  assertEquals(audit.findings[0]?.evidence, {
    runs: 5,
    group_share_pct: 40,
    group_mean_seconds: 20,
    generated_share_pct: 60,
    generated_mean_seconds: 30,
    unchanged_reruns: 4,
  });
  assertStringIncludes(
    audit.findings[0]?.observed ?? "",
    "all generated groups averaged 30s and accounted for 60%",
  );
  assertStringIncludes(detectorUnderTest.next_step, "Restructure");
  assert(!/skip|less often/i.test(detectorUnderTest.next_step));
});

Deno.test("generator gate share stays statistical without recorded avoidable cost", () => {
  const events = run(
    Array.from({ length: 5 }, () => ({
      verb: "done",
      steps: [step("generated:schemas", 0.6, "Build"), step("lint", 0.4)],
    })),
  );
  const audit = runDetector(
    detector("generator-gate-share"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(audit.status, "quiet");
  assertEquals(audit.findings, []);
});

Deno.test("slot contention reports material recent wait and frames the owner decision", () => {
  const detectorUnderTest = detector("slot-contention");
  assertEquals(detectorUnderTest.family, "gate-fit");
  assertEquals(detectorUnderTest.scope, "project");
  assertEquals(detectorUnderTest.tier, "batch");
  assertEquals(detectorUnderTest.threshold, 6);

  const audit = report(
    detectorUnderTest,
    fixturesOf(detectorUnderTest).firing,
  );
  assertEquals(audit.status, "fired");
  assertEquals(audit.findings[0]?.evidence, {
    capped_runs: 6,
    median_wait_seconds: 60,
    median_execution_seconds: 100,
    wait_to_execution_pct: 60,
  });
  assertStringIncludes(
    detectorUnderTest.next_step,
    "spare capacity can take a higher cap",
  );
  assertStringIncludes(
    detectorUnderTest.next_step,
    "saturated machine needs fewer simultaneous agents",
  );
});

Deno.test("dominant stage stays statistical when a necessary test has no recorded avoidable cost", () => {
  const events = run(
    Array.from({ length: 5 }, (_, index) => ({
      verb: "done",
      head: `head-${index}`,
      steps: [step("test", 30), step("lint", 5)],
      validation: validation("passed", { digest: `state-${index}` }),
    })),
  );
  const audit = runDetector(
    detector("dominant-stage"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(
    audit.findings,
    [],
    "share and duration alone must not turn a necessary test into optimization advice",
  );
});

Deno.test("dominant stage advises only from a recorded scope mismatch", () => {
  const events = run(
    Array.from({ length: 5 }, (_, index) => ({
      verb: "done",
      head: `head-${index}`,
      scopes: ["engine"],
      steps: [
        {
          ...step("scope:docs", 30, "Scope gates"),
          kind: "scope-gate",
        },
        step("lint", 5),
      ],
    })),
  );
  const audit = report(detector("dominant-stage"), events);
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.scope_mismatch_runs, 5);
  assertStringIncludes(finding.next_step ?? "", "scope");
  assert(
    finding.basis !== undefined,
    "decision evidence needs its setup boundary",
  );
});

Deno.test("dominant stage can act on recorded queue contention without a duration threshold", () => {
  const events = run(
    Array.from({ length: 6 }, (_, index) => ({
      verb: "done",
      head: `head-${index}`,
      duration_ms: 160_000,
      waited_ms: 60_000,
      steps: [step("test", 3), step("lint", 1)],
      validation: validation("passed", { digest: `state-${index}` }),
    })),
  );
  const audit = report(detector("dominant-stage"), events);
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.queue_contention_runs, 6);
  assertStringIncludes(finding.next_step ?? "", "concurrent_test_runs");
});

Deno.test("generator gate share supersedes dominant stage for a generated job", () => {
  const events = run(
    Array.from({ length: 5 }, () => ({
      verb: "done",
      validation: validation("passed", { digest: "generated-state" }),
      steps: [step("generated:schemas", 30, "Build"), step("test", 5)],
    })),
  );
  const facts = buildStreamFacts(events, "main");
  assertEquals(
    runDetector(detector("dominant-stage"), facts).status,
    "quiet",
  );
  assertEquals(
    runDetector(detector("generator-gate-share"), facts).status,
    "fired",
  );
});

Deno.test("hint follow-through: every declaring registry entry resolves followed, not-followed, and censored episodes", () => {
  const entries = measuredHints();
  assert(entries.length > 0, "the hint registry carries no outcome rules");
  const gateRemedies = Object.values(HINTS).filter((hint) =>
    hint.family === "gate-failure-remedy"
  );
  assert(gateRemedies.length > 0, "the gate-failure remedy family is empty");
  // The outcome rule scores prepare usage, so an entry declares it exactly
  // when its own text prescribes prepare as the iteration loop. This is derived
  // from the template, never a hand-kept id list, so rewording a remedy enrols
  // or retires it and the detector never scores an action the hint did not ask for.
  for (const hint of gateRemedies) {
    const rendered = renderCommandRefsCli(
      (hint.template as (params: unknown) => string)(hint.example),
    );
    const prescribesInnerLoop = /Iterate with `discern prepare`/.test(rendered);
    assertEquals(
      hint.followThrough !== undefined,
      prescribesInnerLoop,
      `${hint.id}: a gate-failure remedy declares the outcome rule exactly ` +
        `when its text prescribes prepare as the iteration loop`,
    );
  }
  assert(
    gateRemedies.some((hint) => hint.followThrough !== undefined),
    "no gate-failure remedy prescribes the inner loop the outcome rule scores",
  );
  for (
    const required of [
      "status-branch-behind",
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

Deno.test("checkpoint declaration follow-through: any checkpoint id enrols without registration", () => {
  // The class: episodes are enumerated from the events' recorded checkpoint
  // observations per checkpoint id, so a checkpoint that exists nowhere in
  // any registry — a project-authored id this test invents — is measured the
  // moment its observations appear. A detector-side id table would fail this.
  const id = "invented-project-checkpoint";
  const serving = {
    verb: "done",
    outcome: "refused" as const,
    error: "awaiting_declaration",
    hint_ids: ["checkpoint-declare"],
    checkpoints: { fired: [{ id, definition: "d9", subject: "s9" }] },
  };
  const declare = (revised: boolean): Partial<VerbEvent> => ({
    verb: "done",
    checkpoints: {
      declared: [{ id, conclusion: "unmet", revised }],
    },
  });
  const outcome = runDetector(
    detector("hint-follow-through"),
    buildStreamFacts(
      run([
        serving,
        declare(false),
        serving,
        declare(true),
        serving,
        declare(false),
      ]),
      "main",
    ),
  );
  assertEquals(outcome.status, "fired");
  const finding = outcome.findings.find((f) =>
    f.subject === "checkpoint-declaration"
  );
  assert(finding !== undefined, "the invented checkpoint id was not measured");
  assertEquals(finding.evidence, {
    fired: 3,
    followed: 1,
    not_followed: 2,
    censored: 0,
  });
});

Deno.test("checkpoint declaration follow-through: evidence gaps censor rather than claim", () => {
  const familyCounts = (events: LogbookEvent[]): Record<string, number> => {
    const outcome = runDetector(
      detector("hint-follow-through"),
      buildStreamFacts(events, "main"),
    );
    const finding = outcome.findings.find((f) =>
      f.subject === "checkpoint-declaration"
    );
    return finding?.evidence ?? { fired: 0 };
  };

  // An old writer delivered the refusal hint without the observation block:
  // the firing is real, its resolution can never be correlated.
  const oldWriter = run([
    { verb: "done", outcome: "refused", hint_ids: ["checkpoint-declare"] },
  ]);
  const oldOutcome = runDetector(
    detector("hint-follow-through"),
    buildStreamFacts(oldWriter, "main"),
  );
  assertEquals(oldOutcome.status, "insufficient-evidence");

  // A declaration recorded without the revision flag (schema evolution)
  // resolves nothing: the episode censors instead of guessing a verdict.
  const flagless = (): Partial<VerbEvent>[] => [
    {
      verb: "done",
      checkpoints: { fired: [{ id: "api-review" }] },
    },
    {
      verb: "done",
      checkpoints: { declared: [{ id: "api-review", conclusion: "met" }] },
    },
  ];
  assertEquals(
    familyCounts(run([...flagless(), ...flagless(), ...flagless()])),
    { fired: 0 },
    "censored-only families never clear the resolved-episode bar",
  );

  // A reopen while one episode is pending folds into it — the same awaited
  // conclusion whose subject moved — and the declaration resolves it once.
  const folded = familyCounts(run([
    {
      verb: "done",
      checkpoints: { fired: [{ id: "api-review", subject: "s1" }] },
    },
    {
      verb: "done",
      checkpoints: { reopened: [{ id: "api-review", subject: "s2" }] },
    },
    {
      verb: "done",
      checkpoints: {
        declared: [{ id: "api-review", conclusion: "met", revised: false }],
      },
    },
    // Three more resolved episodes clear the family's reporting bar.
    {
      verb: "done",
      checkpoints: { fired: [{ id: "other", subject: "s1" }] },
    },
    {
      verb: "done",
      checkpoints: {
        declared: [{ id: "other", conclusion: "met", revised: true }],
      },
    },
    {
      verb: "done",
      checkpoints: { reopened: [{ id: "other", subject: "s3" }] },
    },
    {
      verb: "done",
      checkpoints: {
        declared: [{ id: "other", conclusion: "met", revised: false }],
      },
    },
  ]));
  assertEquals(folded, {
    fired: 3,
    followed: 1,
    not_followed: 2,
    censored: 0,
  });

  // A declaration with no pending serving — replacing a standing conclusion —
  // opens no episode: nothing was served to follow.
  assertEquals(
    familyCounts(run([
      {
        verb: "done",
        checkpoints: {
          declared: [{ id: "api-review", conclusion: "unmet", revised: false }],
        },
      },
    ])),
    { fired: 0 },
  );
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
    "quiet",
    "missing prepare and generic Gate reds do not establish preventable work",
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
    "prepare follow-through does not erase skipped-prepare's independent population",
  );
});

Deno.test("prepare advice requires repeated preventable work on distinct clean HEADs", () => {
  const prepareDetector = detector("skipped-prepare");
  const fired = runDetector(
    prepareDetector,
    buildStreamFacts(
      run([
        regenerationDrift("head-a"),
        { verb: "prepare" },
        fixDrift("head-b"),
      ]),
      "main",
    ),
  );
  assertEquals(fired.status, "fired");
  assertEquals(fired.findings[0]?.evidence, {
    prepare_preventable_failures: 2,
    done_runs: 2,
    distinct_clean_heads: 2,
    same_head_additional_runs: 0,
    fix_drift_failures: 1,
    regeneration_failures: 1,
    prepare_runs: 1,
  });
  assertStringIncludes(fired.findings[0]?.observed ?? "", "2 of 2 `done` runs");
  assertStringIncludes(
    fired.findings[0]?.observed ?? "",
    "missing `prepare` alone did not establish this finding",
  );
  assertStringIncludes(prepareDetector.next_step, "supported first command");
  assertStringIncludes(
    prepareDetector.next_step,
    "dirty runs retain full feedback",
  );
});

Deno.test("prepare advice preserves successful done-first entry and productive dirty feedback", () => {
  const prepareDetector = detector("skipped-prepare");
  const successful = runDetector(
    prepareDetector,
    buildStreamFacts(
      run([{ verb: "done", head: "head-a" }, { verb: "done", head: "head-b" }]),
      "main",
    ),
  );
  assertEquals(successful.status, "quiet");

  const dirty = runDetector(
    prepareDetector,
    buildStreamFacts(
      run([
        regenerationDrift("head-a"),
        regenerationDrift("head-b"),
      ]).map((event) => ({ ...event, clean: false })),
      "main",
    ),
  );
  assertEquals(dirty.status, "quiet");
});

Deno.test("prepare advice excludes failures and drift outside prepare's recorded work", () => {
  const prepareDetector = detector("skipped-prepare");
  const uncaught = runDetector(
    prepareDetector,
    buildStreamFacts(
      run([
        redDone({ head: "head-a" }),
        redDone({ head: "head-b", failed_stage: "test" }),
        {
          verb: "done",
          head: "head-c",
          outcome: "failed",
          failed_stage: "tree_drift",
          steps: [
            step("fmt", 1, "Fix"),
            step("compile", 2, "Build"),
          ],
        },
      ]),
      "main",
    ),
  );
  assertEquals(uncaught.status, "quiet");
  assertEquals(uncaught.findings, []);
});

Deno.test("prepare advice leaves same-HEAD repeats to validation divergence", () => {
  const result = runDetector(
    detector("skipped-prepare"),
    buildStreamFacts(
      run([
        regenerationDrift("same-head"),
        regenerationDrift("same-head"),
      ]),
      "main",
    ),
  );
  assertEquals(result.status, "quiet");
  assertEquals(result.findings, []);
});

Deno.test("tip adoption: every declaring registry entry resolves same- and cross-surface episodes", () => {
  const entries = measuredTips();
  assert(entries.length > 0, "the tip registry carries no adoption rules");
  const detectorUnderTest = detector("tip-adoption");
  assertEquals(detectorUnderTest.threshold, 3);
  assertEquals(detectorUnderTest.family, "behavior");
  assertEquals(detectorUnderTest.scope, "project");
  assertEquals(detectorUnderTest.tier, "batch");

  for (const tip of entries) {
    const ignored = runDetector(
      detectorUnderTest,
      buildStreamFacts(
        tipAdoptionFixture(tip, "not-followed"),
        "main",
      ),
    );
    assertEquals(ignored.status, "fired", tip.id);
    assertEquals(ignored.considered, 3, tip.id);
    const ignoredFinding = ignored.findings.find((finding) =>
      finding.subject === tip.id
    );
    assert(ignoredFinding !== undefined, `${tip.id}: no ignored finding`);
    assertEquals(ignoredFinding.evidence, {
      fired: 4,
      followed: 0,
      not_followed: 3,
      censored: 1,
    }, tip.id);
    assertEquals(ignoredFinding.tone, "attention", tip.id);
    assertStringIncludes(
      ignoredFinding.next_step ?? "",
      `\`${tip.id}\``,
      `${tip.id}: the next step names the tip to review`,
    );

    for (const surface of ["cli", "mcp"] as const) {
      const followed = runDetector(
        detectorUnderTest,
        buildStreamFacts(
          tipAdoptionFixture(tip, "followed", surface),
          "main",
        ),
      );
      assertEquals(followed.status, "fired", `${tip.id}:${surface}`);
      assertEquals(followed.considered, 3, `${tip.id}:${surface}`);
      const followedFinding = followed.findings.find((finding) =>
        finding.subject === tip.id
      );
      assert(
        followedFinding !== undefined,
        `${tip.id}:${surface}: no followed finding`,
      );
      assertEquals(followedFinding.evidence, {
        fired: 4,
        followed: 3,
        not_followed: 0,
        censored: 1,
      }, `${tip.id}:${surface}`);
      assertEquals(
        followedFinding.tone,
        "good",
        `${tip.id}:${surface}: all-followed evidence stays visible`,
      );
    }
  }
});

Deno.test("tip adoption: history end and missing setup evidence censor episodes", () => {
  const action = tippedVerb(PATTERNS_TIP);
  const outcome = tipAdoptionOutcome(
    buildStreamFacts(
      run([
        shownTip(PATTERNS_TIP),
        action,
        shownTip(PATTERNS_TIP),
        action,
        shownTip(PATTERNS_TIP),
        action,
        shownTip(PATTERNS_TIP, { writer: undefined }),
        shownTip(PATTERNS_TIP),
        { ...action, epoch: null },
        shownTip(PATTERNS_TIP),
      ]),
      "main",
    ),
  );
  assertEquals(outcome.considered, 3);
  const finding = outcome.findings.find((entry) =>
    entry.subject === PATTERNS_TIP.id
  );
  assert(finding !== undefined);
  assertEquals(finding.evidence, {
    fired: 6,
    followed: 3,
    not_followed: 0,
    censored: 3,
  });
});

Deno.test("tip adoption: setup equality excludes epoch and release excursions without breaking re-entry", () => {
  const action = tippedVerb(PATTERNS_TIP);
  const outcome = tipAdoptionOutcome(
    buildStreamFacts(
      run([
        shownTip(PATTERNS_TIP),
        { ...action, epoch: "foreign" },
        { ...action, writer: "10.0.0" },
        action,
        shownTip(PATTERNS_TIP),
        shownTip(PATTERNS_TIP),
        shownTip(PATTERNS_TIP),
      ]),
      "main",
    ),
  );
  assertEquals(outcome.considered, 3);
  const finding = outcome.findings.find((entry) =>
    entry.subject === PATTERNS_TIP.id
  );
  assert(finding !== undefined);
  assertEquals(finding.evidence, {
    fired: 4,
    followed: 1,
    not_followed: 2,
    censored: 1,
  });
});

Deno.test("tip adoption: dominant-client release excursions do not resolve a comparable episode", () => {
  const action = tippedVerb(PATTERNS_TIP);
  const mcpDriver = (version: string): VerbEvent["driver"] => ({
    session: `mcp:${version}`,
    json: false,
    tty: false,
    ci: false,
    mcp_client: { name: "synthetic-client", version },
  });
  const primaryVersion = "8.8.8";
  const excursionVersion = "9.9.9";
  const outcome = tipAdoptionOutcome(
    buildStreamFacts(
      run([
        {
          verb: "status",
          surface: "mcp",
          driver: mcpDriver(primaryVersion),
        },
        shownTip(PATTERNS_TIP),
        {
          ...action,
          surface: "mcp",
          driver: mcpDriver(excursionVersion),
        },
        {
          ...action,
          surface: "mcp",
          driver: mcpDriver(primaryVersion),
        },
        shownTip(PATTERNS_TIP),
        shownTip(PATTERNS_TIP),
        shownTip(PATTERNS_TIP),
      ]),
      "main",
    ),
  );
  assertEquals(outcome.considered, 3);
  const finding = outcome.findings.find((entry) =>
    entry.subject === PATTERNS_TIP.id
  );
  assert(finding !== undefined);
  assertEquals(finding.evidence.followed, 1);
  assertEquals(finding.evidence.not_followed, 2);
});

Deno.test("tip adoption: synthetic declarations auto-enrol without pooling sparse tips", () => {
  const syntheticRule = {
    family: "synthetic-adoption",
    kind: "verb-run-after-tip",
    verbs: ["doctor"],
  } as const;
  const synthetic = defineTip({
    id: "synthetic-doctor-tip",
    when: "Synthetic evaluator control.",
    features: ["doctor"],
    followThrough: syntheticRule,
    example: undefined,
    template: (): string => "Synthetic evaluator control.",
  });
  const second = defineTip({
    id: "synthetic-patterns-tip",
    when: "Synthetic threshold control.",
    features: ["patterns"],
    followThrough: {
      family: syntheticRule.family,
      kind: "verb-run-after-tip",
      verbs: ["patterns"],
    },
    example: undefined,
    template: (): string => "Synthetic threshold control.",
  });
  const registry = [...TIPS, synthetic, second];
  assertEquals(
    measuredTips(registry).some((tip) => tip.id === synthetic.id),
    true,
    "the synthetic declaration joins the measured population",
  );

  const syntheticTip = measuredTips(registry).find((tip) =>
    tip.id === synthetic.id
  );
  const secondTip = measuredTips(registry).find((tip) => tip.id === second.id);
  assert(syntheticTip !== undefined);
  assert(secondTip !== undefined);
  const outcome = tipAdoptionOutcome(
    buildStreamFacts(
      run([
        shownTip(syntheticTip),
        shownTip(syntheticTip),
        shownTip(syntheticTip),
        shownTip(secondTip),
        shownTip(secondTip),
        shownTip(secondTip),
      ]),
      "main",
    ),
    registry,
  );
  assertEquals(
    outcome.considered,
    2,
    "two sparse tips in one family never pool past the per-tip threshold",
  );
  assertEquals(outcome.findings, []);
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
  assertEquals(
    summary.summary,
    "Recorded landing authority handled part of this project's landings.",
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
    accept_attempts: 12,
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
      assert(f.summary.length > 0, `${d.id}: empty summary`);
      assert(
        /[.!?]$/.test(f.summary),
        `${d.id}: summary is not a complete sentence: ${f.summary}`,
      );
      assert(
        /\d/.test(f.observed),
        `${d.id}: observation must carry concrete numerical evidence`,
      );
      assert(
        !/\b(?:rank|score|lazy|careless|incompetent|abandoned|waste|caused|causes)\b/i
          .test(`${f.summary} ${f.observed}`),
        `${d.id}: finding makes an unsupported comparative, causal, or character claim`,
      );
      assert(
        PATTERN_FINDING_TONES.includes(f.tone ?? d.tone),
        `${d.id}: unknown finding tone ${f.tone ?? d.tone}`,
      );
      if (d.id === "standard-trajectory") {
        assert(f.series !== undefined, `${d.id}: missing trajectory series`);
      } else {
        assertEquals(
          f.series,
          undefined,
          `${d.id}: only standard trajectories may carry a series`,
        );
      }
      if (f.series !== undefined) {
        assert(
          f.series.length <= PATTERNS_SERIES_MAX_POINTS,
          `${d.id}: ${f.series.length}-point series exceeds the wire cap`,
        );
        for (const value of f.series) {
          assert(Number.isFinite(value), `${d.id}: non-finite series value`);
        }
      }
      const values = Object.values(f.evidence);
      assert(values.length > 0, `${d.id}: a finding carries no evidence`);
      for (const v of values) {
        assert(Number.isFinite(v), `${d.id}: non-finite evidence value`);
      }
      assert(f.strength > 0, `${d.id}: findings must carry a ranking strength`);
      const wire = routedFindingData({
        detector: d,
        finding: f,
        considered: r.considered,
      });
      assertEquals(wire.summary, f.summary, `${d.id}: summary drifted`);
      assertEquals("brief" in wire, false, `${d.id}: retired brief returned`);
      PatternsFindingSchema.parse(wire);
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

Deno.test("patterns driver scoring: a result format does not determine who invoked the CLI", () => {
  for (const format of [{ json: true }, { markdown: true }]) {
    assertEquals(
      driverKind(verb({ driver: { ...format, tty: false, ci: false } })),
      "unknown",
    );
    assertEquals(
      driverKind(verb({ driver: { ...format, tty: true, ci: false } })),
      "human",
    );
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

Deno.test("patterns identity gap: current catalogue knowledge repairs retained raw MCP metadata", () => {
  const events = run(
    Array.from({ length: 5 }, () => unknownMcpClient("cursor-vscode")),
  );
  const gap = DETECTORS.find((detector) => detector.id === "identity-gap");
  assert(gap !== undefined);
  const outcome = runDetector(gap, buildStreamFacts(events, "main"));
  assertEquals(outcome.considered, 5);
  assertEquals(
    outcome.findings,
    [],
    "recognized historical raw metadata must not remain an identity gap",
  );
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

Deno.test("patterns attribution: runs under another configuration are excluded and the change is named", () => {
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
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(
    outcome.findings.length,
    1,
    "a too-short series beside other-setup runs must be attributed, not silent",
  );
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(
    finding.observed.includes("[jobs]"),
    `the attribution must name the section that moved: ${finding.observed}`,
  );
  assert(
    finding.observed.includes("2026-07-01"),
    `the attribution must date the current series: ${finding.observed}`,
  );
});

Deno.test("duration-creep: a red-to-green mix shift is not creep", () => {
  // Early quick fail-fast reds beside late full green gates — the exact shape a
  // working session produces. Only green runs measure the gate's length, so
  // this must stay quiet; medianing both outcomes would read the mix as creep.
  const events = timedRun([
    ...Array.from({ length: 8 }, () => redDone({ duration_ms: 5_000 })),
    ...Array.from({ length: 8 }, () => ({
      verb: "done",
      duration_ms: 150_000,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    })),
  ]);
  const creep = detector("duration-creep");
  const outcome = runDetector(creep, buildStreamFacts(events, "main"));
  assertEquals(
    outcome.findings.length,
    0,
    "quick reds followed by full greens must not read as duration creep",
  );
  // The green-only series still fires when the greens themselves slow down.
  const slowing = timedRun([
    ...Array.from({ length: 4 }, () => redDone({ duration_ms: 5_000 })),
    ...Array.from({ length: 4 }, () => ({
      verb: "done",
      duration_ms: 60_000,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    })),
    ...Array.from({ length: 4 }, () => ({
      verb: "done",
      duration_ms: 150_000,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    })),
  ]);
  const fired = runDetector(creep, buildStreamFacts(slowing, "main"));
  assertEquals(
    fired.findings.length,
    1,
    "greens slowing on an unchanged setup must still fire",
  );
  assertStringIncludes(fired.findings[0]?.observed ?? "", "green `done`");
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
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
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
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(
    outcome.findings.length,
    1,
    "a too-short series beside another client release must be attributed, not silent",
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
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(outcome.findings.length, 1);
  assert(
    !(outcome.findings[0]?.observed.includes("client release") ?? true),
    `no client attribution may appear without client evidence: ${
      outcome.findings[0]?.observed
    }`,
  );
});

Deno.test("patterns attribution: comparableSeries groups by setup equality, not contiguity", () => {
  // Two configs alternating — the parallel-worktree shape. The current
  // setup's series is every `b` run, however many `a` runs interleave.
  const events = [
    verb({ at: t(0), epoch: "b", writer: "9.9.9" }),
    verb({ at: t(1), epoch: "a", writer: "9.9.9" }),
    verb({ at: t(2), epoch: "b", writer: "9.9.9" }),
    verb({ at: t(3), epoch: "a", writer: "9.9.9" }),
    verb({ at: t(4), epoch: "b", writer: "9.9.9" }),
  ];
  const { series, excluded } = comparableSeries(events, events);
  assertEquals(series.length, 3);
  assert(series.every((e) => e.epoch === "b"));
  assertEquals(
    series.map((e) => e.at),
    [t(0), t(2), t(4)],
    "the series must keep chronological order across the interleaving",
  );
  assert(excluded !== undefined);
  assertEquals(excluded.runs, 2);
  assertEquals(excluded.setups, 1);
});

Deno.test("patterns attribution: a same-setup stream has nothing excluded", () => {
  const events = [
    verb({ at: t(0), epoch: "b" }),
    verb({ at: t(1), epoch: "b" }),
  ];
  const { series, excluded } = comparableSeries(events, events);
  assertEquals(series.length, 2);
  assertEquals(excluded, undefined);
});

Deno.test("patterns attribution: a standard's series counts the setups it spans, not the flips it crosses", () => {
  // Interleaved: the same two configs alternate across six readings. That is
  // 2 setups — a per-flip boundary count would claim 5.
  const events: LogbookEvent[] = Array.from(
    { length: 6 },
    (_, i) =>
      verb({
        at: t(i),
        standards: [reading("cov", 70 + i, 80)],
        epoch: i % 2 === 0 ? "old1" : "new2",
      }),
  );
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  assertEquals(outcome.findings.length, 1);
  const observed = outcome.findings[0]?.observed ?? "";
  assert(
    observed.includes("2 config/release setups"),
    `the series must count distinct setups: ${observed}`,
  );
  assert(
    observed.includes("segments are attributed, not blended"),
    `the attribution marker must survive: ${observed}`,
  );
});

// ── the windowed guards (parameterized: every `windowed` detector) ──────────

/** Foreign-setup clones of a stream's verb events, each on another branch and
 * half an hour BEFORE its source event — so the newest event keeps the
 * current setup. Clones keep the source's shape (verb, steps, durations,
 * update counts), so they enter the same candidate population and would have
 * fragmented a contiguity-based window. */
function foreignSetupClones(events: readonly LogbookEvent[]): LogbookEvent[] {
  return events
    .filter((e): e is VerbEvent => e.kind === "verb")
    .map((e): LogbookEvent => ({
      ...e,
      at: new Date(Date.parse(e.at) - 1_800_000).toISOString(),
      epoch: "zz-foreign",
      ...(e.invocation === undefined
        ? {}
        : { invocation: `foreign-${e.invocation}` }),
      branch: "agent/elsewhere",
    }));
}

const windowedDetectors = DETECTORS.filter((d) => d.windowed === true);

/** Decision content must survive foreign-setup interleaving. The observation
 * and structured basis may additionally disclose excluded events, so those
 * attribution fields are compared separately rather than erased. */
function findingDecisionContent(finding: DetectorFinding): Omit<
  DetectorFinding,
  "basis" | "observed"
> {
  return {
    ...(finding.subject !== undefined ? { subject: finding.subject } : {}),
    summary: finding.summary,
    ...(finding.tone !== undefined ? { tone: finding.tone } : {}),
    ...(finding.series !== undefined ? { series: finding.series } : {}),
    evidence: finding.evidence,
    strength: finding.strength,
    ...(finding.next_step !== undefined
      ? { next_step: finding.next_step }
      : {}),
  };
}

Deno.test("patterns windowed: the registry carries windowed trend detectors", () => {
  assert(
    windowedDetectors.length > 0,
    "no detector is marked `windowed` — the interleaving guards guard nothing",
  );
});

for (const d of windowedDetectors) {
  Deno.test(`patterns windowed ${d.id}: an interleaved comparable series survives intact`, () => {
    const firing = fixturesOf(d).firing;
    const base = runDetector(d, buildStreamFacts(firing, "main"));
    assertEquals(base.status, "fired", `${d.id}: firing fixture must fire`);
    const interleaved = [...firing, ...foreignSetupClones(firing)]
      .sort((a, b) => a.at.localeCompare(b.at));
    const under = runDetector(d, buildStreamFacts(interleaved, "main"));
    assertEquals(
      under.findings.map(findingDecisionContent),
      base.findings.map(findingDecisionContent),
      `${d.id}: interleaved foreign-setup runs must not change the trend`,
    );
    for (let index = 0; index < base.findings.length; index += 1) {
      const baseFinding = base.findings[index];
      const underFinding = under.findings[index];
      assert(baseFinding !== undefined && underFinding !== undefined);
      if (underFinding.observed !== baseFinding.observed) {
        assert(
          underFinding.observed.includes("excluded from this comparison"),
          `${d.id}: a changed observation must explain the exclusion: ${underFinding.observed}`,
        );
      }
      const baseBasis = base.findings[index]?.basis;
      const underBasis = under.findings[index]?.basis;
      if (baseBasis === undefined) {
        assertEquals(underBasis, undefined);
        continue;
      }
      assert(underBasis !== undefined);
      assertEquals(
        underBasis.coverage.comparable,
        baseBasis.coverage.comparable,
        `${d.id}: foreign setups cannot enter the comparable population`,
      );
      assert(
        underBasis.coverage.denominator >= baseBasis.coverage.denominator,
        `${d.id}: the basis denominator cannot hide foreign-setup events`,
      );
      assert(
        underBasis.excluded_events >= baseBasis.excluded_events,
        `${d.id}: foreign-setup exclusions cannot disappear from the basis`,
      );
      assertEquals(
        {
          ...underBasis,
          coverage: {
            ...underBasis.coverage,
            denominator: baseBasis.coverage.denominator,
          },
          excluded_events: baseBasis.excluded_events,
        },
        baseBasis,
        `${d.id}: only denominator/exclusion attribution may change`,
      );
    }
    assert(
      under.findings.every((f) => f.evidence.comparable_runs === undefined),
      `${d.id}: enough same-setup runs must trend, never refuse as too few comparable`,
    );
  });

  Deno.test(`patterns windowed ${d.id}: a series outnumbered by other setups attributes them`, () => {
    const verbs = fixturesOf(d).firing
      .filter((e): e is VerbEvent => e.kind === "verb");
    const newest = verbs[verbs.length - 1];
    assert(newest !== undefined);
    const events = [...foreignSetupClones(verbs), newest]
      .sort((a, b) => a.at.localeCompare(b.at));
    const under = runDetector(d, buildStreamFacts(events, "main"));
    assertEquals(
      under.status,
      "fired",
      `${d.id}: a lone comparable run beside a full foreign series must attribute, not go quiet`,
    );
    assertEquals(under.findings.length, 1);
    const finding = under.findings[0];
    assert(finding !== undefined);
    assertEquals(finding.evidence.comparable_runs, 1);
    assertEquals(finding.evidence.other_setup_runs, verbs.length);
    assert(
      finding.observed.includes("another configuration"),
      `${d.id}: the exclusion must name what differs: ${finding.observed}`,
    );
    assert(
      finding.observed.includes("not blended"),
      `${d.id}: the exclusion must state the runs are excluded: ${finding.observed}`,
    );
  });
}

Deno.test("patterns regression: a gate-duration trend survives interleaved config flip-flop", () => {
  // The observed parallel-worktree failure shape: two configs alternating
  // run-by-run in one shared logbook while one of them slows down. The
  // slowing config's runs are one comparable series; the interleaved runs
  // from the other config must neither fragment it nor blend into it.
  const events: LogbookEvent[] = [];
  for (let i = 0; i < 10; i += 1) {
    events.push(verb({
      at: t(2 * i),
      verb: "done",
      duration_ms: i < 5 ? 100_000 : 170_000,
      epoch: "aa",
      branch: "agent/one",
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    }));
    events.push(verb({
      at: t(2 * i + 1),
      verb: "done",
      duration_ms: 5_000,
      epoch: "bb",
      branch: "agent/two",
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    }));
  }
  events.push(verb({
    at: t(21),
    verb: "done",
    duration_ms: 170_000,
    epoch: "aa",
    branch: "agent/one",
    change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
  }));
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(outcome.status, "fired");
  assertEquals(outcome.findings.length, 1);
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.runs, 11);
  assertEquals(finding.evidence.median_early_s, 100);
  assertEquals(finding.evidence.median_late_s, 170);
  assert(
    finding.evidence.comparable_runs === undefined,
    `enough interleaved same-config runs must trend, not refuse: ${finding.summary}`,
  );
});

Deno.test("patterns duration creep excludes slot waits from suite health", () => {
  const events = run(
    Array.from({ length: 8 }, (_, i) => ({
      verb: "done",
      duration_ms: i < 4 ? 100_000 : 220_000,
      waited_ms: i < 4 ? 0 : 120_000,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    })),
  );
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(outcome.considered, 8);
  assertEquals(
    outcome.findings,
    [],
    "steady execution must stay quiet when only slot contention grew",
  );
});

// ── setup-era exclusion ──────────────────────────────────────────────────────

Deno.test("patterns setup era: events on the setup branch are set aside before analysis", () => {
  const events: LogbookEvent[] = [
    verb({ at: t(0), branch: SETUP_BRANCH, verb: "done", duration_ms: 600 }),
    {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: t(1),
      kind: "config-change",
      branch: SETUP_BRANCH,
      sections: ["jobs"],
      epoch: "e1",
    },
    verb({ at: t(2), branch: "agent/task", verb: "done" }),
  ];
  const facts = buildStreamFacts(events, "main");
  assertEquals(facts.setupEra, 2);
  assertEquals(facts.events.length, 1);
  assertEquals(facts.verbs.length, 1);
  assertEquals(facts.verbs[0]?.branch, "agent/task");
  assertEquals(facts.horizon, t(2), "the horizon must ignore setup-era events");
});

Deno.test("patterns setup era: half-wired gate runs during setup never read as duration creep", () => {
  // The one-time-setup shape: the gate gets wired while the project is stood
  // up around it — sub-second runs on the setup branch under the SAME config
  // epoch as the real work that follows (the completion marker is masked out
  // of the epoch). Without the exclusion this reads as the gate "slowing"
  // from 0.6s to 120s on its first day.
  const events: LogbookEvent[] = [
    ...Array.from({ length: 4 }, (_, i) =>
      verb({
        at: t(i),
        branch: SETUP_BRANCH,
        verb: "done",
        duration_ms: 600,
      })),
    ...Array.from({ length: 8 }, (_, i) =>
      verb({
        at: t(4 + i),
        branch: "agent/task",
        verb: "done",
        duration_ms: 120_000,
      })),
  ];
  const creep = DETECTORS.find((d) => d.id === "duration-creep");
  assert(creep !== undefined);
  const outcome = runDetector(
    creep,
    buildStreamFacts(timedEvents(events), "main"),
  );
  assertEquals(outcome.considered, 8);
  assertEquals(
    outcome.findings,
    [],
    "a steady post-setup gate must read as steady",
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

Deno.test("patterns trajectory: fresh stable Gate eligibility supports a pin recommendation", () => {
  const events = run(
    [85, 86, 87, 88, 89].map((value) => ({
      standards: [decisionReading("coverage", value, 80, {
        margin: 2,
        pinEligible: true,
        pinTarget: value - 2,
        verdict: "improved",
      })],
    })),
  );
  const audit = report(detector("standard-trajectory"), events);
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.mechanically_eligible, 1);
  assertEquals(finding.evidence.recommendation_supported, 1);
  assertStringIncludes(finding.next_step ?? "", "--pin coverage");
  assert(finding.basis !== undefined, "pin advice needs a structured basis");
});

Deno.test("patterns trajectory: an improvement inside the Standard margin is not pinnable", () => {
  const events = run(
    [81, 82, 83, 84, 85].map((value) => ({
      standards: [decisionReading("tiny", value, 80, {
        margin: 10,
        pinEligible: false,
        verdict: "improved",
      })],
    })),
  );
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.mechanically_eligible, 0);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert(!finding.next_step?.includes("--pin"));
});

Deno.test("patterns trajectory: volatile eligible readings suppress recommendation without denying eligibility", () => {
  const events = run(
    [90, 100, 81, 100, 82].map((value) => ({
      standards: [decisionReading("volatile", value, 80, {
        pinEligible: true,
        pinTarget: value,
        verdict: "improved",
      })],
    })),
  );
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.mechanically_eligible, 1);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert((finding.evidence.recent_reversals ?? 0) > 0);
  assert(!finding.next_step?.includes("--pin"));
  assertStringIncludes(finding.next_step ?? "", "volatile");
});

Deno.test("patterns trajectory: a stale on-demand Standard routes to fresh measurement", () => {
  const events = run([
    ...[85, 86, 87, 88, 89].map((value) => ({
      standards: [decisionReading("deferred", value, 80, {
        margin: 2,
        pinEligible: true,
        pinTarget: value - 2,
        verdict: "improved" as const,
      })],
    })),
    {
      standards: [decisionReading("deferred", undefined, 80, {
        margin: 2,
        measurement: "deferred",
      })],
    },
  ]);
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.current_measurement, 0);
  assertStringIncludes(finding.next_step ?? "", "discern standards");
  assert(!finding.next_step?.includes("--pin"));
});

Deno.test("patterns trajectory: a stale skipped Gate reading routes to fresh measurement", () => {
  const events = run([
    ...[85, 86, 87, 88, 89].map((value) => ({
      standards: [decisionReading("stale", value, 80, {
        pinEligible: true,
        pinTarget: value,
        verdict: "improved" as const,
      })],
    })),
    {
      standards: [decisionReading("stale", undefined, 80, {
        measurement: "skipped",
      })],
    },
  ]);
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.current_measurement, 0);
  assertStringIncludes(finding.next_step ?? "", "discern standards");
  assert(!finding.next_step?.includes("--pin"));
});

Deno.test("patterns trajectory: a recent failure suppresses an otherwise eligible pin", () => {
  const events = run(
    [
      decisionReading("failing", 85, 80, {
        pinEligible: true,
        pinTarget: 85,
        verdict: "improved",
      }),
      decisionReading("failing", 75, 80, {
        pinEligible: false,
        verdict: "regressed",
      }),
      decisionReading("failing", 90, 80, {
        pinEligible: true,
        pinTarget: 90,
        verdict: "improved",
      }),
      decisionReading("failing", 91, 80, {
        pinEligible: true,
        pinTarget: 91,
        verdict: "improved",
      }),
      decisionReading("failing", 92, 80, {
        pinEligible: true,
        pinTarget: 92,
        verdict: "improved",
      }),
    ].map((standard) => ({ standards: [standard] })),
  );
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.mechanically_eligible, 1);
  assertEquals(finding.evidence.recent_failures, 1);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert(!finding.next_step?.includes("--pin"));
});

Deno.test("patterns trajectory: a retired Standard remains historical evidence without pin advice", () => {
  const events = run([
    ...[85, 86, 87, 88, 89].map((value) => ({
      standards: [decisionReading("retired", value, 80, {
        pinEligible: true,
        pinTarget: value,
        verdict: "improved" as const,
      })],
    })),
    {
      standards: [decisionReading("active", 5, 4, {
        pinEligible: true,
        pinTarget: 5,
        verdict: "improved",
      })],
    },
  ]);
  const finding = report(detector("standard-trajectory"), events).findings.find(
    (candidate) => candidate.subject === "retired",
  );
  assert(finding !== undefined);
  assertEquals(finding.evidence.retired, 1);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert(!finding.next_step?.includes("--pin"));
  assertStringIncludes(finding.next_step ?? "", "historical");
});

Deno.test("patterns trajectory: recommendation persistence never blends configurations", () => {
  const events = run([
    ...[85, 86, 87].map((value) => ({
      epoch: "old",
      standards: [decisionReading("coverage", value, 80, {
        pinEligible: true,
        pinTarget: value,
        verdict: "improved" as const,
      })],
    })),
    ...[88, 89].map((value) => ({
      epoch: "current",
      standards: [decisionReading("coverage", value, 80, {
        pinEligible: true,
        pinTarget: value,
        verdict: "improved" as const,
      })],
    })),
  ]);
  const finding = report(detector("standard-trajectory"), events).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.comparable_readings, 2);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert(!finding.next_step?.includes("--pin"));
});

Deno.test("patterns trajectory: long series use equal-time bucket means and exact endpoints", () => {
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const values = Array.from({ length: 200 }, (_, index) => index % 2);
  const events = run(values.map((value) => ({
    standards: [reading("pulse", value, -1, "up")],
  })));
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assert(finding.series !== undefined);
  assert(
    finding.series.length <= PATTERNS_SERIES_MAX_POINTS,
    `${finding.series.length}-point series exceeds the wire cap`,
  );
  assert(
    finding.series.length < values.length,
    "the long trajectory must be downsampled",
  );
  assertEquals(finding.series[0], values[0]);
  assertEquals(finding.series[finding.series.length - 1], values.at(-1));
  assert(
    finding.series.slice(1, -1).some((value) => value > 0 && value < 1),
    "interior points must be bucket means rather than sampled readings",
  );
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
      wording: "has more headroom",
      limitWord: "floor",
    },
    {
      label: "down moves away",
      values: [105, 104, 103, 102, 101],
      limit: 100,
      direction: "down" as const,
      tone: "good",
      wording: "has more headroom",
      limitWord: "ceiling",
    },
    {
      label: "up drifts toward",
      values: [89, 88, 87, 86, 85],
      limit: 90,
      direction: "up" as const,
      tone: "attention",
      wording: "has less headroom",
      limitWord: "floor",
    },
    {
      label: "flat",
      values: [80, 80, 80, 80, 80],
      limit: 90,
      direction: "up" as const,
      tone: "neutral",
      wording: "held steady",
      limitWord: "floor",
    },
    {
      label: "down has sustained slack",
      values: [99, 98, 97, 96, 95],
      limit: 100,
      direction: "down" as const,
      tone: "good",
      wording: "beats its recorded limit",
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
      finding.summary.includes(item.wording),
      `${item.label}: ${finding.summary}`,
    );
    assert(
      finding.summary.includes(item.limitWord),
      `${item.label}: ${finding.summary}`,
    );
    assertEquals(finding.strength, item.values.length);
  }
});

Deno.test("patterns trajectory: the summary compares today's value with today's limit", () => {
  const trajectory = DETECTORS.find((d) => d.id === "standard-trajectory");
  assert(trajectory !== undefined);
  const values = [825, 830, 850, 880, 900];
  const limits = [900, 900, 900, 837, 837];
  const events = run(values.map((value, i) => ({
    standards: [reading("instructions", value, limits[i] ?? 837, "down")],
  })));
  const outcome = runDetector(trajectory, buildStreamFacts(events, "main"));
  const finding = outcome.findings[0];
  assert(finding !== undefined);
  assertEquals(
    finding.summary,
    "This standard has less headroom: 825 → 900 vs ceiling 837.",
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

Deno.test("patterns driver scoring: provenance and CI classify automation", () => {
  assertEquals(
    driverKind(verb({
      driver: {
        json: true,
        tty: false,
        ci: true,
        spawned_by: "11111111-2222-4333-8444-555555555555",
      },
    })),
    "automation",
    "an explicit spawned_by marker declares an automated child invocation",
  );
  assertEquals(
    driverKind(verb({
      driver: {
        json: true,
        tty: false,
        ci: true,
        agent_signals: [{
          agent: "codex",
          source: "process-environment",
          markers: ["CODEX_THREAD_ID"],
        }],
      },
    })),
    "automation",
    "inherited identity markers do not outrank the automation evidence",
  );
  assertEquals(
    driverKind(verb({ driver: { json: true, tty: false, ci: true } })),
    "automation",
    "the conventional CI marker is the fallback for unmarked history",
  );
  assertEquals(
    driverKind(verb({ driver: { tty: true, ci: false } })),
    "human",
    "a terminal without automation or identity evidence stays human",
  );
});

Deno.test("cohort seam: automation events join no cohort and no remainder", () => {
  const claudeDecision = verb({
    driver: {
      json: true,
      tty: false,
      ci: false,
      agent_signals: [{
        agent: "claude",
        source: "process-environment",
        markers: ["CLAUDECODE"],
      }],
    },
  });
  const codexMarkedChild = verb({
    driver: {
      json: true,
      tty: false,
      ci: true,
      spawned_by: "11111111-2222-4333-8444-555555555555",
      agent_signals: [{
        agent: "codex",
        source: "process-environment",
        markers: ["CODEX_THREAD_ID"],
      }],
    },
  });
  const mixed = { events: [claudeDecision, codexMarkedChild] };
  const plumbingOnly = { events: [codexMarkedChild] };
  const split = splitByCohort([mixed, plumbingOnly], (unit) => unit.events);
  assertEquals(split.speaking.length, 0, "one run sits below the minimums");
  assertEquals(split.belowMinimum.map((c) => c.agent), ["claude"]);
  assertEquals(
    split.belowMinimum[0]?.runs,
    1,
    "the gate child neither counts for claude nor votes codex against it",
  );
  assertEquals(split.unattributedUnits, 0);
  assertEquals(
    split.unattributedRuns,
    0,
    "an automation-only unit carries no decisions to compare",
  );
});
