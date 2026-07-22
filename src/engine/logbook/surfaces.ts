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
import { buildStreamFacts, DETECTORS, runDetector } from "./detectors.ts";
import { readRecentLogbookStream } from "./read.ts";
import {
  type FindingRoutes,
  routeDetectorReports,
  type RoutedFinding,
  routedFindingData,
} from "./routing.ts";

/** Maximum parsed events any working surface lets inline detectors inspect. */
export const INLINE_EVENT_LIMIT = 200;

/**
 * Unsolicited receipt evidence must clear the detector's own threshold plus
 * one qualifying event. The asked-for `patterns` report speaks at the registry
 * threshold; the gate tail waits for one more observation before interrupting.
 */
export const RECEIPT_EVIDENCE_MARGIN = 1;

/** Status keeps its logbook additions short beside live repository advice. */
const STATUS_FINDING_CAP = 3;

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
  if (!config.project.logbook) {
    return emptyRoutes();
  }
  try {
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir === undefined) {
      return emptyRoutes();
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
    const reports = DETECTORS.filter((detector) => detector.tier === "inline")
      .map((detector) => runDetector(detector, facts));
    return routeDetectorReports(reports);
  } catch {
    return emptyRoutes();
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
 * The receipt-tail advisory: zero or one hint, with a count, the strongest
 * current-branch observation, and the asked-for verb that carries full detail.
 */
export function receiptFindingHints(
  findings: readonly RoutedFinding[],
  branch: string,
): FiredHint[] {
  const eligible = findings.filter((routed) =>
    routed.finding.subject === branch &&
    routed.considered >=
      routed.detector.threshold + RECEIPT_EVIDENCE_MARGIN
  );
  const strongest = eligible[0];
  if (strongest === undefined) {
    return [];
  }
  const count = eligible.length;
  return [
    fire(HINTS["logbook-receipt-finding"], {
      count,
      observed: oneLine(strongest.finding.observed),
    }),
  ];
}

/** Session-scoped status hints, each as observation plus the registry next step. */
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
        observed: oneLine(routed.finding.observed),
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
