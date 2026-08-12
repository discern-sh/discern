/**
 * The logbook finding-routing guard. ADR 0160 fixes one policy matrix: every
 * detector always belongs in `patterns`; outside that verb only inline
 * detectors may speak, and their scope selects exactly one working surface.
 *
 * The registry-driven half makes a newly added detector auto-enrol. The full
 * tier/scope matrix also covers combinations the current registry may not yet
 * contain, so no empty cell can acquire an accidental route later.
 */

import { assertEquals } from "@std/assert";
import {
  type DetectorReport,
  DETECTORS,
} from "../src/engine/logbook/detectors.ts";
import {
  addAdvisoryHints,
  routeDetectorReports,
  routedFindingData,
  workingSurfaceFor,
} from "../src/engine/logbook/routing.ts";
import {
  DETECTOR_SCOPES,
  DETECTOR_TIERS,
  type DetectorScope,
  type DetectorTier,
} from "../src/shared/patterns_vocabulary.ts";
import { type DiscernResult, verbatimStepLabel } from "../src/shared/result.ts";

const POLICY: Record<
  DetectorTier,
  Record<DetectorScope, "done" | "status" | "improvement" | undefined>
> = {
  inline: {
    branch: "done",
    session: "status",
    project: "improvement",
  },
  batch: {
    branch: undefined,
    session: undefined,
    project: undefined,
  },
};

Deno.test("logbook routing: every tier/scope combination has the ADR 0160 route", () => {
  for (const tier of DETECTOR_TIERS) {
    for (const scope of DETECTOR_SCOPES) {
      assertEquals(
        workingSurfaceFor(tier, scope),
        POLICY[tier][scope],
        `${tier}/${scope}`,
      );
    }
  }
});

Deno.test("logbook routing: every registry finding lands on patterns and exactly its allowed working surface", () => {
  const reports: DetectorReport[] = DETECTORS.map((detector) => ({
    detector,
    status: "fired",
    considered: detector.threshold,
    findings: [{
      brief: `${detector.id} brief`,
      observed: `${detector.id} fired.`,
      evidence: { events: detector.threshold },
      strength: detector.threshold,
    }],
  }));

  const routes = routeDetectorReports(reports);
  const surfaces = ["done", "status", "improvement"] as const;
  for (const detector of DETECTORS) {
    assertEquals(
      routes.patterns.filter((r) => r.detector.id === detector.id).length,
      1,
      `${detector.id} must always reach patterns`,
    );
    const expected = POLICY[detector.tier][detector.scope];
    for (const surface of surfaces) {
      assertEquals(
        routes[surface].filter((r) => r.detector.id === detector.id).length,
        surface === expected ? 1 : 0,
        `${detector.id} must ${
          surface === expected ? "reach" : "skip"
        } ${surface}`,
      );
    }
  }
});

Deno.test("logbook routing: the optional trajectory series reaches the wire unchanged", () => {
  const detector = DETECTORS.find((entry) =>
    entry.id === "standard-trajectory"
  );
  assertEquals(detector?.id, "standard-trajectory");
  if (detector === undefined) {
    return;
  }
  const series = [1, 2, 1];
  const finding = routedFindingData({
    detector,
    considered: series.length,
    finding: {
      subject: "coverage",
      brief: "1 → 1 vs floor 0 — holding",
      series,
      observed: "`coverage` measured 1 → 1 across 3 readings.",
      evidence: { readings: series.length },
      strength: series.length,
    },
  });
  assertEquals(finding.series, series);
});

Deno.test("logbook routing: the additive evidence basis reaches wire and inline projections unchanged", () => {
  const detector = DETECTORS.find((entry) => entry.id === "same-tree-flake");
  assertEquals(detector?.id, "same-tree-flake");
  if (detector === undefined) return;
  const basis = {
    kind: "complete-validation-state",
    coverage: { comparable: 2, denominator: 2, unit: "job-runs" },
    validation_state: { version: 1, complete: true },
    matched_conditions: [{
      dimension: "execution-mode",
      values: ["standalone-test"],
      distinct: 1,
      omitted: 0,
    }],
    differing_conditions: [],
    legacy_events: 0,
    excluded_events: 0,
    limitations: ["External context was not recorded."],
    values: {
      runs: { value: 2, kind: "observed" as const },
    },
  };
  const finding = routedFindingData({
    detector,
    considered: 2,
    finding: {
      subject: "test",
      brief: "1 red · 1 green",
      observed: "The recorded job changed verdict.",
      evidence: { runs: 2 },
      basis,
      strength: 20,
    },
  });
  assertEquals(finding.basis, basis);
});

Deno.test("logbook routing: advisory attachment can change only hints on an envelope", () => {
  const result: DiscernResult<{
    failed_stage: "check/test" | null;
    gate_proof: { status: "recorded" };
  }> = {
    ok: false,
    verb: "done",
    dry_run: false,
    error: "gate_failed",
    message: "tests failed",
    steps: [{
      step: {
        kind: "job",
        label: verbatimStepLabel("test"),
        disposition: "run",
      },
      outcome: "failed",
    }],
    diagnostics: [{
      tool: "test",
      severity: "error",
      message: "test failed",
      reproduce_cmd: "false",
    }],
    data: {
      failed_stage: "check/test",
      gate_proof: { status: "recorded" },
    },
    hints: ["existing"],
  };
  const before = structuredClone(result);

  addAdvisoryHints(result, [{
    id: "test-logbook-observation",
    text: "logbook observation",
  }]);

  const afterWithoutHints = structuredClone(result);
  const beforeWithoutHints = structuredClone(before);
  delete afterWithoutHints.hints;
  delete beforeWithoutHints.hints;
  assertEquals(
    afterWithoutHints,
    beforeWithoutHints,
    "the routing seam may mutate only hints",
  );
  assertEquals(result.hints, ["existing", "logbook observation"]);
});
