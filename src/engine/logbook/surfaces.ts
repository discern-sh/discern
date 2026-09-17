/**
 * Bounded readers and presentation for findings that reach working surfaces.
 * The detector registry and `routing.ts` own eligibility; this module gathers a
 * recent event tail, runs inline detectors only, and turns the routed evidence
 * into the terse hints/data each consumer carries.
 */

import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import type { PatternsFinding } from "../../shared/patterns_vocabulary.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import {
  buildStreamFacts,
  DETECTORS,
  runDetector,
  type StreamFacts,
} from "./detectors.ts";
import { readRecentLogbookStream } from "./read.ts";
import type { MergeAttempt } from "../../shared/merge_observation.ts";
import {
  mergeConflictOutcome,
  recurringMergeConflicts,
} from "./merge_conflicts.ts";
import {
  type FindingRoutes,
  routeDetectorReports,
  type RoutedFinding,
  routedFindingData,
} from "./routing.ts";

/** Maximum parsed events any working surface lets inline detectors inspect. */
export const INLINE_EVENT_LIMIT = 200;

/**
 * Unsolicited proof evidence must clear the detector's own threshold plus
 * one qualifying event. The asked-for `patterns` report speaks at the registry
 * threshold; the gate tail waits for one more observation before interrupting.
 */
export const PROOF_EVIDENCE_MARGIN = 1;

/** Status keeps its logbook additions short beside live repository advice. */
const STATUS_FINDING_CAP = 3;

/** Include the current observed failure without waiting for invocation completion. */
export async function mergeConflictHints(
  root: string,
  config: DiscernConfig,
  current: MergeAttempt,
): Promise<FiredHint[]> {
  if (current.outcome !== "conflict") return [];
  return await withInlineFacts(root, config, [], (facts) => {
    const report = mergeConflictOutcome(facts.verbs, current);
    if (report.considered < recurringMergeConflicts.threshold) return [];
    const paths = new Set(
      current.conflicts.filter((entry) => !entry.generated)
        .map((entry) => entry.path),
    );
    return report.findings.filter((finding) =>
      finding.subject !== undefined && paths.has(finding.subject)
    ).slice(0, 1).map((finding) =>
      fire(HINTS["logbook-merge-conflict-finding"], {
        observed: finding.observed,
        next: finding.next_step ?? recurringMergeConflicts.next_step,
      })
    );
  });
}

/** Empty routes for a disabled, absent, or unreadable logbook. */
function emptyRoutes(): FindingRoutes {
  return routeDetectorReports([]);
}

/**
 * Run only inline detectors over the bounded recent tail. Best-effort by
 * construction: a missing repository, unreadable logbook, or reader failure
 * advises nothing and can never affect the calling verb.
 */
export async function inlineFindingRoutes(
  root: string,
  config: DiscernConfig,
): Promise<FindingRoutes> {
  return await withInlineFacts(root, config, emptyRoutes(), (facts) => {
    const reports = DETECTORS.filter((detector) => detector.tier === "inline")
      .map((detector) => runDetector(detector, facts));
    return routeDetectorReports(reports);
  });
}

/** Every unsolicited reader shares the same bounded, non-interfering history read. */
async function withInlineFacts<T>(
  root: string,
  config: DiscernConfig,
  fallback: T,
  read: (facts: StreamFacts) => T,
): Promise<T> {
  if (!config.project.record_logbook) {
    return fallback;
  }
  try {
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir === undefined) {
      return fallback;
    }
    const stream = await readRecentLogbookStream(
      commonGitDir,
      INLINE_EVENT_LIMIT,
    );
    const facts = buildStreamFacts(
      stream.events,
      config.repository.trunk,
      resolveConfiguredAgents(config),
    );
    return read(facts);
  } catch {
    return fallback;
  }
}

/** Whether a scoped finding can be attributed to the current branch. */
function matchesBranch(
  routed: RoutedFinding,
  branch: string | undefined,
): boolean {
  return routed.finding.subject === undefined ||
    (branch !== undefined && routed.finding.subject === branch);
}

/** Keep an advisory hint one physical line even if detector prose evolves. */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * The proof-tail advisory: zero or one hint, with a count, the strongest
 * current-branch summary, and the asked-for verb that carries full detail.
 */
export function proofFindingHints(
  findings: readonly RoutedFinding[],
  branch: string,
): FiredHint[] {
  const eligible = findings.filter((routed) =>
    routed.finding.subject === branch &&
    routed.considered >=
      routed.detector.threshold + PROOF_EVIDENCE_MARGIN
  );
  const strongest = eligible[0];
  if (strongest === undefined) {
    return [];
  }
  const count = eligible.length;
  return [
    fire(HINTS["logbook-proof-finding"], {
      count,
      summary: oneLine(strongest.finding.summary),
    }),
  ];
}

/** Session-scoped status hints, each as summary plus the registry next step. */
export function statusFindingHints(
  findings: readonly RoutedFinding[],
  branch: string | undefined,
): FiredHint[] {
  return findings
    .filter((routed) => matchesBranch(routed, branch))
    .slice(0, STATUS_FINDING_CAP)
    .map((routed) => {
      const next = routed.finding.next_step ?? routed.detector.next_step;
      return fire(HINTS["logbook-status-finding"], {
        summary: oneLine(routed.finding.summary),
        next: oneLine(next),
      });
    });
}

/** Ranked project findings in the same evidence-bearing shape as `patterns`. */
export function improvementFindingData(
  findings: readonly RoutedFinding[],
): PatternsFinding[] {
  return findings.map(routedFindingData);
}
