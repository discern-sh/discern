/**
 * The `patterns` **detector registry** — the single source of truth for every
 * named detector the verb runs over the logbook's event stream. Each entry is a
 * checkable predicate with a stable id, a family, the scope its findings apply
 * to, a tier (wave 3's proof/status surfacing may carry `inline` findings;
 * `batch` runs only under the verb), an evidence threshold, and a recommended
 * next step. Parameterized tests iterate this registry, so a new detector
 * auto-enrols into the harness — including the fixture obligation.
 *
 * Three rules bind every detector:
 *
 *  - **Advisory only.** A detector returns findings; nothing here can touch an
 *    exit code or a gate outcome, structurally — the module exports data and
 *    pure functions, and the gate never imports it.
 *  - **Facts, not judgments.** A finding's `observed` sentence and `evidence`
 *    carry plain counts and durations. `tone` is deterministic presentation
 *    metadata derived from those facts, never a severity tier or enforcement
 *    input. The one score is `strength` — a unitless RANKING key for ordering
 *    the report, never rendered as evidence.
 *  - **Evidence before speech.** Below its `threshold` of qualifying events a
 *    detector reports insufficient evidence rather than extrapolating. A young
 *    logbook produces a short report, not a confident one.
 *
 * Segmentation before judgment: driver signals are scored in reader logic
 * (`driverKind`, `driverAgent`, and the cohort seam — `cohorts.ts`) — never
 * stored — so an owner's interactive runs don't read as agent pathology, CI
 * noise drops out, and a smarter future reader can re-score all accumulated
 * history. Identity evidence follows the catalogue's lifetime classification:
 * invocation-scoped signals may drive a reading, ambient host state never
 * does, and conflicting evidence stays honestly unresolved. Trend detectors
 * compare only runs sharing one setup — equality of config epoch, writer
 * version, and dominant-client version ({@link comparableSeries}), never
 * position in the stream: parallel worktrees append to ONE logbook, so one
 * setup's runs are routinely interleaved with another's and a contiguous
 * window would fragment what is genuinely comparable. Runs under other
 * setups are attributed — named and counted — rather than blended in or
 * silently discarded. Events recorded during one-time setup (the dedicated
 * setup branch) are excluded from analysis entirely: they describe a project
 * being stood up, not a practice.
 *
 * Thresholds are recorded judgment: each carries a comment saying why that
 * number, all start conservative, and accumulated dogfood history is the
 * intended tuner.
 */

import { AGENT_CATALOGUE } from "../../shared/agent_catalogue.ts";
import { KNOWN_VERBS } from "../../shared/verbs.ts";
import { hiddenVerbNames } from "../../shared/hidden_verbs.ts";
import { SETUP_BRANCH } from "../../shared/setup_state.ts";
import {
  boundedPatternEvidenceCondition,
  type DetectorFamily,
  type DetectorScope,
  type DetectorStatus,
  type DetectorTier,
  type PatternEvidenceBasis,
  type PatternFindingTone,
  PATTERNS_SERIES_MAX_POINTS,
} from "../../shared/patterns_vocabulary.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import { type HintFollowThroughRule, HINTS } from "../../shared/hints.ts";
import { type RegisteredTip, TIPS } from "../../shared/tips.ts";
import {
  COHORT_MINIMUMS,
  cohortDenominators,
  comparative,
  denominatorClause,
  dominantClientEras,
  driverAgent,
  driverKind,
  splitByCohort,
} from "./cohorts.ts";
import { effectiveAgentSignals } from "./agent_identity.ts";
import {
  executionDurationMs,
  type LogbookEvent,
  type PruneDigest,
  type StandardReading,
  type VerbEvent,
} from "./schema.ts";
import { byBranch } from "./read.ts";
import {
  analyzeCheckpointObservations,
  checkpointConfigBoundary,
  gateEffortsSince,
} from "./checkpoint_economics.ts";
import {
  crossContextValidationGroups,
  observedEvidenceValues,
  sameEnvelopeValidationGroups,
  VALIDATION_FINDING_RELATIONSHIPS,
  type ValidationContextBucket,
  validationContextLabel,
  type ValidationFindingRelationship,
  type ValidationRepeatGroup,
} from "./validation_findings.ts";

/** Stable marker carried in standard observations when their series crosses
 * a configuration or release boundary. The human report recognizes the same
 * marker and states the attribution caveat once per trajectory section. */
export const TRAJECTORY_BOUNDARY_ATTRIBUTION =
  "segments are attributed, not blended";

// ── the stream, pre-digested ────────────────────────────────────────────────

/** One completed Gate-job duration retained in the per-stream analysis. */
interface CompletedJobSample {
  event: VerbEvent;
  seconds: number;
}

/** Setup and completed-job facts derived once for every detector run. */
export interface StreamAnalysis {
  /** Display label for the dominant recorded MCP client, when one exists. */
  clientLabel: string | undefined;
  /** One event's dominant-client version in effect. */
  clientVersionOf(event: VerbEvent): string | undefined;
  /** Constant-time config/writer/client setup identity for one event. */
  setupKeyOf(event: VerbEvent): string;
  /** Completed Gate jobs, indexed first by label and then by setup identity. */
  completedJobs: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly CompletedJobSample[]>
  >;
}

/** The event stream plus everything detectors keep re-deriving, computed once. */
export interface StreamFacts {
  /** Every parsed event eligible for analysis, oldest first (setup-era
   * events — see {@link buildStreamFacts} — are already set aside). */
  events: LogbookEvent[];
  /** Verb events eligible for analysis: CI runs and `--dry-run` previews excluded. */
  verbs: VerbEvent[];
  /** {@link StreamFacts.verbs} minus interactively-driven runs (see {@link driverKind}) —
   * the behaviour detectors' population, so an owner's exploratory runs never
   * read as agent pathology. */
  agentish: VerbEvent[];
  /** The trunk branch name (`[repository].trunk`) — the branch work must not land on directly. */
  trunk: string;
  /** The native provider names instructions are compiled for (the configured
   * `[project].agents`, resolved) — what the provider-fit detector reads the
   * driver mix against. */
  configuredAgents: readonly string[];
  /** The live config's `[checkpoints]` ids — what the checkpoint hygiene
   * detectors read observed servings against (a checkpoint nobody configures
   * anymore needs no review advice). */
  configuredCheckpoints: readonly string[];
  /** The newest event's timestamp — the stream's own "now", so age-relative
   * detectors are pure functions of the stream (and deterministic in tests). */
  horizon: string | undefined;
  /** Events recorded during the project's one-time setup, set aside before
   * any population was derived — reported, so the exclusion is never silent. */
  setupEra: number;
  /** Whole-stream setup and completed-job analysis shared by every detector. */
  analysis: StreamAnalysis;
}

/** The analysis population of a raw stream: verb events minus CI noise and
 * `--dry-run` previews — shared by {@link buildStreamFacts} and the setup
 * vocabulary in {@link comparableSeries}, so the two can't diverge. */
function analyzableVerbs(events: readonly LogbookEvent[]): VerbEvent[] {
  return events.filter((e): e is VerbEvent => e.kind === "verb")
    .filter((e) => e.driver?.ci !== true && e.dry_run !== true);
}

/** True for an event recorded during the project's one-time setup: work on
 * the dedicated setup branch is a project being configured, not the practice
 * the detectors describe — gate runs there measure a half-wired gate, so
 * their durations and outcomes describe the wiring, not the finished setup.
 * Reader-side interpretation: the events stay recorded, and a revised
 * reading covers all history. Prune digests carry no branch and are never
 * setup-era. */
function setupEraEvent(e: LogbookEvent): boolean {
  return e.kind !== "prune" && e.branch === SETUP_BRANCH;
}

/** Build the setup and completed-job indexes once for one analyzed stream. */
function buildStreamAnalysis(verbs: readonly VerbEvent[]): StreamAnalysis {
  const eras = dominantClientEras(verbs);
  const clientVersions = new Map<VerbEvent, string | undefined>();
  const setupKeys = new Map<VerbEvent, string>();
  for (const event of verbs) {
    clientVersions.set(event, eras.versionInEffectOf(event));
  }
  const clientVersionOf = (event: VerbEvent): string | undefined =>
    clientVersions.has(event)
      ? clientVersions.get(event)
      : eras.versionInEffectOf(event);
  for (const event of verbs) {
    setupKeys.set(event, setupOf(event, clientVersionOf));
  }
  const setupKeyOf = (event: VerbEvent): string =>
    setupKeys.get(event) ?? setupOf(event, clientVersionOf);

  const completedJobs = new Map<
    string,
    Map<string, CompletedJobSample[]>
  >();
  for (const event of verbs) {
    if (event.verb !== "done") {
      continue;
    }
    const setup = setupKeyOf(event);
    const indexedLabels = new Set<string>();
    for (const step of event.steps ?? []) {
      if (
        step.disposition !== "run" ||
        (step.outcome !== "ok" && step.outcome !== "failed") ||
        step.duration_s === undefined || indexedLabels.has(step.label)
      ) {
        continue;
      }
      indexedLabels.add(step.label);
      const bySetup = completedJobs.get(step.label) ?? new Map();
      const samples = bySetup.get(setup) ?? [];
      samples.push({ event, seconds: step.duration_s });
      bySetup.set(setup, samples);
      completedJobs.set(step.label, bySetup);
    }
  }
  return {
    clientLabel: eras.label,
    clientVersionOf,
    setupKeyOf,
    completedJobs,
  };
}

/** Build the pre-digested facts every detector receives. Setup-era events are
 * set aside first — every derived population, the boundary vocabulary, and
 * the stream horizon read from the remainder. */
export function buildStreamFacts(
  events: LogbookEvent[],
  trunk: string,
  configuredAgents: readonly string[] = [],
  configuredCheckpoints: readonly string[] = [],
): StreamFacts {
  const analyzed = events.filter((e) => !setupEraEvent(e));
  const verbs = analyzableVerbs(analyzed);
  const agentish = verbs.filter((e) => driverKind(e) !== "human");
  const analysis = buildStreamAnalysis(verbs);
  return {
    events: analyzed,
    verbs,
    agentish,
    trunk,
    configuredAgents,
    configuredCheckpoints,
    horizon: analyzed[analyzed.length - 1]?.at,
    setupEra: events.length - analyzed.length,
    analysis,
  };
}

// ── the registry vocabulary ─────────────────────────────────────────────────

/** One finding: what was observed (plain counts), about what, and what to do. */
export interface DetectorFinding {
  /** What the finding is about — a branch, a standard, a tool+rule, a commit. */
  subject?: string;
  /** Plain-language first sentence, read beside {@link subject}. */
  summary: string;
  /** Overrides the detector's presentation tone when this finding's facts decide it. */
  tone?: PatternFindingTone;
  /** Optional bounded numeric series for a compact reading aid. */
  series?: number[];
  /** The observation as one plain-count sentence. */
  observed: string;
  /** The counts behind the sentence, named. */
  evidence: Record<string, number>;
  /** Optional structured provenance and comparison boundary for the counts. */
  basis?: PatternEvidenceBasis;
  /** Unitless ranking key for report ordering — never evidence. */
  strength: number;
  /** Overrides the detector's default next step when a finding shape needs its own. */
  next_step?: string;
}

/** What one detector's run produced. */
export interface DetectorOutcome {
  /** Qualifying events (the detector's own denominator) — compared to `threshold`. */
  considered: number;
  findings: DetectorFinding[];
}

/** One registry entry — see the module doc for the rules every entry holds. */
export interface Detector {
  /** Stable kebab-case id — the wire name and the fixture key. */
  id: string;
  /** Short noun phrase naming what it watches for. */
  title: string;
  family: DetectorFamily;
  scope: DetectorScope;
  tier: DetectorTier;
  /** Presentation tone for findings whose own facts do not override it. */
  tone: PatternFindingTone;
  /** Present on detectors that segment their population by attributed driver
   * cohort through the cohort seam (`cohorts.ts`). The parameterized cohort
   * guards iterate exactly this set; for these detectors `considered` counts
   * qualifying cohorts, so `threshold` is the seam's two-population bar and a
   * split that cannot compare reports insufficient evidence. */
  cohorts?: true;
  /** Present on trend detectors that window their candidates through
   * {@link comparableSeries}. The parameterized interleaving guards iterate
   * exactly this set: a windowed detector's findings must be identical
   * whether or not foreign-setup runs interleave its comparable series. */
  windowed?: true;
  /** Present on the validation relationships derived from the canonical
   * relationship registry. Guards then auto-enrol every such detector into
   * the common evidence-contract assertions. */
  validationRelationship?: ValidationFindingRelationship;
  /** Minimum `considered` before the detector may speak. */
  threshold: number;
  /** The recommended structural next step (findings may override per shape). */
  next_step: string;
  detect(facts: StreamFacts): DetectorOutcome;
}

// ── shared analysis helpers ─────────────────────────────────────────────────

/** Group one branch's events by the recorder's session hint (the fallback that
 * separates interleaved conversations sharing a branch); hint-less events form
 * one group. */
function bySession(events: VerbEvent[]): VerbEvent[][] {
  const groups = new Map<string, VerbEvent[]>();
  for (const e of events) {
    const key = e.driver?.session ?? "";
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [e]);
    } else {
      group.push(e);
    }
  }
  return [...groups.values()];
}

/** The longest run of consecutive matching items. Shared with the stats
 * reader (`stats.ts`). */
export function longestStreak<T>(xs: T[], pred: (x: T) => boolean): number {
  let best = 0;
  let run = 0;
  for (const x of xs) {
    run = pred(x) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The median of a non-empty list (mean of the middle two when even). Shared
 * with the stats reader (`stats.ts`). */
export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) {
    return hi;
  }
  const lo = sorted[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

/** Round to one decimal place. Shared with the stats reader (`stats.ts`). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The calendar day of an ISO timestamp ("2026-07-20"). Shared with the stats
 * reader (`stats.ts`). */
export function day(at: string): string {
  return at.slice(0, 10);
}

/** Whole days between two ISO timestamps. */
function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Inclusive UTC calendar days spanned by two ISO timestamps ("23:59 to
 * 00:01" is 2 days), or undefined when either fails to parse. Shared by the
 * report header (`patterns.ts`) and the stats reader (`stats.ts`). */
export function inclusiveSpanDays(
  first: string,
  last: string,
): number | undefined {
  const start = Date.parse(first);
  const end = Date.parse(last);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startDay = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const endDay = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );
  return Math.floor(Math.abs(endDay - startDay) / 86_400_000) + 1;
}

/** What a trend's candidate events resolved to: the comparable series and,
 * when any candidate ran under a different setup, the excluded remainder. */
export interface ComparableSeries {
  /** Every candidate sharing the newest candidate's setup, oldest first. */
  series: VerbEvent[];
  /** Candidates under other setups — counted and named, never blended in. */
  excluded?: { runs: number; setups: number; detail: string };
}

/** One event's setup identity, as a grouping key: config epoch, writer
 * version, and the dominant client's version in effect. */
function setupOf(
  e: VerbEvent,
  versionInEffectOf: (e: VerbEvent) => string | undefined,
): string {
  return `${e.epoch ?? ""}\u0000${e.writer ?? ""}\u0000${
    versionInEffectOf(e) ?? ""
  }`;
}

/**
 * The comparable series among a trend's candidate events: every run sharing
 * the newest run's SETUP — the config epoch, the writer version, and the
 * dominant client's version in effect ({@link dominantClientEras}) — wherever
 * it sits in the stream. Comparability is equality, never contiguity:
 * parallel worktrees carry their own configs and append to one shared
 * logbook, so one setup's runs are routinely interleaved with another's, and
 * runs under the same config stay one series across any number of
 * interleaved flips. The three setup dimensions carry equal weight: a shift
 * that lands exactly at the dominant client's upgrade is attributed to the
 * driver's release, not blended into the trend or blamed on the config.
 * When candidates under other setups exist, `excluded` counts them and names
 * how they differ (the section list from the newest `config-change` event
 * producing the current epoch where one exists; the version pair for a
 * writer or client release), so a trend detector can attribute instead of
 * blending — or staying silent.
 */
function comparableSeriesWithAnalysis(
  events: VerbEvent[],
  all: LogbookEvent[],
  analysis: StreamAnalysis,
): ComparableSeries {
  const last = events[events.length - 1];
  if (last === undefined) {
    return { series: [] };
  }
  const currentSetup = analysis.setupKeyOf(last);
  const series: VerbEvent[] = [];
  const excludedEvents: VerbEvent[] = [];
  for (const e of events) {
    (analysis.setupKeyOf(e) === currentSetup ? series : excludedEvents).push(e);
  }
  if (excludedEvents.length === 0) {
    return { series };
  }

  const setups = new Set(excludedEvents.map(analysis.setupKeyOf)).size;
  const moved: string[] = [];
  const otherEpochs = new Set(
    excludedEvents.filter((e) => e.epoch !== last.epoch).map((e) => e.epoch),
  );
  if (otherEpochs.size > 0) {
    let change: Extract<LogbookEvent, { kind: "config-change" }> | undefined;
    for (const e of all) {
      if (e.kind === "config-change" && e.epoch === last.epoch) {
        change = e; // the stream is chronological; keep the newest
      }
    }
    const named = change !== undefined && change.sections.length > 0
      ? ` (the change to it touched [${change.sections.join("], [")}])`
      : "";
    moved.push(
      otherEpochs.size === 1
        ? `another configuration${named}`
        : `${formatHumanNumber(otherEpochs.size)} other configurations${named}`,
    );
  }
  const otherWriters = new Set(
    excludedEvents.filter((e) => e.writer !== last.writer)
      .map((e) => e.writer ?? "unversioned"),
  );
  if (otherWriters.size > 0) {
    const [only] = otherWriters;
    moved.push(
      otherWriters.size === 1 && only !== undefined
        ? `the ${only} → ${last.writer ?? "unversioned"} release`
        : `${formatHumanNumber(otherWriters.size)} other releases`,
    );
  }
  const currentVersion = analysis.clientVersionOf(last);
  const otherVersions = new Set(
    excludedEvents.map(analysis.clientVersionOf).filter((v) =>
      v !== currentVersion
    ),
  );
  if (otherVersions.size > 0 && analysis.clientLabel !== undefined) {
    const [only] = otherVersions;
    moved.push(
      otherVersions.size === 1 && only !== undefined &&
        currentVersion !== undefined
        ? `the ${analysis.clientLabel} ${only} → ${currentVersion} client release`
        : `other ${analysis.clientLabel} client releases`,
    );
  }
  return {
    series,
    excluded: {
      runs: excludedEvents.length,
      setups,
      detail: moved.join(" and "),
    },
  };
}

/** Compare an arbitrary event list using one freshly derived stream index. */
export function comparableSeries(
  events: VerbEvent[],
  all: LogbookEvent[],
): ComparableSeries {
  return comparableSeriesWithAnalysis(
    events,
    all,
    buildStreamAnalysis(analyzableVerbs(all)),
  );
}

/** Compare detector candidates through the shared per-stream setup index. */
function comparableFactsSeries(
  events: VerbEvent[],
  facts: StreamFacts,
): ComparableSeries {
  return comparableSeriesWithAnalysis(events, facts.events, facts.analysis);
}

/** The attribution finding a trend detector reports when its comparable
 * series is too short to trend but runs under other setups exist — counting
 * and naming them rather than staying silent or comparing blindly. */
function attributionFinding(
  series: VerbEvent[],
  excluded: { runs: number; setups: number; detail: string },
): DetectorFinding {
  const comparable = series.length;
  const firstAt = series[0]?.at;
  const since = firstAt === undefined ? "" : `, first recorded ${day(firstAt)}`;
  return {
    summary:
      "The current setup does not yet have enough comparable runs for a trend.",
    tone: "neutral",
    observed: `only ${formatHumanNumber(comparable)} ${
      comparable === 1 ? "run shares" : "runs share"
    } the current setup${since} — the ${formatHumanNumber(excluded.runs)} ${
      excluded.runs === 1 ? "other run ran" : "other runs ran"
    } under ${excluded.detail} and ${
      excluded.runs === 1 ? "is" : "are"
    } excluded from the trend, not blended in.`,
    evidence: {
      comparable_runs: comparable,
      other_setup_runs: excluded.runs,
      other_setups: excluded.setups,
    },
    strength: 1,
    next_step:
      "A trend compares only runs sharing one configuration and release, wherever they sit in the stream; check back once more runs accrue on the current setup.",
  };
}

/** Name runs excluded from a current-setup comparison, when any exist. */
function excludedSetupSentence(
  excluded: { runs: number; detail: string } | undefined,
): string {
  if (excluded === undefined || excluded.runs === 0) return "";
  return ` ${formatHumanNumber(excluded.runs)} ${
    excluded.runs === 1 ? "run was" : "runs were"
  } recorded under ${excluded.detail} and excluded from this comparison.`;
}

/** Sum of a step group's recorded durations within one event. */
function stageSeconds(e: VerbEvent, group: string): number | undefined {
  const steps = (e.steps ?? []).filter((s) => s.group === group);
  if (steps.length === 0) {
    return undefined;
  }
  return steps.reduce((sum, s) => sum + (s.duration_s ?? 0), 0);
}

/** Whether two events share the complete setup boundary used by trend readers. */
function sameComparableSetup(
  left: VerbEvent,
  right: VerbEvent,
  facts: StreamFacts,
): boolean {
  return facts.analysis.setupKeyOf(left) === facts.analysis.setupKeyOf(right);
}

/** Count repeated complete validation states beyond the first observation. */
function unchangedValidationReruns(events: readonly VerbEvent[]): number {
  const counts = new Map<string, number>();
  for (const event of events) {
    const validation = event.validation;
    if (
      validation?.state.complete !== true ||
      validation.execution.complete !== true ||
      validation.state.digest === undefined
    ) {
      continue;
    }
    const key =
      `${validation.version}\0${validation.state.version}\0${validation.state.digest}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
}

/** A bounded setup account for structured decision evidence. */
function setupConditions(
  events: readonly VerbEvent[],
  analysis: StreamAnalysis,
): NonNullable<PatternEvidenceBasis["matched_conditions"]> {
  const clientRelease = analysis.clientLabel === undefined
    ? undefined
    : boundedPatternEvidenceCondition(
      `${analysis.clientLabel}-client-release`,
      events.map((event) => ({
        key: analysis.clientVersionOf(event) ?? "unrecorded",
        label: analysis.clientVersionOf(event) ?? "unrecorded",
      })),
    );
  return [
    boundedPatternEvidenceCondition(
      "config-epoch",
      events.map((event) => ({
        key: event.epoch ?? "unrecorded",
        label: event.epoch ?? "unrecorded",
      })),
    ),
    boundedPatternEvidenceCondition(
      "writer-release",
      events.map((event) => ({
        key: event.writer ?? "unrecorded",
        label: event.writer ?? "unrecorded",
      })),
    ),
    clientRelease,
  ].filter((condition) => condition !== undefined);
}

/** Build the common evidence basis for a decision finding. */
function decisionEvidenceBasis(
  kind: string,
  evidence: Record<string, number>,
  options: {
    comparable: number;
    denominator: number;
    unit: string;
    events: readonly VerbEvent[];
    facts: StreamFacts;
    estimated?: ReadonlySet<string>;
    legacyEvents?: number;
    excludedEvents?: number;
    limitations?: string[];
  },
): PatternEvidenceBasis {
  const estimated = options.estimated ?? new Set<string>();
  return {
    kind,
    coverage: {
      comparable: options.comparable,
      denominator: options.denominator,
      unit: options.unit,
    },
    validation_state: { version: null, complete: false },
    matched_conditions: setupConditions(options.events, options.facts.analysis),
    differing_conditions: [],
    legacy_events: options.legacyEvents ?? 0,
    excluded_events: options.excludedEvents ?? 0,
    limitations: options.limitations ?? [],
    values: Object.fromEntries(
      Object.entries(evidence).map(([name, value]) => [
        name,
        { value, kind: estimated.has(name) ? "estimated" : "observed" },
      ]),
    ),
  };
}

// ── the detectors ───────────────────────────────────────────────────────────

const doneThrash: Detector = {
  id: "done-thrash",
  title: "Consecutive red done runs",
  family: "behaviour",
  scope: "branch",
  tier: "inline",
  tone: "attention",
  // 4 done runs before speaking: a 3-streak needs at least 3, and one spare
  // keeps a brand-new branch's first stumbles out of the report.
  threshold: 4,
  next_step:
    "Start with the first repeated diagnostic and use the `discern-cure-a-bug` skill's diagnose procedure to prove its cause. Use `discern prepare` when the Gate identifies fix or regeneration work it can prevent.",
  detect(facts): DetectorOutcome {
    const dones = facts.agentish.filter((e) => e.verb === "done");
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(dones)) {
      for (const session of bySession(events)) {
        const streak = longestStreak(session, (e) => e.outcome === "failed");
        // A 3-streak is where iteration stops looking like progress.
        if (streak >= 3) {
          const evidence = {
            consecutive_failures: streak,
            runs: session.length,
          };
          findings.push({
            subject: branch,
            summary: "This branch had repeated red Gates in one conversation.",
            observed: `\`done\` failed ${
              formatHumanNumber(streak)
            } consecutive runs on \`${branch}\` (${
              formatHumanNumber(session.length)
            } runs in the conversation).`,
            evidence,
            basis: decisionEvidenceBasis("red-done-streak", evidence, {
              comparable: session.length,
              denominator: session.length,
              unit: "Gate runs in the conversation",
              events: session,
              facts,
              limitations: [
                "The streak is conversation-scoped; synthesis requires another finding on the same branch and recorded setup.",
              ],
            }),
            strength: streak,
          });
        }
      }
    }
    return { considered: dones.length, findings };
  },
};

const refusalLoop: Detector = {
  id: "refusal-loop",
  title: "Repeated refusals with one slug",
  family: "behaviour",
  scope: "session",
  tier: "inline",
  tone: "attention",
  // 3 refusals: two can be one honest retry; the third repeat of the same
  // refusal shows the same precondition remained unmet.
  threshold: 3,
  next_step:
    "Read the refusal message and satisfy the precondition it names before retrying. If the same precondition keeps recurring, capture the lesson with the `discern-teach-the-project` skill.",
  detect(facts): DetectorOutcome {
    const refused = facts.agentish.filter((e) => e.outcome === "refused");
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(refused)) {
      const bySlug = new Map<
        string,
        { verb: string; slug: string; count: number }
      >();
      for (const e of events) {
        const slug = e.error ?? "";
        const key = `${e.verb} ${slug}`;
        const entry = bySlug.get(key) ?? { verb: e.verb, slug, count: 0 };
        entry.count += 1;
        bySlug.set(key, entry);
      }
      for (const { verb, slug, count } of bySlug.values()) {
        if (count >= 3) {
          findings.push({
            subject: branch,
            summary: "The same command refusal recurred on this branch.",
            observed:
              `\`${verb}\` refused ${formatHumanNumber(count)} of ${
                formatHumanNumber(events.length)
              } recorded refusals on \`${branch}\`` +
              (slug !== "" ? ` with the same slug (\`${slug}\`).` : "."),
            evidence: { refusals: count, branch_refusals: events.length },
            strength: count,
          });
        }
      }
    }
    return { considered: refused.length, findings };
  },
};

interface FollowThroughFamily {
  family: string;
  rule: HintFollowThroughRule;
  hintIds: ReadonlySet<string>;
}

/** The rule kinds resolved by scanning forward from one firing EVENT. The
 * checkpoint kind is excluded: its episodes are enumerated per checkpoint id
 * from the events' recorded observation blocks (a stream walk), not per
 * delivered hint. */
type EventFollowThroughRule = Exclude<
  HintFollowThroughRule,
  { kind: "checkpoint-revision-before-declaration" }
>;

/** A family whose episodes open per firing event. */
interface EventFollowThroughFamily extends FollowThroughFamily {
  rule: EventFollowThroughRule;
}

/** Whether a family's episodes come from per-event hint firings. */
function isEventFamily(
  family: FollowThroughFamily,
): family is EventFollowThroughFamily {
  return family.rule.kind !== "checkpoint-revision-before-declaration";
}

type EpisodeOutcome = "followed" | "not-followed" | "censored";

/** Derive every measurable family from the hint registry. No detector-side
 * hint-id table exists: a new declaration enrolls by being in `HINTS`. */
function followThroughFamilies(): FollowThroughFamily[] {
  const groups = new Map<
    string,
    { rule: HintFollowThroughRule; hintIds: Set<string> }
  >();
  for (const hint of Object.values(HINTS)) {
    const rule = hint.followThrough;
    if (rule === undefined) {
      continue;
    }
    const existing = groups.get(rule.family);
    if (existing === undefined) {
      groups.set(rule.family, { rule, hintIds: new Set([hint.id]) });
    } else {
      existing.hintIds.add(hint.id);
    }
  }
  return [...groups.entries()].map(([family, group]) => ({
    family,
    rule: group.rule,
    hintIds: group.hintIds,
  }));
}

/** Check whether an event emitted any hint belonging to a follow-through family. */
function firesFamily(
  event: VerbEvent,
  family: FollowThroughFamily,
): boolean {
  return (event.hint_ids ?? []).some((id) => family.hintIds.has(id));
}

/** Compare invocation sessions only when both events record one on the same command surface. */
function sameRecordedSession(
  firing: VerbEvent,
  candidate: VerbEvent,
): boolean | undefined {
  const session = firing.driver?.session;
  const candidateSession = candidate.driver?.session;
  if (
    session === undefined || candidateSession === undefined ||
    firing.surface !== candidate.surface
  ) {
    return undefined;
  }
  return session === candidateSession;
}

/** Classify whether a hinted branch action occurred before its boundary verb. */
function branchActionOutcome(
  events: readonly VerbEvent[],
  index: number,
  rule: Extract<
    HintFollowThroughRule,
    { kind: "branch-action-before-boundary" }
  >,
): EpisodeOutcome {
  const firing = events[index];
  if (firing === undefined || firing.branch === null) {
    return "censored";
  }
  for (const candidate of events.slice(index + 1)) {
    if (candidate.branch !== firing.branch) {
      continue;
    }
    if (rule.actionVerbs.includes(candidate.verb)) {
      return "followed";
    }
    if (candidate.verb === rule.boundaryVerb) {
      return "not-followed";
    }
  }
  return "censored";
}

/** Classify whether the same session acted before a hint family fired again. */
function repeatedHintOutcome(
  events: readonly VerbEvent[],
  index: number,
  family: FollowThroughFamily,
  rule: Extract<
    HintFollowThroughRule,
    { kind: "session-action-before-repeat" }
  >,
): EpisodeOutcome {
  const firing = events[index];
  if (
    firing === undefined || firing.branch === null ||
    firing.driver?.session === undefined
  ) {
    return "censored";
  }
  for (const candidate of events.slice(index + 1)) {
    if (candidate.branch !== firing.branch) {
      continue;
    }
    const action = candidate.verb === rule.actionVerb;
    const repeated = firesFamily(candidate, family);
    if (!action && !repeated) {
      continue;
    }
    const sameSession = sameRecordedSession(firing, candidate);
    if (sameSession === undefined) {
      return "censored";
    }
    if (!sameSession) {
      continue;
    }
    return action ? "followed" : "not-followed";
  }
  return "censored";
}

/** Classify whether a session started isolation before making trunk dirty. */
function mainWorktreeOutcome(
  events: readonly VerbEvent[],
  index: number,
  trunk: string,
  rule: Extract<
    HintFollowThroughRule,
    { kind: "main-session-start-before-dirty" }
  >,
): EpisodeOutcome {
  const firing = events[index];
  if (
    firing === undefined || firing.branch !== trunk ||
    firing.driver?.session === undefined
  ) {
    return "censored";
  }
  for (const candidate of events.slice(index + 1)) {
    const action = candidate.verb === rule.actionVerb;
    const dirtyTrunk = candidate.branch === trunk && candidate.clean === false;
    if (!action && !dirtyTrunk) {
      continue;
    }
    const sameSession = sameRecordedSession(firing, candidate);
    if (sameSession === undefined) {
      return "censored";
    }
    if (!sameSession) {
      continue;
    }
    return action ? "followed" : "not-followed";
  }
  return "censored";
}

/** Dispatch a hint episode to the follow-through rule declared by its family. */
function episodeOutcome(
  events: readonly VerbEvent[],
  index: number,
  family: EventFollowThroughFamily,
  trunk: string,
): EpisodeOutcome {
  switch (family.rule.kind) {
    case "branch-action-before-boundary":
      return branchActionOutcome(events, index, family.rule);
    case "session-action-before-repeat":
      return repeatedHintOutcome(events, index, family, family.rule);
    case "main-session-start-before-dirty":
      return mainWorktreeOutcome(events, index, trunk, family.rule);
  }
}

interface FollowThroughCounts {
  fired: number;
  followed: number;
  notFollowed: number;
  censored: number;
}

/**
 * Walk the stream once for the checkpoint-declaration family: episodes are
 * enumerated per (branch, checkpoint id) from the events' recorded checkpoint
 * observations, so every configured checkpoint — present and future — enrols
 * without naming itself anywhere. A serving (fired or reopened) opens one
 * pending episode; a reopen while one is pending folds into it (the same
 * awaited conclusion, its subject moved). The declaration that resolves it
 * says whether a relevant revision replaced the subject first (`followed`)
 * or the subject was unchanged (`not followed`). Conservative censoring: a
 * family hint delivered by a writer without the observation block, a missing
 * branch, a declaration without the revision flag, and pending episodes at
 * the end of history all censor rather than claim.
 */
function checkpointDeclarationEpisodes(
  events: readonly VerbEvent[],
  family: FollowThroughFamily,
  counts: FollowThroughCounts,
): void {
  const pending = new Set<string>();
  for (const event of events) {
    const block = event.checkpoints;
    if (block === undefined) {
      if (firesFamily(event, family)) {
        counts.fired += 1;
        counts.censored += 1;
      }
      continue;
    }
    const servings = [...(block.fired ?? []), ...(block.reopened ?? [])];
    if (event.branch === null) {
      counts.fired += servings.length;
      counts.censored += servings.length;
      continue;
    }
    const key = (id: string): string => `${event.branch}\u0000${id}`;
    for (const serving of servings) {
      if (!pending.has(key(serving.id))) {
        pending.add(key(serving.id));
        counts.fired += 1;
      }
    }
    for (const declaration of block.declared ?? []) {
      const opened = key(declaration.id);
      if (!pending.has(opened)) {
        // Replacing a standing conclusion (the other verdict, a new
        // rationale) opens no episode: nothing was served to follow.
        continue;
      }
      pending.delete(opened);
      if (typeof declaration.revised !== "boolean") {
        counts.censored += 1;
        continue;
      }
      if (declaration.revised) {
        counts.followed += 1;
      } else {
        counts.notFollowed += 1;
      }
    }
  }
  counts.censored += pending.size;
}

/**
 * Measures delivered hint → observable outcome episodes. This is deliberately
 * distinct from `skipped-prepare`: that detector judges done-heavy iteration
 * whether or not any hint fired; this one has no denominator without a
 * registry-declared, delivered hint.
 */
const hintFollowThrough: Detector = {
  id: "hint-follow-through",
  title: "Hint follow-through by family",
  family: "behaviour",
  scope: "session",
  tier: "inline",
  tone: "attention",
  // Three RESOLVED episodes per family: one or two can be situational, while a
  // third makes both follow-through and non-follow-through worth reporting.
  // Trailing or uncorrelatable firings stay censored and never clear this bar.
  threshold: 3,
  next_step:
    "Review any family with not-followed episodes and improve the hint's timing or wording. If the action is indispensable, promote it to a refusal or structural check.",
  detect(facts): DetectorOutcome {
    const families = followThroughFamilies();
    const counts = new Map<string, FollowThroughCounts>();
    for (const family of families) {
      counts.set(family.family, {
        fired: 0,
        followed: 0,
        notFollowed: 0,
        censored: 0,
      });
    }

    const eventFamilies = families.filter(isEventFamily);
    for (const [index, event] of facts.agentish.entries()) {
      for (const family of eventFamilies) {
        if (!firesFamily(event, family)) {
          continue;
        }
        const familyCounts = counts.get(family.family);
        if (familyCounts === undefined) {
          continue;
        }
        familyCounts.fired += 1;
        switch (
          episodeOutcome(facts.agentish, index, family, facts.trunk)
        ) {
          case "followed":
            familyCounts.followed += 1;
            break;
          case "not-followed":
            familyCounts.notFollowed += 1;
            break;
          case "censored":
            familyCounts.censored += 1;
            break;
        }
      }
    }
    for (const family of families) {
      if (isEventFamily(family)) {
        continue;
      }
      const familyCounts = counts.get(family.family);
      if (familyCounts === undefined) {
        continue;
      }
      checkpointDeclarationEpisodes(facts.agentish, family, familyCounts);
    }

    const findings: DetectorFinding[] = [];
    let considered = 0;
    for (const family of families) {
      const familyCounts = counts.get(family.family);
      if (familyCounts === undefined) {
        continue;
      }
      const resolved = familyCounts.followed + familyCounts.notFollowed;
      considered = Math.max(considered, resolved);
      if (resolved < 3) {
        continue;
      }
      const allFollowed = familyCounts.notFollowed === 0;
      findings.push({
        subject: family.family,
        summary: allFollowed
          ? "Every resolved episode followed this hint family."
          : "Some resolved episodes did not follow this hint family.",
        tone: allFollowed ? "good" : "attention",
        observed: `\`${family.family}\` fired ${
          formatHumanNumber(familyCounts.fired)
        } times: ${formatHumanNumber(familyCounts.followed)} followed, ${
          formatHumanNumber(familyCounts.notFollowed)
        } not followed, and ${
          formatHumanNumber(familyCounts.censored)
        } censored.`,
        evidence: {
          fired: familyCounts.fired,
          followed: familyCounts.followed,
          not_followed: familyCounts.notFollowed,
          censored: familyCounts.censored,
        },
        strength: resolved,
        ...(allFollowed
          ? {
            next_step:
              "Keep collecting evidence; every resolved episode followed this hint family, so it currently calls for no channel change.",
          }
          : {}),
      });
    }
    return { considered, findings };
  },
};

interface TipAdoptionMember {
  id: string;
  verbs: readonly string[];
}

interface TipAdoptionFamily {
  family: string;
  members: TipAdoptionMember[];
}

/** Derive every measurable family and member from the tip registry. A new
 * declaration enrolls without a detector-side id table. Unlike hint families,
 * members in one tip family can invite different verbs. */
function tipAdoptionFamilies(
  registry: readonly RegisteredTip[],
): TipAdoptionFamily[] {
  const groups = new Map<string, TipAdoptionMember[]>();
  for (const tip of registry) {
    const rule = tip.followThrough;
    if (rule === undefined) {
      continue;
    }
    const member = { id: tip.id, verbs: rule.verbs };
    const existing = groups.get(rule.family);
    if (existing === undefined) {
      groups.set(rule.family, [member]);
    } else {
      existing.push(member);
    }
  }
  return [...groups.entries()].map(([family, members]) => ({
    family,
    members,
  }));
}

/** The setup fields tip episodes correlate on. Branch, surface, and session
 * are absent on purpose: a person can adopt a desk tip through any of them. */
function tipAdoptionSetup(
  event: VerbEvent,
  clientVersionInEffect: (event: VerbEvent) => string | undefined,
  hasClientDimension: boolean,
): string | undefined {
  if (event.epoch === null || event.writer === undefined) {
    return undefined;
  }
  const clientVersion = clientVersionInEffect(event);
  if (hasClientDimension && clientVersion === undefined) {
    return undefined;
  }
  return `${event.epoch}\u0000${event.writer}\u0000${clientVersion ?? ""}`;
}

/** Classify whether a comparable setup acted before the same tip reappeared. */
function tipEpisodeOutcome(
  events: readonly VerbEvent[],
  index: number,
  member: TipAdoptionMember,
  clientVersionInEffect: (event: VerbEvent) => string | undefined,
  hasClientDimension: boolean,
): EpisodeOutcome {
  const firing = events[index];
  if (firing === undefined) {
    return "censored";
  }
  const firingSetup = tipAdoptionSetup(
    firing,
    clientVersionInEffect,
    hasClientDimension,
  );
  if (firingSetup === undefined) {
    return "censored";
  }
  for (const candidate of events.slice(index + 1)) {
    const repeated = (candidate.tip_ids ?? []).includes(member.id);
    const action = member.verbs.includes(candidate.verb);
    if (!repeated && !action) {
      continue;
    }
    const candidateSetup = tipAdoptionSetup(
      candidate,
      clientVersionInEffect,
      hasClientDimension,
    );
    if (candidateSetup === undefined) {
      return "censored";
    }
    if (candidateSetup !== firingSetup) {
      continue;
    }
    // A re-showing opens the next episode; an action on that same event was
    // not between the two showings.
    return repeated ? "not-followed" : "followed";
  }
  return "censored";
}

interface TipAdoptionCounts extends FollowThroughCounts {
  family: string;
  id: string;
}

const TIP_ADOPTION_RESOLVED_THRESHOLD = 3;

/** Choose the most repeatedly ignored tip and turn it into one concrete next action. */
function tipAdoptionNextStep(
  familyCounts: readonly TipAdoptionCounts[],
): string {
  const ignored = familyCounts.reduce<TipAdoptionCounts | undefined>(
    (worst, current) => {
      if (current.notFollowed === 0) {
        return worst;
      }
      if (
        worst === undefined ||
        current.notFollowed > worst.notFollowed ||
        (
          current.notFollowed === worst.notFollowed &&
          current.fired > worst.fired
        )
      ) {
        return current;
      }
      return worst;
    },
    undefined,
  );
  if (ignored !== undefined) {
    return `Review the \`${ignored.id}\` tip first. Make the invited action explicit, or retire the tip if it no longer earns a desk slot.`;
  }
  const established = familyCounts.reduce<TipAdoptionCounts | undefined>(
    (best, current) => {
      const resolved = current.followed + current.notFollowed;
      const bestResolved = best === undefined
        ? -1
        : best.followed + best.notFollowed;
      return best === undefined || resolved > bestResolved ||
          (resolved === bestResolved && current.fired > best.fired)
        ? current
        : best;
    },
    undefined,
  );
  if (established === undefined) {
    return "Keep collecting tip-adoption evidence.";
  }
  const resolved = established.followed + established.notFollowed;
  return `Keep the \`${established.id}\` tip in rotation while more showings resolve. Its ${
    formatHumanNumber(resolved)
  } resolved episodes all followed it.`;
}

/**
 * Evaluate shown-tip → declared-verb episodes for a registry. The injected
 * registry is a test seam for synthetic declarations; production passes
 * {@link TIPS}. Each tip clears the evidence bar on its own, so adding sparse
 * declarations cannot make another tip speak. `considered` is the largest
 * per-tip resolved population, matching the runner's one-threshold contract.
 */
export function tipAdoptionOutcome(
  facts: StreamFacts,
  registry: readonly RegisteredTip[] = TIPS,
): DetectorOutcome {
  const families = tipAdoptionFamilies(registry);
  const countsById = new Map<string, TipAdoptionCounts>();
  for (const family of families) {
    for (const member of family.members) {
      const counts: TipAdoptionCounts = {
        family: family.family,
        id: member.id,
        fired: 0,
        followed: 0,
        notFollowed: 0,
        censored: 0,
      };
      for (const [index, event] of facts.verbs.entries()) {
        if (!(event.tip_ids ?? []).includes(member.id)) {
          continue;
        }
        counts.fired += 1;
        switch (
          tipEpisodeOutcome(
            facts.verbs,
            index,
            member,
            facts.analysis.clientVersionOf,
            facts.analysis.clientLabel !== undefined,
          )
        ) {
          case "followed":
            counts.followed += 1;
            break;
          case "not-followed":
            counts.notFollowed += 1;
            break;
          case "censored":
            counts.censored += 1;
            break;
        }
      }
      countsById.set(member.id, counts);
    }
  }

  let considered = 0;
  const findings: DetectorFinding[] = [];
  for (const family of families) {
    const familyCounts = family.members.flatMap((member) => {
      const counts = countsById.get(member.id);
      return counts === undefined ? [] : [counts];
    });
    const reportable = familyCounts.filter((counts) => {
      const resolved = counts.followed + counts.notFollowed;
      considered = Math.max(considered, resolved);
      return resolved >= TIP_ADOPTION_RESOLVED_THRESHOLD;
    });
    if (reportable.length === 0) {
      continue;
    }
    const nextStep = tipAdoptionNextStep(reportable);
    for (const counts of reportable) {
      const resolved = counts.followed + counts.notFollowed;
      findings.push({
        subject: counts.id,
        summary: counts.notFollowed === 0
          ? "Every resolved episode followed this tip."
          : "Some resolved episodes did not follow this tip.",
        tone: counts.notFollowed === 0 ? "good" : "attention",
        observed: `The \`${counts.id}\` tip appeared at the desk ${
          formatHumanNumber(counts.fired)
        } times: ${formatHumanNumber(counts.followed)} followed, ${
          formatHumanNumber(counts.notFollowed)
        } not followed, and ${formatHumanNumber(counts.censored)} censored.`,
        evidence: {
          fired: counts.fired,
          followed: counts.followed,
          not_followed: counts.notFollowed,
          censored: counts.censored,
        },
        strength: resolved,
        next_step: nextStep,
      });
    }
  }
  return { considered, findings };
}

/**
 * Measures desk tip → observable adoption episodes. Adoption can arrive
 * through a human or an agent on any surface, branch, or session, so this
 * project-wide reader uses every analyzable verb rather than the agent-only
 * behavior population.
 */
const tipAdoption: Detector = {
  id: "tip-adoption",
  title: "Tip adoption by tip",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // Three resolved episodes per tip: sparse tips never pool their evidence.
  threshold: TIP_ADOPTION_RESOLVED_THRESHOLD,
  next_step:
    "Review tips with not-followed episodes. Make the invited action explicit, or retire advice that no longer earns a desk slot.",
  detect(facts): DetectorOutcome {
    return tipAdoptionOutcome(facts);
  },
};

type PreparePreventableKind = "generation" | "fix-drift";

/** Classify a clean Gate failure only when the recorded steps establish that
 * `prepare` runs the work that stopped it. Dirty Gates retain their full-
 * feedback role. Check/test and generic build failures remain outside the
 * predicate because prepare cannot prevent them. */
function preparePreventableKind(
  event: VerbEvent,
): PreparePreventableKind | undefined {
  if (
    event.verb !== "done" || event.clean !== true ||
    event.outcome !== "failed" || event.head === null || event.epoch === null
  ) {
    return undefined;
  }
  const steps = event.steps ?? [];
  if (event.failed_stage === "generated_drift") {
    return "generation";
  }
  if (event.failed_stage !== "tree_drift") {
    return undefined;
  }
  const fixWorked = steps.some((step) =>
    step.group === "Fix" && step.outcome === "ok"
  );
  const regenerationRan = steps.some((step) =>
    step.label.startsWith("generated:") && step.disposition === "run"
  );
  const genericBuildRan = steps.some((step) =>
    step.group === "Build" && !step.label.startsWith("generated:") &&
    step.disposition === "run"
  );
  const laterValidationRan = steps.some((step) =>
    (step.group === "Check" || step.group === "Test" ||
      step.group === "Check & test") &&
    step.outcome !== "skipped" && step.outcome !== "cancelled"
  );
  return fixWorked && !regenerationRan && !genericBuildRan &&
      !laterValidationRan
    ? "fix-drift"
    : undefined;
}

const skippedPrepare: Detector = {
  id: "skipped-prepare",
  title: "Repeated Gate work preventable by prepare",
  family: "behaviour",
  scope: "branch",
  tier: "inline",
  tone: "attention",
  // Two distinct clean HEADs establish repetition without treating additional
  // runs on one HEAD as evidence of a project-wide workflow pattern.
  threshold: 2,
  next_step:
    "Run `discern prepare` before the next commit when the same recorded fix or regeneration work keeps stopping the full Gate. Review and commit its changes, then run `discern done`; `done` remains a supported first command and dirty runs retain full feedback.",
  detect(facts): DetectorOutcome {
    const workflow = facts.agentish.filter((event) =>
      event.verb === "done" || event.verb === "prepare"
    );
    const findings: DetectorFinding[] = [];
    let considered = 0;
    for (const [branch, branchEvents] of byBranch(workflow)) {
      const byEpoch = new Map<string, VerbEvent[]>();
      for (const event of branchEvents) {
        if (event.epoch === null) continue;
        const events = byEpoch.get(event.epoch) ?? [];
        events.push(event);
        byEpoch.set(event.epoch, events);
      }
      for (const events of byEpoch.values()) {
        const dones = events.filter((event) => event.verb === "done");
        const candidates = dones.flatMap((event) => {
          const kind = preparePreventableKind(event);
          return kind === undefined ? [] : [{ event, kind }];
        });
        const byHead = new Map<string, (typeof candidates)[number]>();
        for (const candidate of candidates) {
          const head = candidate.event.head;
          if (head !== null && !byHead.has(head)) {
            byHead.set(head, candidate);
          }
        }
        considered += dones.length;
        if (byHead.size < 2) continue;
        const distinct = [...byHead.values()];
        const countKind = (kind: PreparePreventableKind): number =>
          distinct.filter((candidate) => candidate.kind === kind).length;
        const fixDrift = countKind("fix-drift");
        const generation = countKind("generation");
        const prepareRuns = events.filter((event) =>
          event.verb === "prepare"
        ).length;
        const evidence = {
          prepare_preventable_failures: byHead.size,
          done_runs: dones.length,
          distinct_clean_heads: byHead.size,
          same_head_additional_runs: candidates.length - byHead.size,
          fix_drift_failures: fixDrift,
          regeneration_failures: generation,
          prepare_runs: prepareRuns,
        };
        findings.push({
          subject: branch,
          summary:
            "Repeated clean Gate runs stopped on work that `discern prepare` also performs.",
          observed: `\`${branch}\` had ${formatHumanNumber(byHead.size)} of ${
            formatHumanNumber(dones.length)
          } \`done\` runs stop on ${
            formatHumanNumber(byHead.size)
          } distinct clean HEADs in work \`prepare\` also runs: ${
            formatHumanNumber(fixDrift)
          } fix-stage tree-drift failures and ${
            formatHumanNumber(generation)
          } regeneration failures. The same branch and config recorded ${
            formatHumanNumber(prepareRuns)
          } \`prepare\` runs; missing \`prepare\` alone did not establish this finding.`,
          evidence,
          basis: decisionEvidenceBasis(
            "prepare-preventable-gate-work",
            evidence,
            {
              comparable: byHead.size,
              denominator: dones.length,
              unit: "full-Gate runs",
              events,
              facts,
              limitations: [
                "The predicate proves recorded fix or regeneration work that preflight also runs; missing prepare invocation alone establishes nothing.",
              ],
            },
          ),
          strength: byHead.size,
        });
      }
    }
    return { considered, findings };
  },
};

const dirtyDoneChurn: Detector = {
  id: "dirty-done-churn",
  title: "Done churn on dirty trees",
  family: "behaviour",
  scope: "branch",
  tier: "inline",
  tone: "attention",
  // 5 done runs: dirty done runs are normal mid-task, so the detector waits
  // for enough of them to call the pattern a habit rather than a moment.
  threshold: 5,
  next_step:
    "Use `done` whenever full Gate feedback is needed. For a final Proof, commit the finished tree and run `done` on that clean HEAD; use `prepare` only for recorded fix or regeneration work and `test` for targeted iteration.",
  detect(facts): DetectorOutcome {
    const dones = facts.agentish.filter((e) => e.verb === "done");
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(dones)) {
      const dirty = events.filter((e) => e.clean === false).length;
      if (dirty >= 5 && dirty * 2 > events.length) {
        findings.push({
          subject: branch,
          summary:
            "Most recorded `done` runs on this branch started from a dirty tree.",
          observed: `${formatHumanNumber(dirty)} of ${
            formatHumanNumber(events.length)
          } \`done\` runs on \`${branch}\` ran on a dirty tree.`,
          evidence: { dirty_runs: dirty, done_runs: events.length },
          strength: dirty,
        });
      }
    }
    return { considered: dones.length, findings };
  },
};

const trunkEdits: Detector = {
  id: "trunk-edits",
  title: "Edits on the trunk",
  family: "behaviour",
  scope: "project",
  tier: "inline",
  tone: "attention",
  // 3 dirty-trunk events: one is a stray, three is a working pattern.
  threshold: 3,
  next_step:
    "Use `discern start` to put each change in its own worktree. Direct trunk edits bypass the isolated landing flow and can overlap with active efforts.",
  detect(facts): DetectorOutcome {
    const onTrunk = facts.agentish.filter((e) => e.branch === facts.trunk);
    const dirty = onTrunk.filter((e) => e.clean === false);
    const verbs = new Set(dirty.map((e) => e.verb));
    const findings: DetectorFinding[] = dirty.length >= 3
      ? [{
        subject: facts.trunk,
        summary: "Uncommitted work repeatedly appeared on the trunk.",
        observed: `${formatHumanNumber(dirty.length)} of ${
          formatHumanNumber(onTrunk.length)
        } analyzed trunk runs (${
          [...verbs].sort().join(", ")
        }) happened on \`${facts.trunk}\` with uncommitted changes in the tree.`,
        evidence: {
          dirty_trunk_runs: dirty.length,
          trunk_runs: onTrunk.length,
        },
        strength: dirty.length,
      }]
      : [];
    return { considered: onTrunk.length, findings };
  },
};

const forceHabit: Detector = {
  id: "force-habit",
  title: "Recurring --force",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 3 analyzed runs before judging flag habits at all; the firing bar is
  // 3 forced runs — each --force bypasses a guard once; three is a habit.
  threshold: 3,
  next_step:
    "Inspect the recorded reason for each forced run. Fix an unmet precondition first; adjust a guard only when repeated valid cases show it does not fit the workflow, and capture that decision with the `discern-teach-the-project` skill.",
  detect(facts): DetectorOutcome {
    const forced = facts.agentish.filter((e) =>
      (e.flags ?? []).includes("force")
    );
    const verbs = new Set(forced.map((e) => e.verb));
    const findings: DetectorFinding[] = forced.length >= 3
      ? [{
        summary: "`--force` was used repeatedly across recorded runs.",
        observed: `\`--force\` was passed ${
          formatHumanNumber(forced.length)
        } times across ${
          formatHumanNumber(facts.agentish.length)
        } analyzed agent-driven runs (${[...verbs].sort().join(", ")}).`,
        evidence: {
          forced_runs: forced.length,
          agent_driven_runs: facts.agentish.length,
        },
        strength: forced.length,
      }]
      : [];
    return { considered: facts.agentish.length, findings };
  },
};

const confirmedRerun: Detector = {
  id: "confirmed-rerun",
  title: "Recurring confirmed Gate reruns",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // Each --confirmed re-runs a tree the gate already judged — one is a
  // deliberate probe; three is a habit worth naming.
  threshold: 3,
  next_step:
    "Inspect why each already-judged tree was rerun. If a job changed verdict under matched recorded conditions, use the `discern-cure-a-bug` diagnose procedure; otherwise keep the recorded reason as context rather than inferring instability.",
  detect(facts): DetectorOutcome {
    const confirmed = facts.agentish.filter((e) =>
      e.verb === "done" && (e.flags ?? []).includes("confirmed")
    );
    const branches = new Set(
      confirmed.map((e) => e.branch).filter((b): b is string => b !== null),
    );
    const doneRuns = facts.agentish.filter((event) => event.verb === "done")
      .length;
    const findings: DetectorFinding[] = confirmed.length >= 3
      ? [{
        summary: "The Gate was repeatedly rerun on already-judged trees.",
        observed:
          `\`done --confirmed\` re-ran the Gate on an already-judged tree ${
            formatHumanNumber(confirmed.length)
          } times across ${
            formatHumanNumber(doneRuns)
          } recorded \`done\` runs` +
          (branches.size > 0
            ? ` across ${formatHumanNumber(branches.size)} branches.`
            : "."),
        evidence: {
          confirmed_runs: confirmed.length,
          done_runs: doneRuns,
          branches: branches.size,
        },
        strength: confirmed.length,
      }]
      : [];
    return { considered: facts.agentish.length, findings };
  },
};

/**
 * Operator verbs whose absence from a logbook is expected, each with the
 * recorded reason — the dormancy reader subtracts these, so their silence is
 * never read as an unused capability. Keys are `KNOWN_VERBS` members; the
 * registry test holds membership and non-empty reasons. `preset` enrols even
 * while the operator help also hides it, so returning it to the listing can
 * never silently turn an install-time verb into a dormancy finding.
 */
export const DORMANT_VERB_EXEMPTIONS: Readonly<Record<string, string>> = {
  preset: "an install-time overlay; an established project may never apply one",
  uninstall: "the exit verb; a project in use never runs it",
  licenses: "informational notices; reading them is not a working practice",
  help: "asking for help is not a practice the report should judge",
  mcp: "the server host providers launch, not an operator practice",
  patterns:
    "the report's own verb — the invocation that would report it dormant " +
    "records it, so its dormancy is unobservable",
};

/**
 * The verbs the dormancy reader watches: every known verb minus those the
 * operator help hides once bootstrapped and the enrolled expected-dormant
 * exemptions. Derived from the verb and hidden-verb registries, so a newly
 * registered verb auto-enrols into dormancy watching.
 */
export function dormantWatchedVerbs(): Set<string> {
  const watched = new Set(KNOWN_VERBS);
  for (const name of hiddenVerbNames(true)) {
    watched.delete(name);
  }
  for (const name of Object.keys(DORMANT_VERB_EXEMPTIONS)) {
    watched.delete(name);
  }
  return watched;
}

/**
 * Reports the watched verbs this repository's history has never recorded —
 * wired capability going unused. Usage can arrive through a human or an agent
 * on any surface, so this project-wide reader uses every analyzable verb
 * rather than the agent-only behaviour population.
 */
const dormantVerbs: Detector = {
  id: "dormant-verbs",
  title: "Operator verbs absent from the Logbook",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // 20 analyzable runs — a couple of recorded working sessions: enough room
  // to have reached for more than one verb, so an absence reflects practice
  // rather than a logbook too young to have needed it.
  threshold: 20,
  next_step:
    "Skim `discern help` for the verbs named here — each is a wired capability this project has never reached for, and the read-only ones cost a single invocation to try.",
  detect(facts): DetectorOutcome {
    const watched = [...dormantWatchedVerbs()].sort();
    // Compound recordings ("setup begin", "config get") count for their
    // top-level verb.
    const seen = new Set(
      facts.verbs.map((e) => e.verb.split(" ")[0] ?? e.verb),
    );
    const dormant = watched.filter((name) => !seen.has(name));
    const findings: DetectorFinding[] = dormant.length > 0
      ? [{
        summary:
          "Some operator commands have not appeared in this repository's Logbook.",
        observed: `${formatHumanNumber(dormant.length)} of the ${
          formatHumanNumber(watched.length)
        } operator verbs ${
          dormant.length === 1 ? "has" : "have"
        } never been recorded in this repository's history: ${
          dormant.map((name) => `\`${name}\``).join(", ")
        }.`,
        // The stream length stays out of the evidence: it is the detector
        // row's `considered` denominator, and carrying it here would change
        // the finding's identity on every recorded run.
        evidence: {
          dormant_verbs: dormant.length,
          watched_verbs: watched.length,
        },
        strength: dormant.length,
      }]
      : [];
    return { considered: facts.verbs.length, findings };
  },
};

/** A consent-bearing accept event that proves the trunk moved. Successful
 * results imply the landing; partial results need the recorded effect bit. */
function recordedLanding(event: VerbEvent): boolean {
  return event.verb === "accept" && event.consent !== undefined &&
    (event.outcome === "ok" ||
      (event.outcome === "partial" && event.landing?.trunk_landed === true));
}

/** Recognize landings backed by standing or effort-scoped machine authority. */
function preAuthorized(event: VerbEvent): boolean {
  return event.consent?.source === "standing-grant" ||
    event.consent?.source === "effort-grant";
}

/** Convert a count pair to a rounded percentage, including an empty denominator. */
function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** Translate a recorded grant source into human report vocabulary. */
function grantSourceLabel(source: string): string {
  return source === "standing-grant" ? "standing grant" : "effort grant";
}

const preAuthorizedLandings: Detector = {
  id: "pre-authorized-landings",
  title: "Pre-authorized landings",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // 8 consent-bearing landings gives two halves of 4 for a rate comparison.
  // The detector also waits for 3 pre-authorized landings before auditing a
  // delegation, so one exceptional effort never becomes a pattern.
  threshold: 8,
  next_step:
    "Use the source and scope counts to review where landing authority comes from. If a standing grant no longer matches your intent, edit `[acceptance].pre_authorized` on the trunk.",
  detect(facts): DetectorOutcome {
    const landings = facts.verbs.filter(recordedLanding);
    const delegated = landings.filter(preAuthorized);
    if (delegated.length < 3) {
      return { considered: landings.length, findings: [] };
    }

    const standing = delegated.filter((event) =>
      event.consent?.source === "standing-grant"
    );
    const effort = delegated.length - standing.length;
    const share = percent(delegated.length, landings.length);
    const longest = longestStreak(landings, preAuthorized);
    let current = 0;
    const currentSources = new Set<string>();
    for (let index = landings.length - 1; index >= 0; index -= 1) {
      const event = landings[index];
      if (event === undefined || !preAuthorized(event)) {
        break;
      }
      current += 1;
      const source = event.consent?.source;
      if (source !== undefined) {
        currentSources.add(source);
      }
    }

    const half = Math.floor(landings.length / 2);
    const earlier = landings.slice(0, half);
    const later = landings.slice(landings.length - half);
    const earlierShare = percent(
      earlier.filter(preAuthorized).length,
      earlier.length,
    );
    const laterShare = percent(
      later.filter(preAuthorized).length,
      later.length,
    );
    const shifted = half >= 4 &&
      Math.abs(laterShare - earlierShare) >= 30;

    const trendSentences: string[] = [];
    if (current >= 4) {
      const source = currentSources.size === 1
        ? currentSources.values().next().value
        : undefined;
      trendSentences.push(
        `The current run is ${formatHumanNumber(current)} pre-authorized ${
          current === 1 ? "landing" : "landings"
        }${
          source === undefined ? "." : ` under the ${grantSourceLabel(source)}.`
        }`,
      );
    } else if (longest >= 4) {
      trendSentences.push(
        `The longest pre-authorized run was ${
          formatHumanNumber(longest)
        } landings.`,
      );
    }
    if (shifted) {
      trendSentences.push(
        `The pre-authorized share moved from ${
          formatHumanNumber(earlierShare)
        }% across the earlier ${
          formatHumanNumber(earlier.length)
        } landings to ${formatHumanNumber(laterShare)}% across the later ${
          formatHumanNumber(later.length)
        }.`,
      );
    }

    const findings: DetectorFinding[] = [{
      summary:
        "Recorded landing authority handled part of this project's landings.",
      observed: `${formatHumanNumber(delegated.length)} of ${
        formatHumanNumber(landings.length)
      } landings with recorded consent evidence (${
        formatHumanNumber(share)
      }%) used pre-authorization: ${
        formatHumanNumber(standing.length)
      } used a standing grant and ${
        formatHumanNumber(effort)
      } used an effort grant.${
        trendSentences.length === 0 ? "" : ` ${trendSentences.join(" ")}`
      }`,
      evidence: {
        consent_recorded_landings: landings.length,
        pre_authorized_landings: delegated.length,
        pre_authorized_share_pct: share,
        standing_grant_landings: standing.length,
        effort_grant_landings: effort,
        longest_pre_authorized_streak: longest,
        current_pre_authorized_streak: current,
        ...(shifted
          ? {
            earlier_share_pct: earlierShare,
            later_share_pct: laterShare,
          }
          : {}),
      },
      strength: delegated.length,
    }];

    const scopeCounts = new Map<string, number>();
    for (const event of standing) {
      for (const scope of event.consent?.scopes ?? []) {
        scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
      }
    }
    for (
      const [scope, count] of [...scopeCounts.entries()].sort((a, b) =>
        b[1] - a[1] || a[0].localeCompare(b[0])
      )
    ) {
      findings.push({
        subject: scope,
        summary: "The standing grant for this scope covered recorded landings.",
        observed: `The standing grant for \`${scope}\` covered ${
          formatHumanNumber(count)
        } of ${formatHumanNumber(standing.length)} standing grant landings.`,
        evidence: {
          scope_landings: count,
          standing_grant_landings: standing.length,
        },
        strength: count,
      });
    }
    return { considered: landings.length, findings };
  },
};

const grantSuggestion: Detector = {
  id: "grant-suggestion",
  title: "Repeated conversational landings in one scope",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // A dozen is intentionally expensive evidence: every newest accept attempt
  // must be a successful conversational landing in the same single scope.
  threshold: 12,
  next_step:
    "A standing grant is an owner decision. Consider adding the named scope to `[acceptance].pre_authorized` in the trunk's `discern.toml` only when this run matches the delegation you want.",
  detect(facts): DetectorOutcome {
    const attempts = facts.verbs.filter((event) => event.verb === "accept");
    let scope: string | undefined;
    let run = 0;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const event = attempts[index];
      if (
        event === undefined || event.outcome !== "ok" ||
        event.consent?.source !== "conversation" ||
        event.scopes?.length !== 1
      ) {
        break;
      }
      const eventScope = event.scopes[0];
      if (
        eventScope === undefined ||
        (scope !== undefined && eventScope !== scope)
      ) {
        break;
      }
      scope = eventScope;
      run += 1;
    }
    if (run < 12 || scope === undefined) {
      return { considered: attempts.length, findings: [] };
    }
    return {
      considered: attempts.length,
      findings: [{
        subject: scope,
        summary:
          "Recent landings repeatedly used conversation consent for the same scope.",
        observed: `The latest ${formatHumanNumber(run)} of ${
          formatHumanNumber(attempts.length)
        } recorded \`accept\` attempts landed with conversation consent, and each changed only \`${scope}\`. No refusal interrupted the run.`,
        evidence: {
          consecutive_conversational_landings: run,
          accept_attempts: attempts.length,
          scopes: 1,
          intervening_refusals: 0,
        },
        strength: run,
        next_step:
          `Consider adding \`${scope}\` to \`[acceptance].pre_authorized\` in the trunk's \`discern.toml\`. Type the grant there yourself. discern never writes grants.`,
      }],
    };
  },
};

const docsGap: Detector = {
  id: "docs-gap",
  title: "Documentation lookups and misses",
  family: "behaviour",
  scope: "project",
  tier: "inline",
  tone: "neutral",
  // 5 lookups before reading anything into what gets looked up.
  threshold: 5,
  next_step:
    "The most-read topics are where instructions pays off — keep those pages current.",
  detect(facts): DetectorOutcome {
    // Humans reading docs are signal too, so this detector keeps every
    // non-CI lookup rather than the agent-scored subset.
    const lookups = facts.verbs.filter((e) =>
      (e.verb === "docs" || e.verb === "map") && e.target !== undefined
    );
    const findings: DetectorFinding[] = [];
    const misses = new Map<string, number>();
    const reads = new Map<string, number>();
    for (const e of lookups) {
      const key = `${e.verb} ${e.target ?? ""}`;
      if (e.outcome === "refused") {
        misses.set(key, (misses.get(key) ?? 0) + 1);
      } else {
        reads.set(key, (reads.get(key) ?? 0) + 1);
      }
    }
    const repeatedMisses = [...misses.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    for (const [key, count] of repeatedMisses) {
      findings.push({
        subject: key,
        summary: "The same documentation request was repeatedly refused.",
        tone: "attention",
        observed: `\`${key}\` was asked for ${
          formatHumanNumber(count)
        } times and refused every time across ${
          formatHumanNumber(lookups.length)
        } recorded documentation lookups.`,
        evidence: { misses: count, lookups: lookups.length },
        // Misses outrank read counts in the report: a missing page is
        // actionable, a popular one is context.
        strength: count * 25,
        next_step:
          "Add or cross-link the missing topic where the recorded requests looked for it; the `discern-document-subsystem` skill fits this work.",
      });
    }
    if (lookups.length >= 10 && reads.size > 0) {
      const top = [...reads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const first = top[0];
      if (first !== undefined) {
        findings.push({
          summary:
            "These were the most-read documentation topics in the recorded lookups.",
          observed: `${
            formatHumanNumber(lookups.length)
          } documentation lookups; most-read: ${
            top.map(([key, count]) =>
              `\`${key}\` (${formatHumanNumber(count)})`
            ).join(", ")
          }.`,
          evidence: { lookups: lookups.length, top_reads: first[1] },
          strength: first[1],
        });
      }
    }
    return { considered: lookups.length, findings };
  },
};

const abandonedWorktrees: Detector = {
  id: "abandoned-worktrees",
  title: "Inactive branches without a recorded green Gate",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 2 tracked branches: with one branch there is no fleet to compare against.
  threshold: 2,
  next_step:
    "Use `discern status` to inspect each named branch. Continue active work, or drop an effort only after confirming it is no longer needed.",
  detect(facts): DetectorOutcome {
    const branches = byBranch(
      facts.agentish.filter((e) => e.branch !== facts.trunk),
    );
    const horizon = facts.horizon;
    const abandoned: { branch: string; idleDays: number }[] = [];
    for (const [branch, events] of branches) {
      const green = events.some((e) =>
        (e.verb === "done" || e.verb === "accept") && e.outcome === "ok"
      );
      const lastAt = events[events.length - 1]?.at;
      if (green || lastAt === undefined || horizon === undefined) {
        continue;
      }
      const idleDays = daysBetween(lastAt, horizon);
      // A week idle with no green run: past the horizon of "still being worked".
      if (idleDays >= 7) {
        abandoned.push({ branch, idleDays });
      }
    }
    abandoned.sort((a, b) => b.idleDays - a.idleDays);
    const named = abandoned.slice(0, 5);
    const findings: DetectorFinding[] = abandoned.length > 0
      ? [{
        summary: "Some inactive branches have no recorded green Gate.",
        observed: `${formatHumanNumber(abandoned.length)} of ${
          formatHumanNumber(branches.size)
        } branches never went green and have been idle a week or more: ${
          named.map((a) =>
            `\`${a.branch}\` (${formatHumanNumber(a.idleDays)}d)`
          ).join(", ")
        }${abandoned.length > named.length ? ", …" : ""}.`,
        evidence: {
          abandoned: abandoned.length,
          branches: branches.size,
          longest_idle_days: named[0]?.idleDays ?? 0,
        },
        strength: abandoned.length * 5,
      }]
      : [];
    return { considered: branches.size, findings };
  },
};

const sequenceAnomaly: Detector = {
  id: "sequence-anomaly",
  title: "Validation and acceptance ordering",
  family: "behaviour",
  scope: "branch",
  tier: "batch",
  tone: "attention",
  // 2 qualifying events before judging orderings at all.
  threshold: 2,
  next_step:
    "A clean green `done` produces the Proof that `accept` verifies. Run `prepare` only when fix or regeneration work is relevant; acceptance cannot replace the Gate.",
  detect(facts): DetectorOutcome {
    const findings: DetectorFinding[] = [];
    const accepts = facts.agentish.filter((e) => e.verb === "accept");
    const dones = facts.agentish.filter((e) => e.verb === "done");
    // Named ordering 1: accept attempted on a branch with no green done ever.
    const greenByBranch = new Set(
      dones.filter((e) => e.outcome === "ok").map((e) => e.branch),
    );
    const premature = accepts.filter((e) => !greenByBranch.has(e.branch));
    const prematureBranches = [
      ...new Set(premature.map((e) => e.branch ?? "?")),
    ];
    if (premature.length >= 1) {
      findings.push({
        summary:
          "`accept` was attempted on branches without a recorded green Gate.",
        observed: `\`accept\` was attempted ${
          formatHumanNumber(premature.length)
        } time${premature.length === 1 ? "" : "s"} across ${
          formatHumanNumber(accepts.length)
        } recorded \`accept\` attempts, on ${
          formatHumanNumber(prematureBranches.length)
        } branch${
          prematureBranches.length === 1 ? "" : "es"
        } with no green \`done\` on record (${
          prematureBranches.slice(0, 3).map((b) => `\`${b}\``).join(", ")
        }${prematureBranches.length > 3 ? ", …" : ""}).`,
        evidence: {
          premature_accepts: premature.length,
          branches: prematureBranches.length,
          accept_attempts: accepts.length,
        },
        strength: premature.length * 10,
      });
    }
    // Named ordering 2: a green done re-run on the identical tree — the
    // proof already honors it, so the second full gate bought nothing.
    let redundant = 0;
    for (const [, events] of byBranch(dones)) {
      for (let i = 1; i < events.length; i += 1) {
        const prev = events[i - 1];
        const curr = events[i];
        if (
          prev !== undefined && curr !== undefined &&
          prev.outcome === "ok" && curr.outcome === "ok" &&
          prev.head !== null && prev.head === curr.head &&
          prev.tree === curr.tree
        ) {
          redundant += 1;
        }
      }
    }
    if (redundant >= 2) {
      findings.push({
        summary:
          "The Gate was rerun on unchanged trees that already had a valid Proof.",
        observed: `${formatHumanNumber(redundant)} of ${
          formatHumanNumber(dones.length)
        } recorded \`done\` runs repeated the full Gate on an identical tree that already had a valid Proof.`,
        evidence: { redundant_reruns: redundant, done_runs: dones.length },
        strength: redundant,
        next_step:
          "A green `done` on an unchanged tree is already honored — `discern status` shows the proof's standing without re-running anything.",
      });
    }
    return { considered: accepts.length + dones.length, findings };
  },
};

const identityGap: Detector = {
  id: "identity-gap",
  title: "Drivers the catalogue can't name",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // 5 identity-bearing runs before reading anything into the gaps.
  threshold: 5,
  next_step:
    "Check whether the current discern release recognizes the recorded client declaration. Until it does, treat identity-based cohort findings as incomplete.",
  detect(facts): DetectorOutcome {
    // Identity evidence is about the corpus, not behaviour pathology, so the
    // population is every analyzed run that carries any of it.
    const bearing = facts.verbs.filter((e) =>
      effectiveAgentSignals(e).length > 0 ||
      e.driver?.mcp_client !== undefined
    );
    const unknownClients = new Map<string, number>();
    let undeclared = 0;
    for (const e of bearing) {
      const signals = effectiveAgentSignals(e);
      const client = e.driver?.mcp_client;
      // A client declaration with no effective mcp-client signal means the
      // current catalogue cannot recognize it. The raw name remains visible.
      if (
        client !== undefined && !signals.some((s) => s.source === "mcp-client")
      ) {
        unknownClients.set(
          client.name,
          (unknownClients.get(client.name) ?? 0) + 1,
        );
      }
      if (signals.some((s) => s.agent === "custom")) {
        undeclared += 1;
      }
    }
    const findings: DetectorFinding[] = [];
    // 3 recurrences per gap: one visit is a stray, three is a regular driver.
    const recurring = [...unknownClients.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    for (const [name, count] of recurring) {
      findings.push({
        subject: name,
        summary: "Some MCP runs could not be attributed to a known client.",
        observed: `\`${name}\` drove ${formatHumanNumber(count)} of ${
          formatHumanNumber(bearing.length)
        } identity-bearing runs but matches nothing in the identity catalogue.`,
        evidence: { runs: count, identity_bearing_runs: bearing.length },
        strength: count,
      });
    }
    if (undeclared >= 3) {
      findings.push({
        summary: "Some runs carried an unrecognized `AI_AGENT` declaration.",
        observed:
          `an agent declaring an \`AI_AGENT\` value discern doesn't recognize drove ${
            formatHumanNumber(undeclared)
          } of ${formatHumanNumber(bearing.length)} identity-bearing runs.`,
        evidence: {
          runs: undeclared,
          identity_bearing_runs: bearing.length,
        },
        strength: undeclared,
      });
    }
    return { considered: bearing.length, findings };
  },
};

const providerFit: Detector = {
  id: "provider-fit",
  title: "A returning agent without its native integration",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 5 identity-attributed runs before reading the driver mix at all; the
  // firing bar is 3 runs from one identity — an agent that keeps coming back,
  // not a stray visit.
  threshold: 5,
  next_step:
    "discern can compile instructions and materialize skills for this agent natively. Add it to `[project].agents` in `discern.toml`, then run `discern refresh`.",
  detect(facts): DetectorOutcome {
    const runsByIdentity = new Map<string, number>();
    let attributed = 0;
    for (const e of facts.agentish) {
      const identity = driverAgent(e);
      if (identity === undefined) {
        continue;
      }
      attributed += 1;
      runsByIdentity.set(identity, (runsByIdentity.get(identity) ?? 0) + 1);
    }
    const configured = new Set(facts.configuredAgents);
    const findings: DetectorFinding[] = [];
    const ranked = [...runsByIdentity.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [identity, runs] of ranked) {
      if (runs < 3) {
        continue;
      }
      const entry = AGENT_CATALOGUE.find((i) => i.id === identity);
      // Only identities discern natively supports have anything to configure.
      if (entry === undefined || !("nativeName" in entry)) {
        continue;
      }
      if (configured.has(entry.nativeName)) {
        continue;
      }
      findings.push({
        subject: entry.label,
        summary:
          "A returning coding agent is not among this project's configured integrations.",
        observed: `${entry.label} drove ${formatHumanNumber(runs)} of ${
          formatHumanNumber(attributed)
        } identity-attributed runs, but isn't among the configured agent integrations.`,
        evidence: { runs, attributed_runs: attributed },
        strength: runs,
      });
    }
    return { considered: attributed, findings };
  },
};

/** The compiled instruction file for one cohort's identity, when discern emits
 * one — the provider surface a instruction-parity finding can name. Signal-only
 * identities have none: there is no compiled surface to fix, and provider-fit
 * already proposes adding an integration for a returning agent. */
function instructionSurfaceOf(agent: string): string | undefined {
  const entry = AGENT_CATALOGUE.find((i) => i.id === agent);
  return entry !== undefined && "instructionPath" in entry
    ? entry.instructionPath
    : undefined;
}

const cohortDoneThrash: Detector = {
  id: "cohort-done-thrash",
  title: "Consecutive red done runs, by driver cohort",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  cohorts: true,
  // `considered` counts cohorts clearing the seam's recorded minimums, so the
  // threshold is the two-population bar: a corpus that cannot honestly compare
  // reports insufficient evidence, never a one-sided "comparison".
  threshold: COHORT_MINIMUMS.cohorts,
  next_step:
    "Cohorts draw different task mixes, so these counts are a place to look, never a verdict. The branch-scope done-thrash findings name the exact thrashing branches — diagnose those (`discern-cure-a-bug`); if one cohort keeps meeting red streaks, check how its provider's compiled instructions teaches the `prepare` loop.",
  detect(facts): DetectorOutcome {
    const dones = facts.agentish.filter((e) => e.verb === "done");
    // The unit is the branch — the same unit done-thrash judges — attributed
    // whole, so a branch two agents drove counts for neither cohort.
    const units = [...byBranch(dones).entries()].map(([branch, events]) => ({
      branch,
      events,
      thrashed: bySession(events).some((session) =>
        longestStreak(session, (e) => e.outcome === "failed") >= 3
      ),
    }));
    const split = splitByCohort(units, (u) => u.events);
    const considered = split.speaking.length;
    if (!comparative(split)) {
      return { considered, findings: [] };
    }
    const perCohort = split.speaking.map((cohort) => ({
      cohort,
      thrashed: cohort.units.filter((u) => u.thrashed).length,
    }));
    const total = perCohort.reduce((sum, p) => sum + p.thrashed, 0);
    if (total === 0) {
      return { considered, findings: [] };
    }
    const evidence = cohortDenominators(split);
    for (const { cohort, thrashed } of perCohort) {
      evidence[`${cohort.agent}_branches`] = cohort.units.length;
      evidence[`${cohort.agent}_thrash_branches`] = thrashed;
    }
    const clauses = perCohort.map(({ cohort, thrashed }) =>
      `${cohort.label} ${formatHumanNumber(thrashed)} of ${
        formatHumanNumber(cohort.units.length)
      } ${cohort.units.length === 1 ? "branch" : "branches"}`
    );
    return {
      considered,
      findings: [{
        summary:
          "The report separates recorded red-Gate streaks by attributed driver cohort.",
        observed:
          `branches hitting a 3+ consecutive-red \`done\` streak, by attributed driver: ${
            clauses.join(", ")
          } (\`done\` runs: ${denominatorClause(split)}).`,
        evidence,
        strength: total,
      }],
    };
  },
};

const instructionParity: Detector = {
  id: "instruction-parity",
  title: "Instructions gaps by attributed driver cohort",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  cohorts: true,
  // Cohort-counted `considered`, as for every cohort detector.
  threshold: COHORT_MINIMUMS.cohorts,
  next_step:
    "Inspect the compiled instructions surface named by the finding. If it does not teach or route the recorded workflow, amend the authored instruction source and run `discern refresh`.",
  detect(facts): DetectorOutcome {
    // One authored source compiles to every provider's instruction file, so a
    // refusal or doc miss ONE population keeps hitting while its peers never
    // do is an empirical test of whether that provider's compiled output
    // lands. The population is the agent-scored corpus (unlike docs-gap,
    // which also reads human lookups): parity is a claim about agent cohorts.
    const split = splitByCohort(facts.agentish, (e) => [e]);
    const considered = split.speaking.length;
    if (!comparative(split)) {
      return { considered, findings: [] };
    }
    const speakingIds = new Set(split.speaking.map((c) => c.agent));
    interface GapCounts {
      byCohort: Map<string, number>;
      /** Hits from unattributed runs or below-minimum cohorts — outside the
       * comparison, still stated. */
      outside: number;
    }
    const tally = (
      gaps: Map<string, GapCounts>,
      key: string,
      event: VerbEvent,
    ): void => {
      const entry = gaps.get(key) ?? { byCohort: new Map(), outside: 0 };
      const id = driverAgent(event);
      if (id !== undefined && speakingIds.has(id)) {
        entry.byCohort.set(id, (entry.byCohort.get(id) ?? 0) + 1);
      } else {
        entry.outside += 1;
      }
      gaps.set(key, entry);
    };
    const refusals = new Map<string, GapCounts>();
    const misses = new Map<string, GapCounts>();
    for (const e of facts.agentish) {
      if (e.outcome !== "refused") {
        continue;
      }
      tally(
        refusals,
        `${e.verb}${e.error !== undefined ? ` ${e.error}` : ""}`,
        e,
      );
      if ((e.verb === "docs" || e.verb === "map") && e.target !== undefined) {
        tally(misses, `${e.verb} ${e.target}`, e);
      }
    }
    const findings: DetectorFinding[] = [];
    const differentials = (
      gaps: Map<string, GapCounts>,
      minHits: number,
      shape: "refusal" | "miss",
    ): void => {
      for (const [key, counts] of gaps) {
        const hitters = split.speaking.filter((c) =>
          (counts.byCohort.get(c.agent) ?? 0) > 0
        );
        // The parity claim needs one population hitting the gap and every
        // peer at zero — a gap several cohorts hit is a shared gap with a
        // shared fix, and stays un-split for the base detectors to report.
        const [only] = hitters;
        if (hitters.length !== 1 || only === undefined) {
          continue;
        }
        const hits = counts.byCohort.get(only.agent) ?? 0;
        if (hits < minHits) {
          continue;
        }
        const surface = instructionSurfaceOf(only.agent);
        if (surface === undefined) {
          continue;
        }
        const evidence = cohortDenominators(split);
        for (const c of split.speaking) {
          evidence[`${c.agent}_hits`] = counts.byCohort.get(c.agent) ?? 0;
        }
        if (counts.outside > 0) {
          evidence.outside_cohort_hits = counts.outside;
        }
        const stray = counts.outside > 0
          ? ` a further ${
            formatHumanNumber(counts.outside)
          } landed outside the compared cohorts;`
          : "";
        findings.push({
          subject: `${only.label} · ${key}`,
          summary: shape === "refusal"
            ? "One attributed driver cohort repeatedly met this refusal while its peers did not."
            : "One attributed driver cohort repeatedly missed this documentation target while its peers did not.",
          observed: `${
            shape === "refusal"
              ? `\`${key}\` refused ${only.label} ${
                formatHumanNumber(hits)
              } times and every peer cohort 0 times;`
              : `\`${key}\` was asked for ${
                formatHumanNumber(hits)
              } times, all by ${only.label}, and missed every time;`
          }${stray} runs: ${denominatorClause(split)}.`,
          evidence,
          strength: hits * 10,
          next_step: shape === "refusal"
            ? `Check how \`${surface}\` teaches the workflow named by this refusal. If the instruction is absent or unclear, amend the authored instruction source and run \`discern refresh\`.`
            : `Check how \`${surface}\` routes agents to this topic. Add or cross-link the page if needed; the \`discern-document-subsystem\` skill fits this work.`,
        });
      }
    };
    // Each shape inherits its base detector's bar: three same-slug refusals
    // (refusal-loop), two same-target misses (docs-gap).
    differentials(refusals, 3, "refusal");
    differentials(misses, 2, "miss");
    findings.sort((a, b) => b.strength - a.strength);
    return { considered, findings: findings.slice(0, 3) };
  },
};

const GATE_DOMINANCE_MIN_RUNS = 5;
const GATE_DOMINANCE_SHARE = 0.5;
const SLOT_CONTENTION_RECENT_RUNS = 20;
const SLOT_CONTENTION_MIN_RUNS = 6;
const SLOT_CONTENTION_WAIT_FLOOR_MS = 30_000;
const SLOT_CONTENTION_WAIT_SHARE = 0.25;

interface SlotContentionEvidence {
  runs: number;
  medianWaitS: number;
  medianExecutionS: number;
  waitSharePct: number;
}

/** Material queue pressure from recent capped runs. The standalone detector
 * and dominant-stage advice consume one calculation. */
function slotContentionEvidence(
  events: readonly VerbEvent[],
): SlotContentionEvidence | undefined {
  const recent = events.filter((event) => event.waited_ms !== undefined)
    .slice(-SLOT_CONTENTION_RECENT_RUNS);
  if (recent.length < SLOT_CONTENTION_MIN_RUNS) {
    return undefined;
  }
  const medianWaitMs = median(recent.map((event) => event.waited_ms ?? 0));
  const medianExecutionMs = median(recent.map(executionDurationMs));
  if (
    medianExecutionMs <= 0 ||
    medianWaitMs < SLOT_CONTENTION_WAIT_FLOOR_MS ||
    medianWaitMs < medianExecutionMs * SLOT_CONTENTION_WAIT_SHARE
  ) {
    return undefined;
  }
  return {
    runs: recent.length,
    medianWaitS: round1(medianWaitMs / 1000),
    medianExecutionS: round1(medianExecutionMs / 1000),
    waitSharePct: Math.round((medianWaitMs / medianExecutionMs) * 100),
  };
}

const dominantStage: Detector = {
  id: "dominant-stage",
  title: "One job dominating Gate time",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  windowed: true,
  // 5 timed gate runs on the current setup before calling a job dominant.
  threshold: GATE_DOMINANCE_MIN_RUNS,
  next_step:
    "Treat share as a statistic. Change the setup only when the finding names recorded avoidable cost such as a scope mismatch, unchanged reruns, or queue contention.",
  detect(facts): DetectorOutcome {
    const { series, excluded } = comparableFactsSeries(
      facts.verbs.filter((e) =>
        e.verb === "done" &&
        (e.steps ?? []).some((s) => s.duration_s !== undefined)
      ),
      facts,
    );
    // "Considered" counts every examined run, comparable or not, so a series
    // outnumbered by other setups reports the attribution instead of going quiet.
    const considered = series.length + (excluded?.runs ?? 0);
    if (series.length < GATE_DOMINANCE_MIN_RUNS) {
      return {
        considered,
        findings: excluded !== undefined &&
            considered >= GATE_DOMINANCE_MIN_RUNS
          ? [attributionFinding(series, excluded)]
          : [],
      };
    }
    const totals = new Map<string, number>();
    let all = 0;
    for (const e of series) {
      for (const s of e.steps ?? []) {
        const d = s.duration_s ?? 0;
        totals.set(s.label, (totals.get(s.label) ?? 0) + d);
        all += d;
      }
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const findings: DetectorFinding[] = [];
    if (top !== undefined && all > 0) {
      const [label, seconds] = top;
      const share = seconds / all;
      const meanS = seconds / series.length;
      if (share >= GATE_DOMINANCE_SHARE) {
        // Generated jobs yield to the restructure-only detector so the generic
        // cache/scope remedy cannot weaken their always-run contract.
        if (label.startsWith("generated:")) {
          return { considered, findings: [] };
        }
        const scope = label.startsWith("scope:") ? label.slice(6) : undefined;
        const scopeMismatchRuns = scope === undefined
          ? 0
          : series.filter((event) =>
            event.scopes !== undefined && !event.scopes.includes(scope) &&
            (event.steps ?? []).some((step) =>
              step.label === label && step.disposition === "run"
            )
          ).length;
        const unchangedReruns = unchangedValidationReruns(series);
        const contention = slotContentionEvidence(series);
        if (
          scopeMismatchRuns === 0 && unchangedReruns === 0 &&
          contention === undefined
        ) {
          return { considered, findings: [] };
        }
        const evidence = {
          mean_seconds: round1(meanS),
          share_pct: Math.round(share * 100),
          runs: series.length,
          scope_mismatch_runs: scopeMismatchRuns,
          unchanged_reruns: unchangedReruns,
          queue_contention_runs: contention?.runs ?? 0,
          ...(contention === undefined ? {} : {
            median_queue_wait_seconds: contention.medianWaitS,
            queue_wait_to_execution_pct: contention.waitSharePct,
          }),
        };
        const avoidableObservation = scopeMismatchRuns > 0
          ? `${formatHumanNumber(scopeMismatchRuns)} of ${
            formatHumanNumber(series.length)
          } comparable Gates ran outside the job's named scope.`
          : contention !== undefined
          ? `${formatHumanNumber(contention.runs)} recent capped runs had a ${
            formatHumanNumber(contention.medianWaitS)
          }s median queue wait.`
          : `${formatHumanNumber(unchangedReruns)} of ${
            formatHumanNumber(series.length)
          } comparable Gates repeated one complete validation state.`;
        const nextStep = scopeMismatchRuns > 0
          ? `\`${label}\` ran outside its named scope on ${
            formatHumanNumber(scopeMismatchRuns)
          } recorded Gates. Correct the scope mapping so unrelated changes skip it; the percentage alone is not the reason.`
          : contention !== undefined
          ? "Recorded queue contention is the avoidable delay. Review `[gate].concurrent_test_runs` against machine capacity before changing the job itself."
          : `\`${label}\` repeated on an unchanged recorded validation state ${
            formatHumanNumber(unchangedReruns)
          } times. Investigate a project-local cache or a narrower scope while preserving the job's coverage.`;
        findings.push({
          subject: label,
          summary: "One job used most Gate time with avoidable-cost evidence.",
          observed: `\`${label}\` averages ${
            formatHumanNumber(round1(meanS))
          }s per \`done\` — ${
            formatHumanNumber(Math.round(share * 100))
          }% of all recorded Gate time across ${
            formatHumanNumber(series.length)
          } of ${
            formatHumanNumber(considered)
          } considered runs. ${avoidableObservation}${
            excludedSetupSentence(excluded)
          }`,
          evidence,
          basis: decisionEvidenceBasis("dominant-stage-cost", evidence, {
            comparable: series.length,
            denominator: considered,
            unit: "Gate runs",
            events: series,
            facts,
            excludedEvents: excluded?.runs ?? 0,
            limitations: [
              "Gate-time share is descriptive; the recommendation depends only on the separately recorded avoidable-cost fields.",
            ],
          }),
          strength: Math.round(share * 100),
          next_step: nextStep,
        });
      }
    }
    return { considered, findings };
  },
};

/**
 * Watch the always-run generated family as one gate cost. Five comparable
 * timed `done` runs establish the current-setup window; a 50% share remains a
 * statistic. Advice requires repeated execution on the same complete recorded
 * validation state, rather than a repository-derived duration floor.
 *
 * `dominantStage` yields generated labels here so its generic cache/scope
 * remedy cannot contradict the always-run generator contract.
 */
const generatorGateShare: Detector = {
  id: "generator-gate-share",
  title: "Generator share of Gate time",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  windowed: true,
  threshold: GATE_DOMINANCE_MIN_RUNS,
  next_step:
    "Restructure the heaviest generated group: split it, speed up its command, or narrow what it derives so regeneration takes less time on every full Gate.",
  detect(facts): DetectorOutcome {
    const { series, excluded } = comparableFactsSeries(
      facts.verbs.filter((e) =>
        e.verb === "done" &&
        (e.steps ?? []).some((s) => s.duration_s !== undefined)
      ),
      facts,
    );
    const considered = series.length + (excluded?.runs ?? 0);
    if (series.length < GATE_DOMINANCE_MIN_RUNS) {
      return {
        considered,
        findings: excluded !== undefined &&
            considered >= GATE_DOMINANCE_MIN_RUNS
          ? [attributionFinding(series, excluded)]
          : [],
      };
    }

    const generatedTotals = new Map<string, number>();
    let generatedSeconds = 0;
    let gateSeconds = 0;
    for (const event of series) {
      for (const step of event.steps ?? []) {
        const seconds = step.duration_s ?? 0;
        gateSeconds += seconds;
        if (step.label.startsWith("generated:")) {
          generatedTotals.set(
            step.label,
            (generatedTotals.get(step.label) ?? 0) + seconds,
          );
          generatedSeconds += seconds;
        }
      }
    }

    if (gateSeconds <= 0) {
      return { considered, findings: [] };
    }
    const generatedShare = generatedSeconds / gateSeconds;
    const generatedMeanS = generatedSeconds / series.length;
    const unchangedReruns = unchangedValidationReruns(series);
    if (generatedShare < GATE_DOMINANCE_SHARE || unchangedReruns === 0) {
      return { considered, findings: [] };
    }

    const generatedSharePct = Math.round(generatedShare * 100);
    const findings: DetectorFinding[] = [...generatedTotals.entries()]
      .filter(([, seconds]) => seconds > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([label, seconds]) => {
        const groupMeanS = seconds / series.length;
        const groupShare = seconds / gateSeconds;
        const groupSharePct = Math.round(groupShare * 100);
        const evidence = {
          runs: series.length,
          group_share_pct: groupSharePct,
          group_mean_seconds: round1(groupMeanS),
          generated_share_pct: generatedSharePct,
          generated_mean_seconds: round1(generatedMeanS),
          unchanged_reruns: unchangedReruns,
        };
        return {
          subject: label,
          summary:
            "Generated-artifact checks account for most Gate time and repeated on an unchanged validation state.",
          observed: `\`${label}\` averaged ${
            formatHumanNumber(round1(groupMeanS))
          }s per \`done\` and ${
            formatHumanNumber(groupSharePct)
          }% of recorded Gate time across ${
            formatHumanNumber(series.length)
          } runs, while all generated groups averaged ${
            formatHumanNumber(round1(generatedMeanS))
          }s and accounted for ${formatHumanNumber(generatedSharePct)}%; ${
            formatHumanNumber(unchangedReruns)
          } of ${
            formatHumanNumber(series.length)
          } comparable Gates repeated one complete validation state.${
            excludedSetupSentence(excluded)
          }`,
          evidence,
          basis: decisionEvidenceBasis("generator-gate-cost", evidence, {
            comparable: series.length,
            denominator: considered,
            unit: "Gate runs",
            events: series,
            facts,
            excludedEvents: excluded?.runs ?? 0,
            limitations: [
              "Generator share is descriptive; advice is supported by repeated execution on an unchanged complete validation state.",
            ],
          }),
          strength: Math.max(1, Math.round(groupShare * 100)),
        };
      });
    return { considered, findings };
  },
};

/**
 * Read recurring slot pressure, not one unlucky hand-off: six capped runs make
 * the median representative of several waits, and the latest 20 keep the
 * reading about the current fleet. A 30-second absolute floor ignores ordinary
 * scheduler jitter; requiring wait to reach 25% of median execution also keeps
 * a long suite with negligible slot delay quiet.
 */
const slotContention: Detector = {
  id: "slot-contention",
  title: "Test-run slot contention",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  threshold: SLOT_CONTENTION_MIN_RUNS,
  next_step:
    "Review `[gate].concurrent_test_runs` against the machine and active fleet. A machine with spare capacity can take a higher cap; a saturated machine needs fewer simultaneous agents.",
  detect(facts): DetectorOutcome {
    const capped = facts.verbs.filter((event) => event.waited_ms !== undefined);
    const recent = capped.slice(-SLOT_CONTENTION_RECENT_RUNS);
    const considered = recent.length;
    const contention = slotContentionEvidence(recent);
    if (contention === undefined) {
      return { considered, findings: [] };
    }
    const {
      medianWaitS,
      medianExecutionS,
      waitSharePct,
    } = contention;
    const evidence = {
      capped_runs: considered,
      median_wait_seconds: medianWaitS,
      median_execution_seconds: medianExecutionS,
      wait_to_execution_pct: waitSharePct,
    };
    return {
      considered,
      findings: [{
        summary:
          "Recent validation runs spent material time waiting for a test-run slot.",
        observed: `recent capped runs waited a median ${
          formatHumanNumber(medianWaitS)
        }s for a test-run slot alongside ${
          formatHumanNumber(medianExecutionS)
        }s median execution across ${formatHumanNumber(considered)} runs (${
          formatHumanNumber(waitSharePct)
        }%).`,
        evidence,
        basis: decisionEvidenceBasis("validation-queue-contention", evidence, {
          comparable: recent.length,
          denominator: recent.length,
          unit: "capped validation runs",
          events: recent,
          facts,
          limitations: [
            "Queue wait is observed locally; synthesis requires the related finding to share one recorded setup.",
          ],
        }),
        strength: Math.max(1, waitSharePct),
      }],
    };
  },
};

const MASKED_FAILURES_MIN_PAIRS = 6;
const MASKED_FAILURES_MIN_INSTANCES = 3;
const MASKED_FAILURES_PAIR_GAP_MS = 6 * 3_600_000;

/** Step labels carrying `outcome` among steps the plan scheduled to run — a
 * `disposition: "skip"` step (an unchanged scope's gate, a replayed or
 * deferred standard) was never information the run withheld. */
function scheduledStepLabels(e: VerbEvent, outcome: string): Set<string> {
  return new Set(
    (e.steps ?? [])
      .filter((s) => s.disposition === "run" && s.outcome === outcome)
      .map((s) => s.label),
  );
}

/** Members of `a` also present in `b`, in `a`'s order. */
function intersection(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x));
}

/** One comparable adjacent-red relationship in the fail-fast ledger. */
interface FailFastRelationship {
  first: VerbEvent;
  later: VerbEvent;
  cancelled: string[];
  neverStarted: string[];
}

/** Completed durations for one job under the first run's recorded setup. */
function comparableCompletedDurations(
  job: string,
  anchor: VerbEvent,
  facts: StreamFacts,
): readonly CompletedJobSample[] {
  return facts.analysis.completedJobs.get(job)?.get(
    facts.analysis.setupKeyOf(anchor),
  ) ?? [];
}

/**
 * Read the two sides of the fail-fast tradeoff without assigning cause. A
 * relationship is two adjacent red `done` runs in one conversation: the
 * first run's failures are absent from the later run, while a job earlier
 * cancelled or never started later reports a distinct failure. The later
 * failure may have existed already or may have been introduced between runs;
 * the finding says so. Tail work is estimated only for cancelled jobs, from
 * at least three completed durations of that job under the same setup.
 */
const maskedFailures: Detector = {
  id: "masked-failures",
  title: "Fail-fast tradeoff ledger",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  threshold: MASKED_FAILURES_MIN_PAIRS,
  next_step:
    "Compare the recorded later-round cost with the explicitly estimated saved tail. Keep the setting when savings dominate; otherwise run a controlled project-local experiment before changing it.",
  detect(facts): DetectorOutcome {
    const dones = facts.verbs.filter((e) =>
      e.verb === "done" && (e.steps?.length ?? 0) > 0
    );
    let considered = 0;
    let comparablePairs = 0;
    let excludedSetupPairs = 0;
    const relationships: FailFastRelationship[] = [];
    for (const events of byBranch(dones).values()) {
      for (const session of bySession(events)) {
        for (let i = 0; i + 1 < session.length; i++) {
          const n = session[i];
          const next = session[i + 1];
          if (n === undefined || next === undefined) continue;
          if (n.outcome !== "failed") continue;
          const gapMs = Date.parse(next.at) - Date.parse(n.at);
          if (
            !Number.isFinite(gapMs) || gapMs < 0 ||
            gapMs > MASKED_FAILURES_PAIR_GAP_MS
          ) {
            continue;
          }
          considered += 1;
          if (
            n.epoch === null || next.epoch === null ||
            n.writer === undefined || next.writer === undefined ||
            !sameComparableSetup(n, next, facts)
          ) {
            excludedSetupPairs += 1;
            continue;
          }
          comparablePairs += 1;
          const failedNext = scheduledStepLabels(next, "failed");
          if (failedNext.size === 0) {
            continue;
          }
          const failedN = scheduledStepLabels(n, "failed");
          if (intersection(failedN, failedNext).length > 0) {
            continue;
          }
          const masked = intersection(
            scheduledStepLabels(n, "cancelled"),
            failedNext,
          );
          const deferred = intersection(
            scheduledStepLabels(n, "skipped"),
            failedNext,
          );
          if (masked.length === 0 && deferred.length === 0) {
            continue;
          }
          relationships.push({
            first: n,
            later: next,
            cancelled: masked,
            neverStarted: deferred,
          });
        }
      }
    }
    const instances = relationships.length;
    if (instances < MASKED_FAILURES_MIN_INSTANCES) {
      return { considered, findings: [] };
    }
    const cancelledJobs = relationships.reduce(
      (sum, relationship) => sum + relationship.cancelled.length,
      0,
    );
    const neverStartedJobs = relationships.reduce(
      (sum, relationship) => sum + relationship.neverStarted.length,
      0,
    );
    const laterDistinctFailures = cancelledJobs + neverStartedJobs;
    const laterRoundElapsedS = round1(
      relationships.reduce(
        (sum, relationship) => sum + relationship.later.duration_ms / 1000,
        0,
      ),
    );
    let estimatedSavedTailS = 0;
    let conservativeSavedTailS = 0;
    let unestimatedTailJobs = 0;
    const samples = new Set<string>();
    for (const relationship of relationships) {
      for (const label of relationship.cancelled) {
        const completed = comparableCompletedDurations(
          label,
          relationship.first,
          facts,
        );
        for (const sample of completed) {
          samples.add(`${sample.event.at}\0${label}`);
        }
        if (completed.length < 3) {
          unestimatedTailJobs += 1;
          continue;
        }
        const partial = (relationship.first.steps ?? []).find((step) =>
          step.label === label && step.outcome === "cancelled"
        )?.duration_s ?? 0;
        const durations = completed.map((sample) =>
          sample.seconds
        );
        estimatedSavedTailS += Math.max(0, median(durations) - partial);
        conservativeSavedTailS += Math.max(
          0,
          Math.max(...durations) - partial,
        );
      }
    }
    estimatedSavedTailS = round1(estimatedSavedTailS);
    conservativeSavedTailS = round1(conservativeSavedTailS);
    const recommendationSupported = cancelledJobs > 0 &&
      unestimatedTailJobs === 0 && conservativeSavedTailS > 0 &&
      laterRoundElapsedS > conservativeSavedTailS * 1.5;
    const savingsFavoured = unestimatedTailJobs === 0 &&
      estimatedSavedTailS > laterRoundElapsedS * 1.5;
    const evidence = {
      cancelled_jobs: cancelledJobs,
      never_started_jobs: neverStartedJobs,
      later_distinct_failures: laterDistinctFailures,
      additional_gate_rounds: instances,
      later_round_elapsed_seconds: laterRoundElapsedS,
      estimated_saved_tail_seconds: estimatedSavedTailS,
      conservative_saved_tail_seconds: conservativeSavedTailS,
      tail_duration_samples: samples.size,
      unestimated_tail_jobs: unestimatedTailJobs,
      branches:
        new Set(relationships.map((relationship) => relationship.first.branch))
          .size,
      recommendation_supported: recommendationSupported ? 1 : 0,
    };
    const nextStep = recommendationSupported
      ? "This project's conservative rule was crossed: recorded later-round time exceeded 1.5× the maximum-duration saved-tail estimate, with at least 3 comparable samples per cancelled job. Run a controlled `[gate].fail_fast = false` trial and compare the same ledger before adopting the change."
      : savingsFavoured
      ? "The median-duration estimate of saved tail exceeds recorded later-round cost by more than 1.5×. Keep fail-fast for now; no configuration change is supported by this history."
      : "The tradeoff is unresolved or undersampled. Run a controlled project-local experiment with fail-fast on and off, then compare recorded later-round time and the same saved-tail estimator; do not change the default from this evidence yet.";
    const relationshipEvents = relationships.flatMap((relationship) => [
      relationship.first,
      relationship.later,
    ]);
    return {
      considered,
      findings: [{
        summary:
          "Fail-fast avoided estimated tail time while later Gate rounds exposed other failures.",
        tone: recommendationSupported
          ? "attention"
          : savingsFavoured
          ? "good"
          : "neutral",
        observed: `${
          formatHumanNumber(instances)
        } qualifying relationships among ${
          formatHumanNumber(comparablePairs)
        } comparable of ${
          formatHumanNumber(considered)
        } adjacent red Gate pairs recorded ${
          formatHumanNumber(cancelledJobs)
        } cancelled jobs, ${
          formatHumanNumber(neverStartedJobs)
        } jobs not started, and ${
          formatHumanNumber(laterDistinctFailures)
        } distinct failures in later rounds; those later rounds recorded ${
          formatHumanNumber(laterRoundElapsedS)
        }s elapsed, while ${
          formatHumanNumber(samples.size)
        } comparable completed-job samples estimate ${
          formatHumanNumber(estimatedSavedTailS)
        }s of cancelled tail avoided. The sequence does not establish when or why a later failure arose.`,
        evidence,
        basis: decisionEvidenceBasis("fail-fast-ledger", evidence, {
          comparable: comparablePairs,
          denominator: considered,
          unit: "adjacent red Gate pairs",
          events: relationshipEvents,
          facts,
          estimated: new Set([
            "estimated_saved_tail_seconds",
            "conservative_saved_tail_seconds",
          ]),
          excludedEvents: excludedSetupPairs,
          limitations: [
            "A later distinct failure may have existed during the earlier run or may have been introduced between runs; the sequence does not establish cause.",
            "Saved tail uses the median of at least 3 completed durations for the same job and setup, less any recorded partial cancelled duration.",
            "The conservative decision rule uses the maximum comparable completed duration for each cancelled job and requires later-round time to exceed that estimate by 1.5 times.",
            ...(neverStartedJobs > 0
              ? [
                "Jobs that never started are observed separately and do not enter the cancelled-tail estimate.",
              ]
              : []),
          ],
        }),
        strength: instances,
        next_step: nextStep,
      }],
    };
  },
};

const durationCreep: Detector = {
  id: "duration-creep",
  title: "Gate duration creeping up",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  windowed: true,
  // 8 runs on one setup: two halves of 4 are the fewest medians worth comparing.
  threshold: 8,
  next_step:
    "Inspect the later comparable runs for changes in test count, build-cache behavior, or widened inputs. Treat each as a hypothesis until recorded job evidence confirms it.",
  detect(facts): DetectorOutcome {
    // Only green runs measure the gate's length: a red run's duration measures
    // where it failed (a fail-fast check dies in seconds, a test failure in
    // minutes), so mixing outcomes reads a red/green mix shift as creep.
    const { series, excluded } = comparableFactsSeries(
      facts.verbs.filter((e) => e.verb === "done" && e.outcome === "ok"),
      facts,
    );
    const considered = series.length + (excluded?.runs ?? 0);
    if (series.length < 8) {
      return {
        considered,
        findings: excluded !== undefined && considered >= 8
          ? [attributionFinding(series, excluded)]
          : [],
      };
    }
    const half = Math.floor(series.length / 2);
    const earlier = series.slice(0, half);
    const later = series.slice(series.length - half);
    // Creep asks whether gate execution got slower. End-to-end wall time would
    // turn a busier fleet into an apparent suite regression.
    const durEarly = median(earlier.map(executionDurationMs)) / 1000;
    const durLate = median(later.map(executionDurationMs)) / 1000;
    const sizeEarly = median(earlier.map((e) => e.change?.files ?? 0));
    const sizeLate = median(later.map((e) => e.change?.files ?? 0));
    const findings: DetectorFinding[] = [];
    // Half again slower, and not because the changes themselves grew.
    if (
      durEarly > 0 && durLate >= durEarly * 1.5 &&
      sizeLate <= Math.max(sizeEarly, 1) * 1.25
    ) {
      findings.push({
        summary: "Green Gate runs became slower under one recorded setup.",
        observed: `median green \`done\` duration rose from ${
          formatHumanNumber(round1(durEarly))
        }s to ${formatHumanNumber(round1(durLate))}s across ${
          formatHumanNumber(series.length)
        } of ${formatHumanNumber(considered)} considered runs on one setup (${
          day(earlier[0]?.at ?? "")
        } → ${
          day(later[later.length - 1]?.at ?? "")
        }), while the median change stayed ~${
          formatHumanNumber(Math.round(sizeLate))
        } files.${excludedSetupSentence(excluded)}`,
        evidence: {
          median_early_s: round1(durEarly),
          median_late_s: round1(durLate),
          runs: series.length,
        },
        strength: Math.round((durLate / durEarly) * 10),
      });
    }
    return { considered, findings };
  },
};

const fixStageIdle: Detector = {
  id: "fix-stage-idle",
  title: "A fix stage with no visible effect",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  windowed: true,
  // 10 runs: a fixer's value shows rarely by design, so the bar to call it
  // idle is the highest in the registry.
  threshold: 10,
  next_step:
    "Verify whether the configured fix stage still provides project-local benefit. If it does not, adjust where that job runs while preserving the full Gate's coverage.",
  detect(facts): DetectorOutcome {
    const { series, excluded } = comparableFactsSeries(
      facts.verbs.filter((e) =>
        (e.verb === "done" || e.verb === "prepare") &&
        stageSeconds(e, "Fix") !== undefined
      ),
      facts,
    );
    const considered = series.length + (excluded?.runs ?? 0);
    if (series.length < 10) {
      return {
        considered,
        findings: excluded !== undefined && considered >= 10
          ? [attributionFinding(series, excluded)]
          : [],
      };
    }
    const fixLabels = new Set(
      series.flatMap((e) =>
        (e.steps ?? []).filter((s) => s.group === "Fix").map((s) => s.label)
      ),
    );
    const anyEffect = series.some((e) =>
      e.failed_stage === "fix" || e.failed_stage === "tree_drift" ||
      (e.diagnostics ?? []).some((d) => fixLabels.has(d.tool)) ||
      (e.steps ?? []).some((s) =>
        s.group === "Fix" && (s.error_like_lines ?? 0) > 0
      )
    );
    const meanS =
      series.reduce((sum, e) => sum + (stageSeconds(e, "Fix") ?? 0), 0) /
      series.length;
    const findings: DetectorFinding[] = [];
    if (!anyEffect && meanS >= 3) {
      findings.push({
        summary:
          "The recorded fix stage consumed time without a visible recorded effect.",
        observed: `the fix stage (${[...fixLabels].sort().join(", ")}) cost ~${
          formatHumanNumber(round1(meanS))
        }s per run across ${formatHumanNumber(series.length)} of ${
          formatHumanNumber(considered)
        } considered runs with no visible effect: no fix failures, no tree drift, and no diagnostics.${
          excludedSetupSentence(excluded)
        }`,
        evidence: { mean_seconds: round1(meanS), runs: series.length },
        strength: Math.round(meanS),
      });
    }
    return { considered, findings };
  },
};

const recurringDiagnostic: Detector = {
  id: "recurring-diagnostic",
  title: "One diagnostic class across branches",
  family: "gate-fit",
  scope: "project",
  tier: "inline",
  tone: "attention",
  // 5 red events carrying diagnostics before reading cross-branch classes.
  threshold: 5,
  next_step:
    "A rule that trips every effort is a project-level gap, and a guard beats a memory: teach it in instructions (`discern-teach-the-project`), or change the config so the class can't recur — the `discern-cure-a-bug` skill walks that conversion.",
  detect(facts): DetectorOutcome {
    const reds = facts.agentish.filter((e) =>
      e.outcome === "failed" && (e.diagnostics ?? []).length > 0
    );
    const classes = new Map<string, { branches: Set<string>; count: number }>();
    for (const e of reds) {
      for (const d of e.diagnostics ?? []) {
        const key = d.rule !== undefined ? `${d.tool} ${d.rule}` : d.tool;
        const entry = classes.get(key) ?? { branches: new Set(), count: 0 };
        entry.branches.add(e.branch ?? "?");
        entry.count += d.count ?? 1;
        classes.set(key, entry);
      }
    }
    const findings: DetectorFinding[] = [...classes.entries()]
      .filter(([, c]) => c.branches.size >= 3)
      .sort((a, b) => b[1].branches.size - a[1].branches.size)
      .slice(0, 3)
      .map(([key, c]) => ({
        subject: key,
        summary: "The same diagnostic class failed across several branches.",
        observed: `\`${key}\` failed on ${
          formatHumanNumber(c.branches.size)
        } different branches (${
          formatHumanNumber(c.count)
        } diagnostics in all).`,
        evidence: { branches: c.branches.size, diagnostics: c.count },
        strength: c.branches.size * 5,
      }));
    return { considered: reds.length, findings };
  },
};

interface ValidationVerdictCounts {
  red: number;
  green: number;
  excluded: number;
  denominator: number;
  comparable: number;
}

/** Exact per-job counts; absence, cancellation, and skips stay in the
 * denominator but never become either verdict. */
function validationVerdictCounts(
  observations: readonly { verdict: "red" | "green" | "excluded" }[],
): ValidationVerdictCounts {
  const red =
    observations.filter((observation) => observation.verdict === "red").length;
  const green =
    observations.filter((observation) => observation.verdict === "green")
      .length;
  const excluded = observations.length - red - green;
  return {
    red,
    green,
    excluded,
    denominator: observations.length,
    comparable: red + green,
  };
}

/** Distinct recorded events represented by a per-job observation group. */
function distinctValidationEvents(
  observations: readonly { event: VerbEvent }[],
): number {
  return new Set(observations.map((observation) => observation.event)).size;
}

/** Complete common basis for one strict validation finding. */
function strictValidationBasis(
  group: ValidationRepeatGroup,
  counts: ValidationVerdictCounts,
  evidence: Record<string, number>,
): PatternEvidenceBasis {
  const current = group.basisKind === "complete-validation-state";
  const limitations = current
    ? [
      "Recorded repository and execution conditions matched; unrecorded external context remains outside the comparison.",
    ]
    : group.basisKind === "legacy-clean-start"
    ? [
      "Legacy evidence records one clean start at a HEAD, but not job definitions or a complete execution envelope.",
      "Unrecorded external context and ignored inputs remain outside the comparison.",
    ]
    : [
      "Legacy dirty evidence matches only the tracked start fingerprint; index/worktree form and untracked or mixed inputs were not distinguished.",
      "Job definitions, a complete execution envelope, and external context were not recorded.",
    ];
  return {
    kind: group.basisKind,
    coverage: {
      comparable: counts.comparable,
      denominator: counts.denominator,
      unit: "job-runs",
    },
    validation_state: {
      version: group.stateVersion,
      complete: current,
    },
    matched_conditions: group.matchedConditions,
    differing_conditions: [],
    legacy_events: current ? 0 : distinctValidationEvents(group.observations),
    excluded_events: distinctValidationEvents(
      group.observations.filter((observation) =>
        observation.verdict === "excluded"
      ),
    ),
    limitations,
    values: observedEvidenceValues(evidence),
  };
}

/** The deliberately weaker sentence attached to one legacy basis. */
function legacyValidationObservation(
  group: Exclude<
    ValidationRepeatGroup,
    { basisKind: "complete-validation-state" }
  >,
  counts: ValidationVerdictCounts,
): string {
  const state = group.basisKind === "legacy-clean-start"
    ? `a recorded clean start at \`${group.head}\``
    : `one tracked start fingerprint at \`${group.head}\``;
  return `\`${group.jobId}\` recorded ${
    formatHumanNumber(counts.red)
  } red and ${formatHumanNumber(counts.green)} green across ${
    formatHumanNumber(counts.comparable)
  } of ${
    formatHumanNumber(counts.denominator)
  } job runs sharing ${state}; legacy evidence did not record the job definition or complete execution conditions.`;
}

const sameEnvelopeRelationship = VALIDATION_FINDING_RELATIONSHIPS[0];

const sameTreeFlake: Detector = {
  id: sameEnvelopeRelationship.detectorId,
  title: "Divergent outcomes under matched recorded conditions",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  validationRelationship: sameEnvelopeRelationship.kind,
  // 2 eligible observations in a repeated per-job comparison group are the
  // smallest population capable of carrying both verdicts.
  threshold: 2,
  next_step:
    "A validation job changed verdict under matching recorded conditions. Reproduce the job and use the `discern-cure-a-bug` diagnosis procedure; check unrecorded environment and service inputs before naming a cause.",
  detect(facts): DetectorOutcome {
    const groups = sameEnvelopeValidationGroups(facts.verbs);
    const findings: DetectorFinding[] = [];
    for (const group of groups) {
      const counts = validationVerdictCounts(group.observations);
      if (counts.red === 0 || counts.green === 0) continue;
      const evidence = {
        runs: counts.comparable,
        denominator: counts.denominator,
        red: counts.red,
        green: counts.green,
        excluded_outcomes: counts.excluded,
      };
      const observed = group.basisKind === "complete-validation-state"
        ? `\`${group.jobId}\` recorded ${
          formatHumanNumber(counts.red)
        } red and ${formatHumanNumber(counts.green)} green across ${
          formatHumanNumber(counts.comparable)
        } of ${
          formatHumanNumber(counts.denominator)
        } job runs under one complete v${
          formatHumanNumber(group.stateVersion)
        } validation state and matching recorded execution conditions; external context was not recorded.`
        : legacyValidationObservation(group, counts);
      findings.push({
        subject: group.jobId,
        summary: group.basisKind === "complete-validation-state"
          ? "This validation job changed verdict under matching recorded conditions."
          : "This validation job changed verdict under limited legacy conditions.",
        observed,
        evidence,
        basis: strictValidationBasis(group, counts, evidence),
        strength: counts.comparable * 10,
      });
    }
    findings.sort((a, b) =>
      b.strength - a.strength ||
      (a.subject ?? "").localeCompare(b.subject ?? "")
    );
    return {
      considered: groups.reduce(
        (sum, group) => sum + group.observations.length,
        0,
      ),
      findings: findings.slice(0, 3),
    };
  },
};

type ContextVerdict = "red" | "green" | "mixed" | "excluded";

/** One controlled context must be internally stable before it can support a
 * cross-context relationship. Mixed contexts belong to the strict detector. */
function validationContextVerdict(
  context: ValidationContextBucket,
): ContextVerdict {
  const counts = validationVerdictCounts(context.observations);
  if (counts.red > 0 && counts.green > 0) return "mixed";
  if (counts.red > 0) return "red";
  if (counts.green > 0) return "green";
  return "excluded";
}

/** Compact count suffixes remain compatible while naming controlled modes. */
function validationModeEvidence(
  observations: readonly { event: VerbEvent; verdict: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const observation of observations) {
    if (observation.verdict !== "red" && observation.verdict !== "green") {
      continue;
    }
    const mode = observation.event.validation?.execution.mode;
    const key = mode === "full-gate"
      ? "full_gate_runs"
      : mode === "standalone-test"
      ? "standalone_test_runs"
      : undefined;
    if (key !== undefined) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const crossContextRelationship = VALIDATION_FINDING_RELATIONSHIPS[1];
/** Human context clauses are a sample; the evidence map and basis retain the
 * full context count and bounded condition cardinalities. */
const VALIDATION_CONTEXT_SUMMARY_MAX = 4;

const executionContextDivergence: Detector = {
  id: crossContextRelationship.detectorId,
  title: "Divergent outcomes between recorded execution contexts",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  validationRelationship: crossContextRelationship.kind,
  // Two per-job observations across distinct controlled contexts are the
  // smallest cross-context population.
  threshold: 2,
  next_step:
    "Compare the named execution contexts in a controlled reproduction. Resource contention, ordering, and environment sensitivity are investigation paths, not established causes.",
  detect(facts): DetectorOutcome {
    const groups = crossContextValidationGroups(facts.verbs);
    const findings: DetectorFinding[] = [];
    for (const group of groups) {
      const classified = group.contexts.map((context) => ({
        context,
        verdict: validationContextVerdict(context),
      }));
      if (classified.some(({ verdict }) => verdict === "mixed")) {
        continue;
      }
      const redContexts = classified.filter(({ verdict }) => verdict === "red");
      const greenContexts = classified.filter(({ verdict }) =>
        verdict === "green"
      );
      if (redContexts.length === 0 || greenContexts.length === 0) continue;
      const counts = validationVerdictCounts(group.observations);
      const evidence = {
        runs: counts.comparable,
        denominator: counts.denominator,
        red: counts.red,
        green: counts.green,
        contexts: redContexts.length + greenContexts.length,
        ...validationModeEvidence(group.observations),
        excluded_outcomes: counts.excluded,
      };
      const clauses = [...redContexts, ...greenContexts].map(
        ({ context, verdict }) => {
          const contextCounts = validationVerdictCounts(context.observations);
          const count = verdict === "red"
            ? contextCounts.red
            : contextCounts.green;
          const [mode, ...detail] = validationContextLabel(context).split(
            ", ",
          );
          return `${mode ?? "recorded context"} ${
            formatHumanNumber(count)
          } ${verdict}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
        },
      );
      const displayedClauses = clauses.slice(0, VALIDATION_CONTEXT_SUMMARY_MAX);
      const omittedClauses = clauses.length - displayedClauses.length;
      const contextSummary = [
        ...displayedClauses,
        ...(omittedClauses > 0
          ? [
            `${
              formatHumanNumber(omittedClauses)
            } additional contexts omitted from this summary`,
          ]
          : []),
      ].join("; ");
      const basis: PatternEvidenceBasis = {
        kind: group.basisKind,
        coverage: {
          comparable: counts.comparable,
          denominator: counts.denominator,
          unit: "job-runs",
        },
        validation_state: { version: group.stateVersion, complete: true },
        matched_conditions: group.matchedConditions,
        differing_conditions: group.differingConditions,
        legacy_events: 0,
        excluded_events: distinctValidationEvents(
          group.observations.filter((observation) =>
            observation.verdict === "excluded"
          ),
        ),
        limitations: [
          "The contexts differ only in the named recorded conditions; resource contention, ordering, environment sensitivity, and other external context remain possible investigation paths, not established causes.",
        ],
        values: observedEvidenceValues(evidence),
      };
      findings.push({
        subject: group.jobId,
        summary:
          "This validation job changed verdict between recorded execution contexts.",
        observed:
          `\`${group.jobId}\` differed between recorded contexts: ${contextSummary} across ${
            formatHumanNumber(counts.comparable)
          } of ${
            formatHumanNumber(counts.denominator)
          } job runs on one complete validation state.`,
        evidence,
        basis,
        strength: counts.comparable * 10,
      });
    }
    findings.sort((a, b) =>
      b.strength - a.strength ||
      (a.subject ?? "").localeCompare(b.subject ?? "")
    );
    return {
      considered: groups.reduce(
        (sum, group) => sum + group.observations.length,
        0,
      ),
      findings: findings.slice(0, 3),
    };
  },
};

const loopsToGreen: Detector = {
  id: "loops-to-green",
  title: "Red runs before first green",
  family: "funnel",
  scope: "branch",
  tier: "batch",
  tone: "attention",
  // 2 branches that reached green — one branch has nothing to stand out from.
  threshold: 2,
  next_step:
    "Start with the first repeated diagnostic and use the `discern-cure-a-bug` diagnose procedure to test one cause at a time before another full Gate.",
  detect(facts): DetectorOutcome {
    const loop = facts.agentish.filter((e) =>
      e.verb === "done" || e.verb === "prepare" || e.verb === "test"
    );
    let greenBranches = 0;
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(loop)) {
      if (branch === facts.trunk) {
        continue;
      }
      const firstGreen = events.findIndex((e) =>
        e.verb === "done" && e.outcome === "ok"
      );
      if (firstGreen === -1) {
        continue;
      }
      greenBranches += 1;
      const before = events.slice(0, firstGreen);
      const reds = before.filter((e) => e.outcome === "failed").length;
      const files = events[firstGreen]?.change?.files ?? 0;
      // 6 red runs before green: below that is ordinary iteration.
      if (reds >= 6) {
        const perFile = files > 0 ? round1(reds / files) : reds;
        findings.push({
          subject: branch,
          summary: `This branch had ${
            formatHumanNumber(reds)
          } red runs before its first green Gate.`,
          observed: `\`${branch}\` took ${
            formatHumanNumber(reds)
          } red runs to reach its first green \`done\`, on a ${
            formatHumanNumber(files)
          }-file change (${formatHumanNumber(perFile)} per file).`,
          evidence: { red_runs: reds, files, per_file: perFile },
          strength: reds,
        });
      }
    }
    return { considered: greenBranches, findings };
  },
};

const cohortLoopsToGreen: Detector = {
  id: "cohort-loops-to-green",
  title: "Red runs before first green, by driver cohort",
  family: "funnel",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  cohorts: true,
  // Cohort-counted `considered`, as for every cohort detector.
  threshold: COHORT_MINIMUMS.cohorts,
  next_step:
    "Medians sit beside their denominators for the owner to weigh — task difficulty confounds them, so no ranking is implied. To chase a high median, read that cohort's red-run diagnostic classes (`recurring-diagnostic`) before drawing conclusions about the agent.",
  detect(facts): DetectorOutcome {
    const loop = facts.agentish.filter((e) =>
      e.verb === "done" || e.verb === "prepare" || e.verb === "test"
    );
    // The unit is a branch that reached a green `done` — the population whose
    // loops-to-green stat exists — attributed whole across its loop runs.
    interface GreenBranch {
      branch: string;
      events: VerbEvent[];
      reds: number;
    }
    const units: GreenBranch[] = [];
    for (const [branch, events] of byBranch(loop)) {
      if (branch === facts.trunk) {
        continue;
      }
      const firstGreen = events.findIndex((e) =>
        e.verb === "done" && e.outcome === "ok"
      );
      if (firstGreen === -1) {
        continue;
      }
      const reds = events.slice(0, firstGreen)
        .filter((e) => e.outcome === "failed").length;
      units.push({ branch, events, reds });
    }
    const split = splitByCohort(units, (u) => u.events);
    const considered = split.speaking.length;
    if (!comparative(split)) {
      return { considered, findings: [] };
    }
    // 2 green branches per cohort on top of the seam's run minimums: the
    // median of a single branch is just that branch wearing a statistic.
    if (split.speaking.some((c) => c.units.length < 2)) {
      return { considered, findings: [] };
    }
    const evidence = cohortDenominators(split);
    const clauses = split.speaking.map((cohort) => {
      const med = round1(median(cohort.units.map((u) => u.reds)));
      evidence[`${cohort.agent}_branches`] = cohort.units.length;
      evidence[`${cohort.agent}_median_reds`] = med;
      return `${cohort.label} ${
        formatHumanNumber(cohort.units.length)
      } branches, median ${formatHumanNumber(med)} red ${
        med === 1 ? "run" : "runs"
      } before it`;
    });
    evidence.unattributed_branches = split.unattributedUnits;
    return {
      considered,
      findings: [{
        summary:
          "The report separates red-run medians before green by attributed driver cohort.",
        observed: `branches reaching a green \`done\`, by attributed driver: ${
          clauses.join("; ")
        }; ${formatHumanNumber(split.unattributedUnits)} ${
          split.unattributedUnits === 1 ? "branch" : "branches"
        } had no single attributed driver (loop runs: ${
          denominatorClause(split)
        }).`,
        evidence,
        strength: split.speaking.reduce((sum, c) => sum + c.units.length, 0),
      }],
    };
  },
};

const cycleTime: Detector = {
  id: "cycle-time",
  title: "Start-to-accept cycle time",
  family: "funnel",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // 3 completed cycles before a median means anything.
  threshold: 3,
  next_step:
    "Review the longest recorded cycle. If work scope accounts for the elapsed time, split the next brief; otherwise inspect recorded waiting and update events before changing practice.",
  detect(facts): DetectorOutcome {
    const starts = facts.verbs.filter((e) =>
      e.verb === "start" && e.outcome === "ok" && e.target !== undefined
    );
    const accepts = facts.verbs.filter((e) =>
      e.verb === "accept" && e.outcome === "ok"
    );
    const cycles: number[] = [];
    for (const start of starts) {
      const accept = accepts.find((a) =>
        a.branch === start.target && a.at > start.at
      );
      if (accept !== undefined) {
        cycles.push(
          (Date.parse(accept.at) - Date.parse(start.at)) / 3_600_000,
        );
      }
    }
    const findings: DetectorFinding[] = cycles.length >= 3
      ? [{
        summary:
          "Completed changes have a recorded start-to-accept cycle time.",
        observed: `${formatHumanNumber(cycles.length)} of ${
          formatHumanNumber(starts.length)
        } recorded starts completed a start-to-accept cycle: median ${
          formatHumanNumber(round1(median(cycles)))
        }h, longest ${formatHumanNumber(round1(Math.max(...cycles)))}h.`,
        evidence: {
          cycles: cycles.length,
          starts: starts.length,
          median_hours: round1(median(cycles)),
          longest_hours: round1(Math.max(...cycles)),
        },
        strength: cycles.length,
      }]
      : [];
    return { considered: cycles.length, findings };
  },
};

const giantCommitLanding: Detector = {
  id: "giant-commit-landing",
  title: "Single giant-commit landings",
  family: "funnel",
  scope: "branch",
  tier: "batch",
  tone: "attention",
  // 3 landing-shaped runs before judging commit hygiene.
  threshold: 3,
  next_step:
    "If the change contains independent steps, request atomic commits so review and selective reverts can address them separately.",
  detect(facts): DetectorOutcome {
    // The landing-shaped moment: a green done on a clean, committed tree.
    const landings = facts.agentish.filter((e) =>
      e.verb === "done" && e.outcome === "ok" && e.clean === true &&
      e.change !== undefined
    );
    const findings: DetectorFinding[] = [];
    const seen = new Set<string>();
    for (const e of [...landings].reverse()) {
      const change = e.change;
      if (change === undefined || e.branch === null || seen.has(e.branch)) {
        continue;
      }
      seen.add(e.branch);
      const lines = change.insertions + change.deletions;
      // One commit carrying 400+ changed lines: past what a reviewer can
      // follow as a single step.
      if (change.commits === 1 && lines >= 400) {
        findings.push({
          subject: e.branch,
          summary: "This branch reached a green Gate with one large commit.",
          observed:
            `\`${e.branch}\` reached green as a single commit carrying ${
              formatHumanNumber(lines)
            } changed lines across ${formatHumanNumber(change.files)} files; ${
              formatHumanNumber(landings.length)
            } landing-shaped runs were considered.`,
          evidence: {
            commits: 1,
            changed_lines: lines,
            files: change.files,
            landing_runs: landings.length,
          },
          strength: Math.round(lines / 100),
        });
      }
    }
    return { considered: landings.length, findings };
  },
};

const updateFriction: Detector = {
  id: "update-friction",
  title: "Update friction trending up",
  family: "funnel",
  scope: "project",
  tier: "batch",
  tone: "attention",
  windowed: true,
  // 6 updates on one setup: halves of 3 are the fewest worth comparing.
  threshold: 6,
  next_step:
    "Review the later updates. If long-lived efforts account for the larger counts, update earlier or reduce the next brief's scope; otherwise inspect the overlapping files before changing practice.",
  detect(facts): DetectorOutcome {
    const { series, excluded } = comparableFactsSeries(
      facts.verbs.filter((e) =>
        e.verb === "update" && e.update !== undefined && e.outcome === "ok"
      ),
      facts,
    );
    const considered = series.length + (excluded?.runs ?? 0);
    if (series.length < 6) {
      return {
        considered,
        findings: excluded !== undefined && considered >= 6
          ? [attributionFinding(series, excluded)]
          : [],
      };
    }
    const half = Math.floor(series.length / 2);
    const earlier = series.slice(0, half);
    const later = series.slice(series.length - half);
    const behindEarly = median(earlier.map((e) => e.update?.behind ?? 0));
    const behindLate = median(later.map((e) => e.update?.behind ?? 0));
    const overlapEarly = median(earlier.map((e) => e.update?.overlap ?? 0));
    const overlapLate = median(later.map((e) => e.update?.overlap ?? 0));
    const findings: DetectorFinding[] = [];
    // Doubled, and past noise (≥ 2 absolute).
    if (
      (behindLate >= Math.max(behindEarly, 1) * 2 && behindLate >= 2) ||
      (overlapLate >= Math.max(overlapEarly, 1) * 2 && overlapLate >= 2)
    ) {
      findings.push({
        summary:
          "Later updates brought in more trunk commits or overlapping files under one recorded setup.",
        observed: `across ${formatHumanNumber(series.length)} of ${
          formatHumanNumber(considered)
        } considered updates, the median behind-count moved ${
          formatHumanNumber(behindEarly)
        } → ${formatHumanNumber(behindLate)} and overlapping files ${
          formatHumanNumber(overlapEarly)
        } → ${formatHumanNumber(overlapLate)}.${
          excludedSetupSentence(excluded)
        }`,
        evidence: {
          updates: series.length,
          behind_early: behindEarly,
          behind_late: behindLate,
          overlap_early: overlapEarly,
          overlap_late: overlapLate,
        },
        strength: Math.round(behindLate + overlapLate),
      });
    }
    return { considered, findings };
  },
};

interface TrajectorySeriesPoint {
  at: string;
  value: number;
}

// Leaves room for the subject and summary in the conventional 80-column report;
// the wire cap remains the authority if it ever falls below this target.
const STANDARD_TRAJECTORY_SERIES_POINTS = Math.min(
  16,
  PATTERNS_SERIES_MAX_POINTS,
);

/**
 * Reduce a long trajectory to equal-duration buckets while keeping its first
 * and last recorded readings exact. The interior buckets divide the full
 * timestamp span evenly and contribute their arithmetic mean when populated.
 * A malformed or zero-duration timestamp span falls back to equal ordinal
 * slices, preserving event order and the same payload cap.
 */
function downsampleTrajectorySeries(
  readings: readonly TrajectorySeriesPoint[],
): number[] {
  if (readings.length <= STANDARD_TRAJECTORY_SERIES_POINTS) {
    return readings.map((reading) => reading.value);
  }
  const first = readings[0];
  const last = readings[readings.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }

  const bucketCount = STANDARD_TRAJECTORY_SERIES_POINTS - 2;
  const buckets = Array.from(
    { length: bucketCount },
    () => ({ sum: 0, count: 0 }),
  );
  const timestamps = readings.map((reading) => Date.parse(reading.at));
  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];
  const chronological = timestamps.every((timestamp, index) =>
    Number.isFinite(timestamp) &&
    (index === 0 || timestamp >= (timestamps[index - 1] ?? timestamp))
  );
  const timeSpan = chronological &&
      start !== undefined &&
      end !== undefined &&
      end > start
    ? { start, end }
    : undefined;

  for (let index = 1; index < readings.length - 1; index += 1) {
    const reading = readings[index];
    if (reading === undefined) {
      continue;
    }
    const fraction = timeSpan !== undefined
      ? ((timestamps[index] ?? timeSpan.start) - timeSpan.start) /
        (timeSpan.end - timeSpan.start)
      : index / (readings.length - 1);
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(fraction * bucketCount)),
    );
    const bucket = buckets[bucketIndex];
    if (bucket !== undefined) {
      bucket.sum += reading.value;
      bucket.count += 1;
    }
  }

  return [
    first.value,
    ...buckets
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => bucket.sum / bucket.count),
    last.value,
  ];
}

const standardTrajectory: Detector = {
  id: "standard-trajectory",
  title: "Each standard's value and limit over time",
  family: "trajectory",
  scope: "project",
  tier: "inline",
  tone: "neutral",
  // 5 readings of one standard before drawing its line.
  threshold: 5,
  next_step:
    "Read each metric's line against its limit's own history. Mechanical pin eligibility comes from the Gate; Patterns recommends a pin only when current comparable evidence is persistent and stable.",
  detect(facts): DetectorOutcome {
    interface Reading {
      event: VerbEvent;
      standard: StandardReading;
    }
    const series = new Map<string, Reading[]>();
    for (const e of facts.verbs) {
      for (const s of e.standards ?? []) {
        const list = series.get(s.name) ?? [];
        list.push({ event: e, standard: s });
        series.set(s.name, list);
      }
    }
    const latestInventory = facts.verbs.findLast((event) =>
      event.standards !== undefined
    );
    const activeNames = new Set(
      latestInventory?.standards?.map((standard) => standard.name) ?? [],
    );
    const pins = facts.events.filter(
      (e): e is Extract<LogbookEvent, { kind: "pin" }> => e.kind === "pin",
    );
    let considered = 0;
    const findings: DetectorFinding[] = [];
    for (const [name, entries] of [...series.entries()].sort()) {
      const readings = entries.filter((entry) =>
        entry.standard.value !== undefined
      );
      considered += readings.length;
      if (readings.length < 5) {
        continue;
      }
      const first = readings[0];
      const last = readings[readings.length - 1];
      if (first === undefined || last === undefined) {
        continue;
      }
      const firstValue = first.standard.value;
      const lastValue = last.standard.value;
      if (firstValue === undefined || lastValue === undefined) {
        continue;
      }
      const span = daysBetween(first.event.at, last.event.at);
      const ownPins = pins.filter((p) => p.standard === name);
      const firstPin = ownPins[0];
      const lastPin = ownPins[ownPins.length - 1];
      // Distinct setups, not consecutive-pair flips: parallel worktrees
      // interleave their runs through one logbook, so the same two setups
      // can alternate for pages — that is still two setups, not a boundary
      // per flip.
      const setups = new Set(
        readings.map((reading) =>
          `${reading.event.epoch ?? ""} ${reading.event.writer ?? ""}`
        ),
      ).size;
      const pieces = [
        `\`${name}\` measured ${formatHumanNumber(firstValue)} → ${
          formatHumanNumber(lastValue)
        } across ${formatHumanNumber(span)} days (${
          formatHumanNumber(readings.length)
        } readings)`,
      ];
      if (firstPin !== undefined && lastPin !== undefined) {
        pieces.push(
          `the limit moved ${formatHumanNumber(firstPin.from)} → ${
            formatHumanNumber(lastPin.to)
          } across ${formatHumanNumber(ownPins.length)} pin${
            ownPins.length === 1 ? "" : "s"
          }`,
        );
      } else if (last.standard.limit !== undefined) {
        pieces.push(
          `the limit held at ${formatHumanNumber(last.standard.limit)}`,
        );
      }
      if (setups > 1) {
        pieces.push(
          `the readings span ${
            formatHumanNumber(setups)
          } config/release setups, so ${TRAJECTORY_BOUNDARY_ATTRIBUTION}`,
        );
      }
      const retired = latestInventory !== undefined && !activeNames.has(name);
      const currentEntries = retired || latestInventory === undefined
        ? []
        : entries.filter((entry) =>
          sameComparableSetup(entry.event, latestInventory, facts)
        );
      const comparableReadings = currentEntries.filter((entry) =>
        entry.standard.value !== undefined
      );
      const latestCurrent = currentEntries[currentEntries.length - 1]?.standard;
      const recent = comparableReadings.slice(-5);
      const tail3 = comparableReadings.slice(-3);
      const mechanicallyEligible = latestCurrent?.pin_eligible === true &&
        latestCurrent.pin_target !== undefined;
      const currentMeasurement = latestCurrent?.value !== undefined &&
          (latestCurrent.measurement === "measured" ||
            latestCurrent.measurement === "replayed")
        ? 1
        : 0;
      const persistentEligibility = tail3.length === 3 &&
        tail3.every((entry) =>
          entry.standard.pin_eligible === true &&
          entry.standard.pin_target !== undefined
        );
      const direction = latestCurrent?.direction === "up" ||
          latestCurrent?.direction === "down"
        ? latestCurrent.direction
        : undefined;
      let previousDirection: number | undefined;
      let recentReversals = 0;
      for (let index = 1; index < recent.length; index += 1) {
        const before = recent[index - 1]?.standard.value;
        const after = recent[index]?.standard.value;
        if (
          before === undefined || after === undefined || direction === undefined
        ) {
          continue;
        }
        const oriented = (after - before) * (direction === "up" ? 1 : -1);
        const movement = Math.sign(oriented);
        if (movement === 0) {
          continue;
        }
        if (
          previousDirection !== undefined && movement !== previousDirection
        ) {
          recentReversals += 1;
        }
        previousDirection = movement;
      }
      const recentFailures = recent.filter((entry) =>
        entry.standard.verdict === "regressed"
      ).length;
      const legacyEligibilityReadings = recent.filter((entry) =>
        entry.standard.pin_eligible === undefined ||
        entry.standard.margin === undefined ||
        entry.standard.measurement === undefined
      ).length;
      const recommendationSupported = !retired && currentMeasurement === 1 &&
        mechanicallyEligible && persistentEligibility &&
        recentReversals === 0 && recentFailures === 0 &&
        legacyEligibilityReadings === 0;
      const headroom = (r: Reading): number | undefined =>
        r.standard.value === undefined || r.standard.limit === undefined
          ? undefined
          : r.standard.direction === "down"
          ? r.standard.limit - r.standard.value
          : r.standard.direction === "up"
          ? r.standard.value - r.standard.limit
          : undefined;
      const firstHeadroom = headroom(first);
      const lastHeadroom = headroom(last);
      const tone: PatternFindingTone = retired
        ? "neutral"
        : recommendationSupported ||
            (firstHeadroom !== undefined && lastHeadroom !== undefined &&
              lastHeadroom > firstHeadroom)
        ? "good"
        : firstHeadroom !== undefined && lastHeadroom !== undefined &&
            lastHeadroom < firstHeadroom
        ? "attention"
        : "neutral";
      const limitWord = last.standard.direction === "down"
        ? "ceiling"
        : last.standard.direction === "up"
        ? "floor"
        : "limit";
      const againstLimit = last.standard.limit === undefined
        ? ""
        : ` vs ${limitWord} ${formatHumanNumber(last.standard.limit)}`;
      const movement = recommendationSupported
        ? "beats its recorded limit"
        : tone === "good"
        ? "has more headroom"
        : tone === "attention"
        ? "has less headroom"
        : firstValue === lastValue
        ? "held steady"
        : "changed";
      const evidence = {
        readings: readings.length,
        comparable_readings: comparableReadings.length,
        span_days: span,
        pins: ownPins.length,
        first_value: firstValue,
        last_value: lastValue,
        mechanically_eligible: mechanicallyEligible ? 1 : 0,
        recommendation_supported: recommendationSupported ? 1 : 0,
        current_measurement: currentMeasurement,
        recent_failures: recentFailures,
        recent_reversals: recentReversals,
        retired: retired ? 1 : 0,
        legacy_eligibility_readings: legacyEligibilityReadings,
        ...(first.standard.limit !== undefined
          ? { limit_first: first.standard.limit }
          : {}),
        ...(last.standard.limit !== undefined
          ? { limit_last: last.standard.limit }
          : {}),
        ...(latestCurrent?.margin !== undefined
          ? { margin: latestCurrent.margin }
          : {}),
        ...(latestCurrent?.pin_target !== undefined
          ? { pin_target: latestCurrent.pin_target }
          : {}),
      };
      const nextStep = retired
        ? `\`${name}\` is absent from the newest recorded Standard inventory. Keep this trajectory as historical evidence; there is no live limit to pin.`
        : latestCurrent?.measurement === "deferred"
        ? `\`${name}\` is on-demand and its latest Gate entry deferred measurement. Run \`discern standards\` for current evidence before considering a pin.`
        : currentMeasurement === 0
        ? `\`${name}\` has no current measured or replayed value. Run \`discern standards\` before considering a pin.`
        : recommendationSupported
        ? `\`${name}\` is mechanically eligible under its recorded margin and the last 3 comparable readings are persistent, non-reversing, and failure-free — capture the gain: \`discern standards --pin ${name}\`.`
        : mechanicallyEligible && recentFailures > 0
        ? `\`${name}\` is mechanically eligible now, but ${
          formatHumanNumber(recentFailures)
        } recent same-Standard failure${
          recentFailures === 1 ? "" : "s"
        } suppress pin advice.`
        : mechanicallyEligible && recentReversals > 0
        ? `\`${name}\` is mechanically eligible now, but recent comparable values are volatile (${
          formatHumanNumber(recentReversals)
        } direction reversals), so no pin is recommended.`
        : mechanicallyEligible
        ? `\`${name}\` is mechanically eligible now, but fewer than 3 comparable current readings establish persistent headroom, so no pin is recommended yet.`
        : `\`${name}\` is not mechanically eligible under its recorded margin and current limit; keep the trajectory as a statistic.`;
      findings.push({
        subject: name,
        summary: `This Standard ${movement}: ${
          formatHumanNumber(firstValue)
        } → ${formatHumanNumber(lastValue)}${againstLimit}.`,
        tone,
        series: downsampleTrajectorySeries(readings.map((reading) => ({
          at: reading.event.at,
          value: reading.standard.value ?? 0,
        }))),
        observed: `${pieces.join("; ")}.`,
        evidence,
        basis: decisionEvidenceBasis("standard-pin-decision", evidence, {
          comparable: comparableReadings.length,
          denominator: readings.length,
          unit: "Standard readings",
          events: currentEntries.map((entry) => entry.event),
          facts,
          legacyEvents: legacyEligibilityReadings,
          excludedEvents: readings.length - comparableReadings.length,
          limitations: [
            "Mechanical eligibility is recorded from the Gate's pin authority; recommendation additionally requires current comparable persistence, no recent reversals, and no recent failures.",
            ...(retired
              ? [
                "Retired status is inferred only when a newer recorded Standard inventory names other active Standards.",
              ]
              : []),
          ],
        }),
        strength: readings.length,
        next_step: nextStep,
      });
    }
    return { considered, findings };
  },
};

const redRateHistory: Detector = {
  id: "red-rate-history",
  title: "Red rate by month",
  family: "trajectory",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  // 3 months of data — fewer is a datapoint, not a series.
  threshold: 3,
  next_step:
    "Compare the latest direction with `duration-creep` and `loops-to-green`. Investigate only when the movement recurs; this series does not identify a cause.",
  detect(facts): DetectorOutcome {
    interface MonthCounts {
      ok: number;
      failed: number;
      coarse: boolean;
    }
    const months = new Map<string, MonthCounts>();
    // Coarse history first: prune digests carry each removed month's outcome
    // totals, so the series extends past rotation — counts, not per-event detail.
    for (const e of facts.events) {
      if (e.kind !== "prune") {
        continue;
      }
      for (const digest of e.removed as PruneDigest[]) {
        const month = digest.file.replace(/\.jsonl$/, "");
        months.set(month, {
          ok: digest.ok ?? 0,
          failed: (digest.failed ?? 0) + (digest.partial ?? 0),
          coarse: true,
        });
      }
    }
    for (const e of facts.verbs) {
      const month = e.at.slice(0, 7);
      const entry = months.get(month) ?? { ok: 0, failed: 0, coarse: false };
      if (entry.coarse) {
        continue; // a digested month's raw lines are gone; never double-count
      }
      if (e.outcome === "ok") {
        entry.ok += 1;
      } else if (e.outcome === "failed" || e.outcome === "partial") {
        entry.failed += 1;
      }
      months.set(month, entry);
    }
    const series = [...months.entries()]
      .filter(([, c]) => c.ok + c.failed > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const findings: DetectorFinding[] = [];
    if (series.length >= 3) {
      const rendered = series.map(([month, c]) => {
        const pct = Math.round((c.failed / (c.ok + c.failed)) * 100);
        return `${month} ${formatHumanNumber(pct)}%${
          c.coarse ? " (coarse)" : ""
        }`;
      });
      const total = series.reduce((sum, [, c]) => sum + c.ok + c.failed, 0);
      const newest = series[series.length - 1];
      const newestPct = newest !== undefined
        ? Math.round(
          (newest[1].failed / (newest[1].ok + newest[1].failed)) * 100,
        )
        : 0;
      findings.push({
        summary: "This is the project's recorded red-run rate by month.",
        observed: `red rate by month: ${rendered.join(", ")} — ${
          formatHumanNumber(total)
        } runs in all; months marked coarse survive only as rotation digests.`,
        evidence: {
          months: series.length,
          runs: total,
          latest_pct: newestPct,
        },
        strength: series.length,
      });
    }
    return { considered: series.length, findings };
  },
};

// ── checkpoint hygiene ───────────────────────────────────────────────────────
//
// Three observations about checkpoint CONFIGURATION fit, read from the same
// tallies the economics rows come from. Each speaks about a trigger or
// criterion an owner configured — its counts beside their denominators — and
// none evaluates an agent: a checkpoint usually declared unchanged can still
// be earning its keep (the agent may review before invoking the gate), so
// these advise reviewing the definition, never judging the driver.

/** Distinct efforts (branches) each checkpoint was SERVED on, at or after the
 * boundary, plus its serving count — the era-scoped view the dead and noisy
 * detectors share (a serving before the last `[checkpoints]` edit says
 * nothing about the current definitions). */
function eraServings(
  facts: StreamFacts,
  boundary: string | undefined,
): Map<string, { efforts: Set<string>; fires: number }> {
  const byId = new Map<string, { efforts: Set<string>; fires: number }>();
  for (const event of facts.verbs) {
    const block = event.checkpoints;
    if (block === undefined) {
      continue;
    }
    if (boundary !== undefined && event.at < boundary) {
      continue;
    }
    const servings = [
      ...(block.fired ?? []),
      ...(block.reopened ?? []),
      ...(block.advise ?? []),
    ];
    for (const serving of servings) {
      const entry = byId.get(serving.id) ?? { efforts: new Set(), fires: 0 };
      entry.fires += 1;
      if (event.branch !== null) {
        entry.efforts.add(event.branch);
      }
      byId.set(serving.id, entry);
    }
  }
  return byId;
}

/**
 * A configured checkpoint that has never fired across sufficient history is
 * likely mis-scoped: its trigger names paths, scopes, or thresholds the
 * project's real changes never match, so the criterion it carries protects
 * nothing. The denominator counts gate-run efforts since the `[checkpoints]`
 * configuration last changed, so a fresh revision earns fresh evidence.
 */
const checkpointDead: Detector = {
  id: "checkpoint-dead",
  title: "Configured checkpoints that never fire",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // Eight gate-run efforts under the current configuration: enough distinct
  // changes that "no trigger ever matched" reads as scoping, not coincidence.
  threshold: 8,
  next_step:
    "Review the trigger against how this project actually changes — widen its scope or paths, lower its thresholds, or remove the checkpoint if the risk it watched for no longer exists.",
  detect(facts): DetectorOutcome {
    const boundary = checkpointConfigBoundary(facts);
    const efforts = gateEffortsSince(facts, boundary);
    const everServed = eraServings(facts, undefined);
    const findings: DetectorFinding[] = [];
    for (const id of [...facts.configuredCheckpoints].sort()) {
      const served = everServed.get(id);
      if (served !== undefined && served.fires > 0) {
        continue;
      }
      findings.push({
        subject: id,
        summary: "This configured checkpoint has never fired.",
        observed: `\`${id}\` is configured and fired on 0 of ${
          formatHumanNumber(efforts.size)
        } gate-run efforts${
          boundary === undefined
            ? ""
            : " since the checkpoints configuration last changed"
        }.`,
        evidence: { efforts: efforts.size, fires: 0 },
        strength: efforts.size,
      });
    }
    return { considered: efforts.size, findings };
  },
};

/**
 * A checkpoint that fires on most efforts taxes every one of them with a
 * served criterion, which is the failure mode scarcity guards against: a
 * judgment served everywhere changes decisions nowhere. The counts say how
 * broad the trigger runs; narrowing it is the owner's call.
 */
const checkpointNoisy: Detector = {
  id: "checkpoint-noisy",
  title: "Checkpoints firing on most efforts",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // The same eight-effort denominator as checkpoint-dead: breadth judged on
  // fewer distinct changes reads the project's week, not its shape.
  threshold: 8,
  next_step:
    "Narrow the trigger — a tighter scope or path set, a higher file threshold, or an unless_changed counterpart — so the criterion is served where it can change a decision.",
  detect(facts): DetectorOutcome {
    const boundary = checkpointConfigBoundary(facts);
    const efforts = gateEffortsSince(facts, boundary);
    const served = eraServings(facts, boundary);
    const findings: DetectorFinding[] = [];
    if (efforts.size > 0) {
      for (const [id, entry] of [...served.entries()].sort()) {
        const firedEfforts = [...entry.efforts].filter((branch) =>
          efforts.has(branch)
        ).length;
        if (firedEfforts / efforts.size < 0.8) {
          continue;
        }
        findings.push({
          subject: id,
          summary: "This checkpoint fires on most efforts.",
          observed: `\`${id}\` fired on ${formatHumanNumber(firedEfforts)} of ${
            formatHumanNumber(efforts.size)
          } gate-run efforts (${formatHumanNumber(entry.fires)} servings)${
            boundary === undefined
              ? ""
              : " since the checkpoints configuration last changed"
          }.`,
          evidence: {
            efforts: efforts.size,
            efforts_fired: firedEfforts,
            fires: entry.fires,
          },
          strength: firedEfforts,
        });
      }
    }
    return { considered: efforts.size, findings };
  },
};

/**
 * A checkpoint that often lands under an owner-authorized variance is telling
 * the owner something about its own definition: the criterion is routinely
 * judged unmet and the owner routinely authorizes landing anyway. The counts
 * report that shape; whether the trigger, the criterion wording, or the mode
 * should move is the owner's review.
 */
const checkpointVaried: Detector = {
  id: "checkpoint-varied",
  title: "Checkpoints that often land under a variance",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // Three landed efforts where the checkpoint fired: each variance is an
  // explicit owner ceremony, so three of them is deliberate evidence, not an
  // odd afternoon.
  threshold: 3,
  next_step:
    "Review the trigger, criterion, and mode with the owner — a criterion routinely judged unmet and varied may be aimed at the wrong boundary, or may belong in advise mode.",
  detect(facts): DetectorOutcome {
    const analysis = analyzeCheckpointObservations(facts);
    const findings: DetectorFinding[] = [];
    let considered = 0;
    for (
      const tally of [...analysis.tallies.values()].sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    ) {
      const landed = [...tally.effortsFired].filter((branch) =>
        analysis.landedEfforts.has(branch)
      ).length;
      considered = Math.max(considered, landed);
      if (landed < 3) {
        continue;
      }
      const varied = tally.varianceEfforts.size;
      if (varied < 3 || varied / landed < 0.5) {
        continue;
      }
      findings.push({
        subject: tally.id,
        summary: "This checkpoint often lands with an authorized variance.",
        observed: `\`${tally.id}\` landed under an owner-authorized variance ` +
          `on ${formatHumanNumber(varied)} of ${
            formatHumanNumber(landed)
          } landed efforts where it fired (${
            formatHumanNumber(tally.variances)
          } variances in all).`,
        evidence: {
          landed,
          variance_landings: varied,
          variances: tally.variances,
        },
        strength: varied,
      });
    }
    return { considered, findings };
  },
};

/**
 * The registry — every detector the `patterns` verb runs, in stable detector
 * order. The single source of truth: the verb, the report schema, and the
 * parameterized test harness all iterate THIS list, so a new detector
 * auto-enrols everywhere (and the harness fails until it brings fixtures).
 */
export const DETECTORS: readonly Detector[] = [
  doneThrash,
  refusalLoop,
  hintFollowThrough,
  tipAdoption,
  skippedPrepare,
  dirtyDoneChurn,
  trunkEdits,
  forceHabit,
  confirmedRerun,
  dormantVerbs,
  preAuthorizedLandings,
  grantSuggestion,
  docsGap,
  abandonedWorktrees,
  sequenceAnomaly,
  identityGap,
  providerFit,
  cohortDoneThrash,
  instructionParity,
  dominantStage,
  generatorGateShare,
  slotContention,
  maskedFailures,
  durationCreep,
  fixStageIdle,
  recurringDiagnostic,
  sameTreeFlake,
  executionContextDivergence,
  loopsToGreen,
  cohortLoopsToGreen,
  cycleTime,
  giantCommitLanding,
  updateFriction,
  standardTrajectory,
  redRateHistory,
  checkpointDead,
  checkpointNoisy,
  checkpointVaried,
];

// ── the gated runner ────────────────────────────────────────────────────────

/** One detector's gated run: its status, denominator, and surviving findings. */
export interface DetectorReport {
  detector: Detector;
  status: DetectorStatus;
  considered: number;
  findings: DetectorFinding[];
}

/**
 * Run one detector with the evidence threshold applied — the ONE place the
 * small-N honesty rule lives, so no detector self-censors inconsistently.
 * Below threshold, findings are discarded and the status says so; at or above
 * it, the detector either fired or is genuinely quiet.
 */
export function runDetector(d: Detector, facts: StreamFacts): DetectorReport {
  const { considered, findings } = d.detect(facts);
  if (considered < d.threshold) {
    return {
      detector: d,
      status: "insufficient-evidence",
      considered,
      findings: [],
    };
  }
  return {
    detector: d,
    status: findings.length > 0 ? "fired" : "quiet",
    considered,
    findings,
  };
}

/** Run the whole registry over one stream, in registry order. */
export function runDetectors(facts: StreamFacts): DetectorReport[] {
  return DETECTORS.map((d) => runDetector(d, facts));
}
