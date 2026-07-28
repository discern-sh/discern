/**
 * The `patterns` **detector registry** — the single source of truth for every
 * named detector the verb runs over the logbook's event stream. Each entry is a
 * checkable predicate with a stable id, a family, the scope its findings apply
 * to, a tier (wave 3's receipt/status surfacing may carry `inline` findings;
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
 * compare only within one config epoch and writer version
 * ({@link comparableTail}); across a boundary they attribute — naming what
 * moved and when — rather than staying silent or comparing blindly.
 *
 * Thresholds are recorded judgment: each carries a comment saying why that
 * number, all start conservative, and accumulated dogfood history is the
 * intended tuner.
 */

import { AGENT_CATALOGUE } from "../../shared/agent_catalogue.ts";
import type {
  DetectorFamily,
  DetectorScope,
  DetectorStatus,
  DetectorTier,
  PatternFindingTone,
} from "../../shared/patterns_vocabulary.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import { HINTS } from "../../shared/hints.ts";
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
import type { LogbookEvent, PruneDigest, VerbEvent } from "./schema.ts";

/** Stable marker carried in standard observations when their series crosses
 * a configuration or release boundary. The human report recognizes the same
 * marker and states the attribution caveat once per trajectory section. */
export const TRAJECTORY_BOUNDARY_ATTRIBUTION =
  "segments are attributed, not blended";

// ── the stream, pre-digested ────────────────────────────────────────────────

/** The event stream plus everything detectors keep re-deriving, computed once. */
export interface StreamFacts {
  /** Every parsed event, oldest first. */
  events: LogbookEvent[];
  /** Verb events eligible for analysis: CI runs and `--dry-run` previews excluded. */
  verbs: VerbEvent[];
  /** {@link StreamFacts.verbs} minus interactively-driven runs (see {@link driverKind}) —
   * the behaviour detectors' population, so an owner's exploratory runs never
   * read as agent pathology. */
  agentish: VerbEvent[];
  /** The trunk branch name (`[repository].trunk`) — the branch work must not land on directly. */
  trunk: string;
  /** The native provider names guidance is compiled for (the configured
   * `[guidance].agents`, resolved) — what the provider-fit detector reads the
   * driver mix against. */
  configuredAgents: readonly string[];
  /** The newest event's timestamp — the stream's own "now", so age-relative
   * detectors are pure functions of the stream (and deterministic in tests). */
  horizon: string | undefined;
}

/** The analysis population of a raw stream: verb events minus CI noise and
 * `--dry-run` previews — shared by {@link buildStreamFacts} and the boundary
 * vocabulary in {@link comparableTail}, so the two can't diverge. */
function analyzableVerbs(events: readonly LogbookEvent[]): VerbEvent[] {
  return events.filter((e): e is VerbEvent => e.kind === "verb")
    .filter((e) => e.driver?.ci !== true && e.dry_run !== true);
}

/** Build the pre-digested facts every detector receives. */
export function buildStreamFacts(
  events: LogbookEvent[],
  trunk: string,
  configuredAgents: readonly string[] = [],
): StreamFacts {
  const verbs = analyzableVerbs(events);
  const agentish = verbs.filter((e) => driverKind(e) !== "human");
  return {
    events,
    verbs,
    agentish,
    trunk,
    configuredAgents,
    horizon: events[events.length - 1]?.at,
  };
}

// ── the registry vocabulary ─────────────────────────────────────────────────

/** One finding: what was observed (plain counts), about what, and what to do. */
export interface DetectorFinding {
  /** What the finding is about — a branch, a standard, a tool+rule, a commit. */
  subject?: string;
  /** One-line row form, read beside {@link subject}. */
  brief: string;
  /** Overrides the detector's presentation tone when this finding's facts decide it. */
  tone?: PatternFindingTone;
  /** The observation as one plain-count sentence. */
  observed: string;
  /** The counts behind the sentence, named. */
  evidence: Record<string, number>;
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
  /** Minimum `considered` before the detector may speak. */
  threshold: number;
  /** The recommended structural next step (findings may override per shape). */
  next_step: string;
  detect(facts: StreamFacts): DetectorOutcome;
}

// ── shared analysis helpers ─────────────────────────────────────────────────

/** Group verb events by branch, dropping branch-less (detached / unresolvable) ones. */
function byBranch(events: VerbEvent[]): Map<string, VerbEvent[]> {
  const groups = new Map<string, VerbEvent[]>();
  for (const e of events) {
    if (e.branch === null) {
      continue;
    }
    const group = groups.get(e.branch);
    if (group === undefined) {
      groups.set(e.branch, [e]);
    } else {
      group.push(e);
    }
  }
  return groups;
}

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

/** The longest run of consecutive matching items. */
function longestStreak<T>(xs: T[], pred: (x: T) => boolean): number {
  let best = 0;
  let run = 0;
  for (const x of xs) {
    run = pred(x) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The median of a non-empty list (mean of the middle two when even). */
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) {
    return hi;
  }
  const lo = sorted[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

/** Round to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The calendar day of an ISO timestamp ("2026-07-20"). */
function day(at: string): string {
  return at.slice(0, 10);
}

/** Whole days between two ISO timestamps. */
function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** A red gate outcome whose failure reached the tests (the flake dimension). */
function testRed(e: VerbEvent): boolean {
  return e.outcome === "failed" &&
    (e.failed_stage === "test" || e.failed_stage === "check/test");
}

/**
 * The stream's comparable tail: the longest run of newest events sharing the
 * final event's config epoch, writer version, AND dominant-client version era
 * ({@link dominantClientEras}) — the only window a trend may compare within.
 * The three boundary kinds carry equal weight: a shift that lands exactly at
 * the dominant client's upgrade is attributed to the driver's release, not
 * blended into the trend or blamed on the setup. When older events exist
 * beyond the tail, `boundary` names what moved and when (the section list
 * from the matching `config-change` event where one exists; the client, its
 * version pair, and the date for a client release), so a trend detector can
 * attribute instead of blending.
 */
export function comparableTail(
  events: VerbEvent[],
  all: LogbookEvent[],
): {
  tail: VerbEvent[];
  boundary?: { at: string; detail: string; prior: number };
} {
  const last = events[events.length - 1];
  if (last === undefined) {
    return { tail: [] };
  }
  const eras = dominantClientEras(analyzableVerbs(all));
  let start = events.length - 1;
  while (start > 0) {
    const prev = events[start - 1];
    if (
      prev === undefined || prev.epoch !== last.epoch ||
      prev.writer !== last.writer ||
      eras.eraOf(prev) !== eras.eraOf(last)
    ) {
      break;
    }
    start -= 1;
  }
  const tail = events.slice(start);
  if (start === 0) {
    return { tail };
  }
  const first = tail[0];
  const before = events[start - 1];
  if (first === undefined || before === undefined) {
    return { tail };
  }
  const moved: string[] = [];
  if (before.epoch !== last.epoch) {
    const change = all.find((
      e,
    ): e is Extract<LogbookEvent, { kind: "config-change" }> =>
      e.kind === "config-change" && e.epoch === last.epoch
    );
    moved.push(
      change !== undefined && change.sections.length > 0
        ? `a config change to [${change.sections.join("], [")}]`
        : "a config change",
    );
  }
  if (before.writer !== last.writer) {
    moved.push(
      `the ${before.writer ?? "unversioned"} → ${
        last.writer ?? "unversioned"
      } release`,
    );
  }
  if (eras.eraOf(before) !== eras.eraOf(last)) {
    const from = eras.versionOf(eras.eraOf(before));
    const to = eras.versionOf(eras.eraOf(last));
    if (eras.label !== undefined && from !== undefined && to !== undefined) {
      moved.push(`the ${eras.label} ${from} → ${to} client release`);
    }
  }
  return {
    tail,
    boundary: {
      at: first.at,
      detail: `${moved.join(" and ")} on ${day(first.at)}`,
      prior: start,
    },
  };
}

/** The attribution finding a trend detector reports when its comparable tail is
 * too short to trend but older, non-comparable history exists — naming the
 * boundary rather than staying silent or comparing blindly. */
function attributionFinding(
  tail: number,
  boundary: { at: string; detail: string; prior: number },
): DetectorFinding {
  return {
    brief: `${formatHumanNumber(tail)} comparable ${
      tail === 1 ? "run" : "runs"
    } since ${boundary.detail}`,
    tone: "neutral",
    observed:
      `only ${formatHumanNumber(tail)} comparable ${
        tail === 1 ? "run" : "runs"
      } since ${boundary.detail} — ` +
      `the ${formatHumanNumber(boundary.prior)} earlier ${
        boundary.prior === 1 ? "run predates" : "runs predate"
      } it and can't be trended against the current setup.`,
    evidence: { comparable_runs: tail, prior_runs: boundary.prior },
    strength: 1,
    next_step:
      "Trend analysis restarts at a configuration or release boundary; check back once more runs accrue on the current setup.",
  };
}

/** Sum of a step group's recorded durations within one event. */
function stageSeconds(e: VerbEvent, group: string): number | undefined {
  const steps = (e.steps ?? []).filter((s) => s.group === group);
  if (steps.length === 0) {
    return undefined;
  }
  return steps.reduce((sum, s) => sum + (s.duration_s ?? 0), 0);
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
    "A red `done` loop is usually symptom-chasing — run the `discern-cure-a-bug` skill's diagnose procedure to prove the cause, and iterate with `discern prepare` between attempts instead of paying the full gate each time.",
  detect(facts): DetectorOutcome {
    const dones = facts.agentish.filter((e) => e.verb === "done");
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(dones)) {
      for (const session of bySession(events)) {
        const streak = longestStreak(session, (e) => e.outcome === "failed");
        // A 3-streak is where iteration stops looking like progress.
        if (streak >= 3) {
          findings.push({
            subject: branch,
            brief: `${formatHumanNumber(streak)} red \`done\` runs · ${
              formatHumanNumber(session.length)
            } in the conversation`,
            observed: `\`done\` failed ${
              formatHumanNumber(streak)
            } consecutive runs on \`${branch}\` (${
              formatHumanNumber(session.length)
            } runs in the conversation).`,
            evidence: { consecutive_failures: streak, runs: session.length },
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
  // refusal is an agent arguing with a precondition.
  threshold: 3,
  next_step:
    "A refusal means the verb declined — repeating the call won't change its answer. Read the refusal message for the precondition it names; if agents keep hitting it, capture the lesson with the `discern-teach-the-project` skill.",
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
            brief: `${formatHumanNumber(count)} refusals · \`${verb}\`${
              slug !== "" ? ` · \`${slug}\`` : ""
            }`,
            observed:
              `\`${verb}\` refused ${
                formatHumanNumber(count)
              } times on \`${branch}\`` +
              (slug !== "" ? ` with the same slug (\`${slug}\`).` : "."),
            evidence: { refusals: count },
            strength: count,
          });
        }
      }
    }
    return { considered: refused.length, findings };
  },
};

const hintFollowThrough: Detector = {
  id: "hint-follow-through",
  title: "Repeated update advice without an update",
  family: "behaviour",
  scope: "session",
  tier: "inline",
  tone: "attention",
  // 3 repeats: one reminder is ordinary, and a second can follow another state
  // read; the third recurrence in one session is a loop worth reporting.
  threshold: 3,
  next_step:
    "Run `discern update`. It is idempotent and checks its own preconditions, so repeating `status` cannot resolve a branch that remains behind.",
  detect(facts): DetectorOutcome {
    const hintId = HINTS["status-branch-behind"].id;
    const firings = facts.agentish.filter((event) =>
      (event.hint_ids ?? []).includes(hintId)
    );
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(facts.agentish)) {
      for (const session of bySession(events)) {
        let repeats = 0;
        for (const event of session) {
          if (event.verb === "update") {
            repeats = 0;
          } else if ((event.hint_ids ?? []).includes(hintId)) {
            repeats += 1;
          }
        }
        if (repeats >= 3) {
          findings.push({
            subject: branch,
            brief: `${formatHumanNumber(repeats)} update hints · no update`,
            observed:
              `\`${hintId}\` fired ${
                formatHumanNumber(repeats)
              } times in one session on ` +
              `\`${branch}\` since its latest \`update\` run.`,
            evidence: { hint_fires: repeats, update_runs: 0 },
            strength: repeats,
          });
        }
      }
    }
    return { considered: firings.length, findings };
  },
};

const skippedPrepare: Detector = {
  id: "skipped-prepare",
  title: "Done-heavy iteration without prepare",
  family: "behaviour",
  scope: "branch",
  tier: "inline",
  tone: "attention",
  // 4 gate-loop runs before judging a branch's iteration style.
  threshold: 4,
  next_step:
    "`discern prepare` is the fast inner loop (fixers plus checks, no tests) — iterating through `done` alone pays for the full gate on every attempt.",
  detect(facts): DetectorOutcome {
    const loop = facts.agentish.filter((e) =>
      e.verb === "done" || e.verb === "prepare"
    );
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(loop)) {
      const dones = events.filter((e) => e.verb === "done");
      const prepares = events.length - dones.length;
      const redDones = dones.filter((e) => e.outcome === "failed").length;
      // Red done runs prove iteration happened; zero prepares proves the fast
      // loop never entered it.
      if (dones.length >= 4 && redDones >= 2 && prepares === 0) {
        findings.push({
          subject: branch,
          brief: `${formatHumanNumber(dones.length)} \`done\` runs (${
            formatHumanNumber(redDones)
          } red) · no \`prepare\``,
          observed: `\`${branch}\` iterated through ${
            formatHumanNumber(dones.length)
          } \`done\` runs (${
            formatHumanNumber(redDones)
          } red) with no \`prepare\` between them.`,
          evidence: {
            done_runs: dones.length,
            red_done_runs: redDones,
            prepare_runs: 0,
          },
          strength: redDones,
        });
      }
    }
    return { considered: loop.length, findings };
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
    "Only a clean committed HEAD earns an honored receipt, so a dirty `done` can never be the final one — iterate with `prepare` and `test`, then commit and run `done` once on the finished tree.",
  detect(facts): DetectorOutcome {
    const dones = facts.agentish.filter((e) => e.verb === "done");
    const findings: DetectorFinding[] = [];
    for (const [branch, events] of byBranch(dones)) {
      const dirty = events.filter((e) => e.clean === false).length;
      if (dirty >= 5 && dirty * 2 > events.length) {
        findings.push({
          subject: branch,
          brief: `${formatHumanNumber(dirty)} of ${
            formatHumanNumber(events.length)
          } \`done\` runs · dirty tree`,
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
    "Work belongs in worktrees — `discern start` creates one per change. Edits made directly on the trunk collide with every other effort and bypass the landing flow.",
  detect(facts): DetectorOutcome {
    const onTrunk = facts.agentish.filter((e) => e.branch === facts.trunk);
    const dirty = onTrunk.filter((e) => e.clean === false);
    const verbs = new Set(dirty.map((e) => e.verb));
    const findings: DetectorFinding[] = dirty.length >= 3
      ? [{
        subject: facts.trunk,
        brief: `${formatHumanNumber(dirty.length)} dirty runs · ${
          [...verbs].sort().join(", ")
        }`,
        observed: `${formatHumanNumber(dirty.length)} runs (${
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
    "Each `--force` bypasses a guard. When it becomes routine, the guard is mis-fit or the workflow has a gap — fix the underlying refusal, or record the situation with the `discern-teach-the-project` skill so future sessions don't inherit the habit.",
  detect(facts): DetectorOutcome {
    const forced = facts.agentish.filter((e) =>
      (e.flags ?? []).includes("force")
    );
    const verbs = new Set(forced.map((e) => e.verb));
    const findings: DetectorFinding[] = forced.length >= 3
      ? [{
        brief: `${formatHumanNumber(forced.length)} forced runs · ${
          [...verbs].sort().join(", ")
        }`,
        observed: `\`--force\` was passed ${
          formatHumanNumber(forced.length)
        } times (${[...verbs].sort().join(", ")}).`,
        evidence: { forced_runs: forced.length },
        strength: forced.length,
      }]
      : [];
    return { considered: facts.agentish.length, findings };
  },
};

const confirmedRerun: Detector = {
  id: "confirmed-rerun",
  title: "Recurring confirmed gate reruns",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // Each --confirmed re-runs a tree the gate already judged — one is a
  // deliberate probe; three is a habit worth naming.
  threshold: 3,
  next_step:
    "A confirmed rerun asks an unchanged tree for a changed verdict. When that becomes routine, the gate's verdicts aren't trusted — diagnose the unstable check (`discern-cure-a-bug`, diagnose procedure) instead of paying the gate to re-ask; the same-tree-flake findings name which trees flipped.",
  detect(facts): DetectorOutcome {
    const confirmed = facts.agentish.filter((e) =>
      e.verb === "done" && (e.flags ?? []).includes("confirmed")
    );
    const branches = new Set(
      confirmed.map((e) => e.branch).filter((b): b is string => b !== null),
    );
    const findings: DetectorFinding[] = confirmed.length >= 3
      ? [{
        brief: `${formatHumanNumber(confirmed.length)} confirmed reruns${
          branches.size > 0
            ? ` · ${formatHumanNumber(branches.size)} branches`
            : ""
        }`,
        observed:
          `\`done --confirmed\` re-ran the gate on an already-judged tree ${
            formatHumanNumber(confirmed.length)
          } times` +
          (branches.size > 0
            ? ` across ${formatHumanNumber(branches.size)} branches.`
            : "."),
        evidence: {
          confirmed_runs: confirmed.length,
          branches: branches.size,
        },
        strength: confirmed.length,
      }]
      : [];
    return { considered: facts.agentish.length, findings };
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
    "The most-read topics are where guidance pays off — keep those pages current.",
  detect(facts): DetectorOutcome {
    // Humans reading docs are signal too, so this detector keeps every
    // non-CI lookup rather than the agent-scored subset.
    const lookups = facts.verbs.filter((e) =>
      (e.verb === "help" || e.verb === "map") && e.target !== undefined
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
        brief: `${formatHumanNumber(count)} requests · all refused`,
        tone: "attention",
        observed: `\`${key}\` was asked for ${
          formatHumanNumber(count)
        } times and refused every time — the purest guidance-gap signal the logbook holds.`,
        evidence: { misses: count },
        // Misses outrank read counts in the report: a missing page is
        // actionable, a popular one is context.
        strength: count * 25,
        next_step:
          "Agents keep asking for a page that isn't there. Add the topic (the `discern-document-subsystem` skill fits), or cross-link it from where they look.",
      });
    }
    if (lookups.length >= 10 && reads.size > 0) {
      const top = [...reads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const first = top[0];
      if (first !== undefined) {
        findings.push({
          brief: `${formatHumanNumber(lookups.length)} lookups · most read ${
            top.map(([key, count]) => `\`${key}\` ${formatHumanNumber(count)}`)
              .join(" · ")
          }`,
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
  title: "Started but never green",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 2 tracked branches: with one branch there is no fleet to compare against.
  threshold: 2,
  next_step:
    "`discern status` lists the fleet — finish what's alive, and drop what's dead with `discern worktree drop` so stale efforts stop reading as work in flight.",
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
        brief: `${formatHumanNumber(abandoned.length)} of ${
          formatHumanNumber(branches.size)
        } branches · ${formatHumanNumber(named[0]?.idleDays ?? 0)}d idle`,
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
  title: "Out-of-protocol verb orderings",
  family: "behaviour",
  scope: "branch",
  tier: "batch",
  tone: "attention",
  // 2 qualifying events before judging orderings at all.
  threshold: 2,
  next_step:
    "The flow is `start` → `prepare` → `done` → `accept`: `done` produces the receipt and `accept` verifies it — acceptance can't substitute for a green gate.",
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
        brief: `${formatHumanNumber(premature.length)} premature \`accept\` ${
          premature.length === 1 ? "" : "s"
        } · ${formatHumanNumber(prematureBranches.length)} branch${
          prematureBranches.length === 1 ? "" : "es"
        }`,
        observed: `\`accept\` was attempted ${
          formatHumanNumber(premature.length)
        } time${premature.length === 1 ? "" : "s"} on ${
          formatHumanNumber(prematureBranches.length)
        } branch${
          prematureBranches.length === 1 ? "" : "es"
        } with no green \`done\` on record (${
          prematureBranches.slice(0, 3).map((b) => `\`${b}\``).join(", ")
        }${prematureBranches.length > 3 ? ", …" : ""}).`,
        evidence: {
          premature_accepts: premature.length,
          branches: prematureBranches.length,
        },
        strength: premature.length * 10,
      });
    }
    // Named ordering 2: a green done re-run on the identical tree — the
    // receipt already honors it, so the second full gate bought nothing.
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
        brief: `${
          formatHumanNumber(redundant)
        } green \`done\` reruns · unchanged tree`,
        observed: `${
          formatHumanNumber(redundant)
        } green \`done\` runs repeated the full gate on an identical, already-honored tree.`,
        evidence: { redundant_reruns: redundant },
        strength: redundant,
        next_step:
          "A green `done` on an unchanged tree is already honored — `discern status` shows the receipt's standing without re-running anything.",
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
    "Runs discern can't attribute to a known agent read as one anonymous cohort. A newer discern release may recognize the client; until then, weigh the other findings knowing part of the corpus is unattributed.",
  detect(facts): DetectorOutcome {
    // Identity evidence is about the corpus, not behaviour pathology, so the
    // population is every analyzed run that carries any of it.
    const bearing = facts.verbs.filter((e) =>
      (e.driver?.agent_signals ?? []).length > 0 ||
      e.driver?.mcp_client !== undefined
    );
    const unknownClients = new Map<string, number>();
    let undeclared = 0;
    for (const e of bearing) {
      const signals = e.driver?.agent_signals ?? [];
      const client = e.driver?.mcp_client;
      // A client declaration with no matching mcp-client signal means the
      // recorder's catalogue didn't recognize it — the raw name was retained
      // exactly so a reader could say so.
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
        brief: `${formatHumanNumber(count)} MCP calls · unknown client`,
        observed: `\`${name}\` drove ${
          formatHumanNumber(count)
        } MCP calls but matches nothing in the identity catalogue.`,
        evidence: { runs: count },
        strength: count,
      });
    }
    if (undeclared >= 3) {
      findings.push({
        brief: `${
          formatHumanNumber(undeclared)
        } runs · unrecognized \`AI_AGENT\``,
        observed:
          `an agent declaring an \`AI_AGENT\` value discern doesn't recognize drove ${
            formatHumanNumber(undeclared)
          } runs.`,
        evidence: { runs: undeclared },
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
    "discern can compile guidance and materialize skills for this agent natively — add it to [guidance].agents in discern.toml and run `discern refresh`, so the agents actually driving the project receive its guidance.",
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
        brief: `${formatHumanNumber(runs)} of ${
          formatHumanNumber(attributed)
        } attributed runs · integration absent`,
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

/** The compiled guidance file for one cohort's identity, when discern emits
 * one — the provider surface a guidance-parity finding can name. Signal-only
 * identities have none: there is no compiled surface to fix, and provider-fit
 * already proposes adding an integration for a returning agent. */
function guidanceSurfaceOf(agent: string): string | undefined {
  const entry = AGENT_CATALOGUE.find((i) => i.id === agent);
  return entry !== undefined && "guidancePath" in entry
    ? entry.guidancePath
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
    "Cohorts draw different task mixes, so these counts are a place to look, never a verdict. The branch-scope done-thrash findings name the exact thrashing branches — diagnose those (`discern-cure-a-bug`); if one cohort keeps meeting red streaks, check how its provider's compiled guidance teaches the `prepare` loop.",
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
        brief: clauses.join(" · "),
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

const guidanceParity: Detector = {
  id: "guidance-parity",
  title: "A gap one cohort keeps hitting that its peers never do",
  family: "behaviour",
  scope: "project",
  tier: "batch",
  tone: "neutral",
  cohorts: true,
  // Cohort-counted `considered`, as for every cohort detector.
  threshold: COHORT_MINIMUMS.cohorts,
  next_step:
    "A gap only one population hits points at the guidance surface compiled for it, not at the agent — fix the surface, then `discern refresh`.",
  detect(facts): DetectorOutcome {
    // One authored source compiles to every provider's guidance file, so a
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
      if ((e.verb === "help" || e.verb === "map") && e.target !== undefined) {
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
        const surface = guidanceSurfaceOf(only.agent);
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
          brief: shape === "refusal"
            ? `${formatHumanNumber(hits)} refusals · peers 0`
            : `${formatHumanNumber(hits)} requests · peers 0 · all missed`,
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
            ? `A refusal one population keeps hitting while its peers never do points at the guidance compiled for it, not at the agent. Check how \`${surface}\` (${only.label}'s guidance surface) teaches the workflow this refusal names, amend the authored guidance source, then run \`discern refresh\`.`
            : `A page one population keeps asking for while its peers never miss points at how its compiled guidance routes it. Add or cross-link the topic (the \`discern-document-subsystem\` skill fits), and check \`${surface}\` (${only.label}'s guidance surface) routes agents there.`,
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

const dominantStage: Detector = {
  id: "dominant-stage",
  title: "One job dominating gate time",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 5 timed gate runs on the current setup before calling a job dominant.
  threshold: 5,
  next_step:
    "When one job is most of the gate's wall clock, that job sets the pace of every loop — cache it, split it, or move the slow part behind a scope gate so unrelated changes skip it.",
  detect(facts): DetectorOutcome {
    const { tail, boundary } = comparableTail(
      facts.verbs.filter((e) =>
        e.verb === "done" &&
        (e.steps ?? []).some((s) => s.duration_s !== undefined)
      ),
      facts.events,
    );
    // "Considered" counts every examined run, comparable or not, so a window
    // bisected by a boundary reports the attribution instead of going quiet.
    const considered = tail.length + (boundary?.prior ?? 0);
    if (tail.length < 5) {
      return {
        considered,
        findings: boundary !== undefined && considered >= 5
          ? [attributionFinding(tail.length, boundary)]
          : [],
      };
    }
    const totals = new Map<string, number>();
    let all = 0;
    for (const e of tail) {
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
      const meanS = seconds / tail.length;
      // Half the gate AND a real cost — a 1-second gate has no dominant-stage problem.
      if (share >= 0.5 && meanS >= 10) {
        findings.push({
          subject: label,
          brief: `${formatHumanNumber(round1(meanS))}s per \`done\` · ${
            formatHumanNumber(Math.round(share * 100))
          }% of gate time · ${formatHumanNumber(tail.length)} runs`,
          observed: `\`${label}\` averages ${
            formatHumanNumber(round1(meanS))
          }s per \`done\` — ${
            formatHumanNumber(Math.round(share * 100))
          }% of all recorded gate time across ${
            formatHumanNumber(tail.length)
          } runs.`,
          evidence: {
            mean_seconds: round1(meanS),
            share_pct: Math.round(share * 100),
            runs: tail.length,
          },
          strength: Math.round(share * 100),
        });
      }
    }
    return { considered, findings };
  },
};

const durationCreep: Detector = {
  id: "duration-creep",
  title: "Gate duration creeping up",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 8 runs on one setup: two halves of 4 are the fewest medians worth comparing.
  threshold: 8,
  next_step:
    "The gate got slower on an unchanged setup — find what grew (test count, build cache misses, an input set that widened) before the extra seconds tax every loop.",
  detect(facts): DetectorOutcome {
    const { tail, boundary } = comparableTail(
      facts.verbs.filter((e) => e.verb === "done"),
      facts.events,
    );
    const considered = tail.length + (boundary?.prior ?? 0);
    if (tail.length < 8) {
      return {
        considered,
        findings: boundary !== undefined && considered >= 8
          ? [attributionFinding(tail.length, boundary)]
          : [],
      };
    }
    const half = Math.floor(tail.length / 2);
    const earlier = tail.slice(0, half);
    const later = tail.slice(tail.length - half);
    const durEarly = median(earlier.map((e) => e.duration_ms)) / 1000;
    const durLate = median(later.map((e) => e.duration_ms)) / 1000;
    const sizeEarly = median(earlier.map((e) => e.change?.files ?? 0));
    const sizeLate = median(later.map((e) => e.change?.files ?? 0));
    const findings: DetectorFinding[] = [];
    // Half again slower, and not because the changes themselves grew.
    if (
      durEarly > 0 && durLate >= durEarly * 1.5 &&
      sizeLate <= Math.max(sizeEarly, 1) * 1.25
    ) {
      findings.push({
        brief: `${formatHumanNumber(round1(durEarly))}s → ${
          formatHumanNumber(round1(durLate))
        }s median · ${formatHumanNumber(tail.length)} runs`,
        observed: `median \`done\` duration rose from ${
          formatHumanNumber(round1(durEarly))
        }s to ${formatHumanNumber(round1(durLate))}s across ${
          formatHumanNumber(tail.length)
        } runs on one setup (${day(earlier[0]?.at ?? "")} → ${
          day(later[later.length - 1]?.at ?? "")
        }), while the median change stayed ~${
          formatHumanNumber(Math.round(sizeLate))
        } files.`,
        evidence: {
          median_early_s: round1(durEarly),
          median_late_s: round1(durLate),
          runs: tail.length,
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
  // 10 runs: a fixer's value shows rarely by design, so the bar to call it
  // idle is the highest in the registry.
  threshold: 10,
  next_step:
    "If the fixers never change anything the agents didn't already do, the stage is paying rent without working — check whether it still earns its place in the inner loop, or belongs in `done` alone.",
  detect(facts): DetectorOutcome {
    const { tail, boundary } = comparableTail(
      facts.verbs.filter((e) =>
        (e.verb === "done" || e.verb === "prepare") &&
        stageSeconds(e, "Fix") !== undefined
      ),
      facts.events,
    );
    const considered = tail.length + (boundary?.prior ?? 0);
    if (tail.length < 10) {
      return {
        considered,
        findings: boundary !== undefined && considered >= 10
          ? [attributionFinding(tail.length, boundary)]
          : [],
      };
    }
    const fixLabels = new Set(
      tail.flatMap((e) =>
        (e.steps ?? []).filter((s) => s.group === "Fix").map((s) => s.label)
      ),
    );
    const anyEffect = tail.some((e) =>
      e.failed_stage === "fix" || e.failed_stage === "tree_drift" ||
      (e.diagnostics ?? []).some((d) => fixLabels.has(d.tool)) ||
      (e.steps ?? []).some((s) =>
        s.group === "Fix" && (s.error_like_lines ?? 0) > 0
      )
    );
    const meanS =
      tail.reduce((sum, e) => sum + (stageSeconds(e, "Fix") ?? 0), 0) /
      tail.length;
    const findings: DetectorFinding[] = [];
    if (!anyEffect && meanS >= 3) {
      findings.push({
        brief: `${formatHumanNumber(round1(meanS))}s per run · ${
          formatHumanNumber(tail.length)
        } runs · no visible effect`,
        observed: `the fix stage (${[...fixLabels].sort().join(", ")}) cost ~${
          formatHumanNumber(round1(meanS))
        }s per run across ${
          formatHumanNumber(tail.length)
        } runs with no visible effect: no fix failures, no tree drift, no diagnostics.`,
        evidence: { mean_seconds: round1(meanS), runs: tail.length },
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
    "A rule that trips every effort is a project-level gap, and a guard beats a memory: teach it in guidance (`discern-teach-the-project`), or change the config so the class can't recur — the `discern-cure-a-bug` skill walks that conversion.",
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
        brief: `${formatHumanNumber(c.branches.size)} branches · ${
          formatHumanNumber(c.count)
        } diagnostics`,
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

const sameTreeFlake: Detector = {
  id: "same-tree-flake",
  title: "Divergent outcomes on one tree",
  family: "gate-fit",
  scope: "project",
  tier: "batch",
  tone: "attention",
  // 2 repeat runs of some exact tree — the smallest set that can diverge.
  threshold: 2,
  next_step:
    "A test that flips verdict on an identical tree is flaky. Diagnose the test itself (`discern-cure-a-bug`, diagnose procedure); quarantining it beats retrying until green, which teaches agents that red is negotiable.",
  detect(facts): DetectorOutcome {
    const gateRuns = facts.verbs.filter((e) =>
      e.verb === "done" || e.verb === "test"
    );
    const byTree = new Map<string, VerbEvent[]>();
    for (const e of gateRuns) {
      if (e.head === null) {
        continue;
      }
      // `head` alone identifies a clean tree; `head` + the dirty-diff
      // fingerprint identifies the same dirty tree across runs.
      if (e.clean === false && e.tree === undefined) {
        continue;
      }
      const key = `${e.head} ${e.tree ?? ""}`;
      const group = byTree.get(key);
      if (group === undefined) {
        byTree.set(key, [e]);
      } else {
        group.push(e);
      }
    }
    const repeats = [...byTree.values()].filter((g) => g.length >= 2);
    const findings: DetectorFinding[] = [];
    for (const group of repeats) {
      const red = group.filter(testRed).length;
      const green = group.filter((e) => e.outcome === "ok").length;
      const head = group[0]?.head ?? "?";
      if (red > 0 && green > 0) {
        findings.push({
          subject: head,
          brief: `${formatHumanNumber(red)} red · ${
            formatHumanNumber(green)
          } green on one tree`,
          observed: `the exact same tree at \`${head}\` ran ${
            formatHumanNumber(red)
          } test-red and ${formatHumanNumber(green)} green across ${
            formatHumanNumber(group.length)
          } runs with no change in between.`,
          evidence: { runs: group.length, red, green },
          strength: (red + green) * 10,
        });
      }
    }
    findings.sort((a, b) => b.strength - a.strength);
    return {
      considered: repeats.reduce((sum, g) => sum + g.length, 0),
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
    "A high loop count on a small change points at guesswork — a falsifying diagnosis loop (`discern-cure-a-bug`, diagnose procedure) is a cheaper probe than the full gate.",
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
          brief: `${formatHumanNumber(reds)} red runs · ${
            formatHumanNumber(files)
          }-file change · ${formatHumanNumber(perFile)} per file`,
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
        brief: clauses.join(" · "),
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
    "Long cycles usually mean oversized tasks. Splitting the ask into smaller, sharply-scoped briefs lands faster, and smaller landings merge cleaner for everyone behind them.",
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
        brief: `${formatHumanNumber(cycles.length)} cycles · median ${
          formatHumanNumber(round1(median(cycles)))
        }h · longest ${formatHumanNumber(round1(Math.max(...cycles)))}h`,
        observed: `${
          formatHumanNumber(cycles.length)
        } completed start-to-accept cycles: median ${
          formatHumanNumber(round1(median(cycles)))
        }h, longest ${formatHumanNumber(round1(Math.max(...cycles)))}h.`,
        evidence: {
          cycles: cycles.length,
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
    "One giant commit hides the steps that built it — atomic commits make review tractable and selective reverts possible. Ask for them in guidance; agents follow what the repo teaches.",
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
          brief: `${formatHumanNumber(lines)} changed lines · ${
            formatHumanNumber(change.files)
          } files · 1 commit`,
          observed:
            `\`${e.branch}\` reached green as a single commit carrying ${
              formatHumanNumber(lines)
            } changed lines across ${formatHumanNumber(change.files)} files.`,
          evidence: {
            commits: 1,
            changed_lines: lines,
            files: change.files,
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
  // 6 updates on one setup: halves of 3 are the fewest worth comparing.
  threshold: 6,
  next_step:
    "Rising behind-counts and overlap mean efforts are outliving the trunk's pace — update earlier in the task, and land smaller so each merge brings less in.",
  detect(facts): DetectorOutcome {
    const { tail, boundary } = comparableTail(
      facts.verbs.filter((e) =>
        e.verb === "update" && e.update !== undefined && e.outcome === "ok"
      ),
      facts.events,
    );
    const considered = tail.length + (boundary?.prior ?? 0);
    if (tail.length < 6) {
      return {
        considered,
        findings: boundary !== undefined && considered >= 6
          ? [attributionFinding(tail.length, boundary)]
          : [],
      };
    }
    const half = Math.floor(tail.length / 2);
    const earlier = tail.slice(0, half);
    const later = tail.slice(tail.length - half);
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
        brief: `behind ${formatHumanNumber(behindEarly)} → ${
          formatHumanNumber(behindLate)
        } · overlap ${formatHumanNumber(overlapEarly)} → ${
          formatHumanNumber(overlapLate)
        } · ${formatHumanNumber(tail.length)} updates`,
        observed: `across ${
          formatHumanNumber(tail.length)
        } updates, the median behind-count moved ${
          formatHumanNumber(behindEarly)
        } → ${formatHumanNumber(behindLate)} and overlapping files ${
          formatHumanNumber(overlapEarly)
        } → ${formatHumanNumber(overlapLate)}.`,
        evidence: {
          updates: tail.length,
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
    "Read each metric's line against its limit's own history — pins should track sustained gains, and a value drifting toward its limit deserves attention before it fails.",
  detect(facts): DetectorOutcome {
    interface Reading {
      at: string;
      value: number;
      limit: number | undefined;
      direction: string | undefined;
      epoch: string | null;
      writer: string | undefined;
    }
    const series = new Map<string, Reading[]>();
    for (const e of facts.verbs) {
      for (const s of e.standards ?? []) {
        if (s.value === undefined) {
          continue;
        }
        const list = series.get(s.name) ?? [];
        list.push({
          at: e.at,
          value: s.value,
          limit: s.limit,
          direction: s.direction,
          epoch: e.epoch,
          writer: e.writer,
        });
        series.set(s.name, list);
      }
    }
    const pins = facts.events.filter(
      (e): e is Extract<LogbookEvent, { kind: "pin" }> => e.kind === "pin",
    );
    let considered = 0;
    const findings: DetectorFinding[] = [];
    for (const [name, readings] of [...series.entries()].sort()) {
      considered += readings.length;
      if (readings.length < 5) {
        continue;
      }
      const first = readings[0];
      const last = readings[readings.length - 1];
      if (first === undefined || last === undefined) {
        continue;
      }
      const span = daysBetween(first.at, last.at);
      const ownPins = pins.filter((p) => p.standard === name);
      const firstPin = ownPins[0];
      const lastPin = ownPins[ownPins.length - 1];
      const boundaries = readings.reduce((count, r, i) => {
        const prev = readings[i - 1];
        return prev !== undefined &&
            (prev.epoch !== r.epoch || prev.writer !== r.writer)
          ? count + 1
          : count;
      }, 0);
      const pieces = [
        `\`${name}\` measured ${formatHumanNumber(first.value)} → ${
          formatHumanNumber(last.value)
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
      } else if (last.limit !== undefined) {
        pieces.push(`the limit held at ${formatHumanNumber(last.limit)}`);
      }
      if (boundaries > 0) {
        pieces.push(
          `the series crosses ${
            formatHumanNumber(boundaries)
          } config/release boundar${
            boundaries === 1 ? "y" : "ies"
          }, so ${TRAJECTORY_BOUNDARY_ATTRIBUTION}`,
        );
      }
      // Direction-aware slack: the last three readings all strictly better
      // than the limit they were held to.
      const tail3 = readings.slice(-3);
      const better = (r: Reading): boolean =>
        r.limit !== undefined &&
        (r.direction === "down"
          ? r.value < r.limit
          : r.direction === "up"
          ? r.value > r.limit
          : false);
      const slack = tail3.length === 3 && tail3.every(better);
      const headroom = (r: Reading): number | undefined =>
        r.limit === undefined
          ? undefined
          : r.direction === "down"
          ? r.limit - r.value
          : r.direction === "up"
          ? r.value - r.limit
          : undefined;
      const firstHeadroom = headroom(first);
      const lastHeadroom = headroom(last);
      const tone: PatternFindingTone = slack ||
          (firstHeadroom !== undefined && lastHeadroom !== undefined &&
            lastHeadroom > firstHeadroom)
        ? "good"
        : firstHeadroom !== undefined && lastHeadroom !== undefined &&
            lastHeadroom < firstHeadroom
        ? "attention"
        : "neutral";
      const movement = slack
        ? "beating its limit"
        : tone === "good"
        ? "improving"
        : tone === "attention"
        ? "headroom shrinking"
        : first.value === last.value
        ? "holding"
        : "changed";
      const limitWord = last.direction === "down"
        ? "ceiling"
        : last.direction === "up"
        ? "floor"
        : "limit";
      const againstLimit = last.limit === undefined
        ? ""
        : ` vs ${limitWord} ${formatHumanNumber(last.limit)}`;
      findings.push({
        subject: name,
        brief: `${formatHumanNumber(first.value)} → ${
          formatHumanNumber(last.value)
        }${againstLimit} — ${movement}`,
        tone,
        observed: `${pieces.join("; ")}.`,
        evidence: {
          readings: readings.length,
          span_days: span,
          pins: ownPins.length,
          first_value: first.value,
          last_value: last.value,
          ...(first.limit !== undefined ? { limit_first: first.limit } : {}),
          ...(last.limit !== undefined ? { limit_last: last.limit } : {}),
        },
        strength: readings.length,
        ...(slack
          ? {
            next_step:
              `\`${name}\` has measured better than its limit for the last 3 readings — capture the gain: \`discern standards --pin\`.`,
          }
          : {}),
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
    "A rising red rate is either the gate catching more or the practice degrading — read it alongside duration-creep and loops-to-green before concluding which.",
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
          failed: digest.failed ?? 0,
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
      } else if (e.outcome === "failed") {
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
      const firstRendered = rendered[0] ?? "";
      const lastRendered = rendered[rendered.length - 1] ?? "";
      findings.push({
        brief: `${firstRendered} → ${lastRendered} · ${
          formatHumanNumber(total)
        } runs`,
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
  skippedPrepare,
  dirtyDoneChurn,
  trunkEdits,
  forceHabit,
  confirmedRerun,
  docsGap,
  abandonedWorktrees,
  sequenceAnomaly,
  identityGap,
  providerFit,
  cohortDoneThrash,
  guidanceParity,
  dominantStage,
  durationCreep,
  fixStageIdle,
  recurringDiagnostic,
  sameTreeFlake,
  loopsToGreen,
  cohortLoopsToGreen,
  cycleTime,
  giantCommitLanding,
  updateFriction,
  standardTrajectory,
  redRateHistory,
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
