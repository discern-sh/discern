/**
 * The finding-routing policy fixed by ADR 0160. Every detector finding reaches
 * `patterns`. A finding may also reach one working surface when its detector is
 * inline: branch -> `done`, session -> `status`, project -> `improvement`.
 * Batch findings stop at `patterns`, which is the only verb allowed to pay for
 * longitudinal analysis.
 *
 * Keep this module pure. Readers run detectors and gather their own bounded
 * event window; this seam only decides where the resulting evidence belongs.
 */

import type { DiscernResult } from "../../shared/result.ts";
import { appendHintTexts, type FiredHint } from "../../shared/hints.ts";
import type {
  DetectorScope,
  DetectorTier,
  PatternsFinding,
} from "../../shared/patterns_vocabulary.ts";
import type { Detector, DetectorFinding, DetectorReport } from "./detectors.ts";

/** Working surfaces that receive unsolicited findings. */
export type WorkingFindingSurface = "done" | "status" | "improvement";

/** One finding with the registry declaration and denominator that produced it. */
export interface RoutedFinding {
  detector: Detector;
  finding: DetectorFinding;
  considered: number;
}

/** Every destination, including the asked-for `patterns` report. */
export interface FindingRoutes {
  patterns: RoutedFinding[];
  done: RoutedFinding[];
  status: RoutedFinding[];
  improvement: RoutedFinding[];
}

/** The one policy matrix for unsolicited surfaces. */
export function workingSurfaceFor(
  tier: DetectorTier,
  scope: DetectorScope,
): WorkingFindingSurface | undefined {
  if (tier === "batch") {
    return undefined;
  }
  switch (scope) {
    case "branch":
      return "done";
    case "session":
      return "status";
    case "project":
      return "improvement";
  }
}

/** Strongest evidence first, with the stable detector id breaking ties. */
function rank(a: RoutedFinding, b: RoutedFinding): number {
  return b.finding.strength - a.finding.strength ||
    a.detector.id.localeCompare(b.detector.id);
}

/** Route every finding produced by a detector run through the policy matrix. */
export function routeDetectorReports(
  reports: readonly DetectorReport[],
): FindingRoutes {
  const routes: FindingRoutes = {
    patterns: [],
    done: [],
    status: [],
    improvement: [],
  };
  for (const report of reports) {
    for (const finding of report.findings) {
      const routed: RoutedFinding = {
        detector: report.detector,
        finding,
        considered: report.considered,
      };
      routes.patterns.push(routed);
      const working = workingSurfaceFor(
        report.detector.tier,
        report.detector.scope,
      );
      if (working !== undefined) {
        routes[working].push(routed);
      }
    }
  }
  routes.patterns.sort(rank);
  routes.done.sort(rank);
  routes.status.sort(rank);
  routes.improvement.sort(rank);
  return routes;
}

/** Convert one routed finding to the shared wire vocabulary. */
export function routedFindingData(routed: RoutedFinding): PatternsFinding {
  const finding = routed.finding;
  return {
    detector: routed.detector.id,
    family: routed.detector.family,
    scope: routed.detector.scope,
    tone: finding.tone ?? routed.detector.tone,
    ...(finding.subject !== undefined ? { subject: finding.subject } : {}),
    summary: finding.summary,
    // Published compatibility alias. One canonical authoring field prevents
    // compact consumers from drifting into a second claim.
    brief: finding.summary,
    ...(finding.series !== undefined ? { series: finding.series } : {}),
    observed: finding.observed,
    evidence: finding.evidence,
    ...(finding.basis !== undefined ? { basis: finding.basis } : {}),
    strength: finding.strength,
    next_step: finding.next_step ?? routed.detector.next_step,
  };
}

/**
 * Attach advisory text to the envelope's only advisory channel. This helper's
 * narrow write surface is guarded in `logbook_routing_test.ts`: outcome,
 * diagnostics, failed stage, proof data, and every other field are preserved.
 */
export function addAdvisoryHints<T>(
  result: DiscernResult<T>,
  hints: readonly FiredHint[],
): void {
  if (hints.length === 0) {
    return;
  }
  result.hints = appendHintTexts(result.hints, hints);
}
