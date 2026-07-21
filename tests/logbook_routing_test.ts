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
  workingSurfaceFor,
} from "../src/engine/logbook/routing.ts";
import {
  DETECTOR_SCOPES,
  DETECTOR_TIERS,
  type DetectorScope,
  type DetectorTier,
} from "../src/shared/patterns_vocabulary.ts";
import type { DiscernResult } from "../src/shared/result.ts";

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

Deno.test("logbook routing: advisory attachment can change only hints on an envelope", () => {
  const result: DiscernResult<{
    failed_stage: "check/test" | null;
    gate_receipt: { status: "recorded" };
  }> = {
    ok: false,
    verb: "done",
    dry_run: false,
    error: "gate_failed",
    message: "tests failed",
    steps: [{
      step: { kind: "job", label: "test", disposition: "run" },
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
      gate_receipt: { status: "recorded" },
    },
    hints: ["existing"],
  };
  const before = structuredClone(result);

  addAdvisoryHints(result, ["logbook observation"]);

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
