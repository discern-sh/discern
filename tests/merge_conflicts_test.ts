import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildStreamFacts,
  runDetector,
} from "../src/engine/logbook/detectors.ts";
import type { MergeAttempt } from "../src/shared/merge_observation.ts";
import {
  detector,
  mergeAttempt as attempt,
  verb,
} from "./patterns_event_fixtures.ts";

/** Run the registered detector on observed attempts, never error-message prose. */
function finding(attempts: MergeAttempt[]): ReturnType<typeof runDetector> {
  return runDetector(
    detector("recurring-merge-conflicts"),
    buildStreamFacts(
      attempts.map((entry) =>
        verb({
          verb: entry.route,
          merges: { version: 1, attempts: [entry], omitted: 0 },
        })
      ),
      "main",
    ),
  );
}

Deno.test("recurring merge conflicts identify an arbitrary path across routes and efforts", () => {
  const report = finding([
    attempt(1),
    attempt(2, { route: "accept" }),
    attempt(3),
    attempt(4, { outcome: "merged", conflicts: [] }),
  ]);
  assertEquals(report.status, "fired");
  assertEquals(report.findings[0]?.subject, "records/pending.md");
  assertStringIncludes(report.findings[0]?.observed ?? "", "3 of 4");
  assertStringIncludes(report.findings[0]?.observed ?? "", "2 efforts");
});

Deno.test("unchanged retries across update and acceptance count once", () => {
  const report = finding([
    attempt(1),
    attempt(1),
    attempt(1, { route: "accept" }),
    attempt(2),
    attempt(2, { route: "accept" }),
  ]);
  assertEquals(report.status, "insufficient-evidence");
  assertEquals(report.considered, 2);
});

Deno.test("a single effort and generated conflicts do not establish a shared authored hotspot", () => {
  assertEquals(
    finding([1, 2, 3].map((i) => attempt(i, { effort: "agent/only" })))
      .findings,
    [],
  );
  assertEquals(
    finding([1, 2, 3].map((i) =>
      attempt(i, {
        conflicts: [{ path: "derived/catalog.txt", generated: true }],
      })
    )).findings,
    [],
  );
});

Deno.test("unknown revisions and incomplete path lists remain outside the denominator", () => {
  const report = finding([
    attempt(1),
    attempt(2),
    attempt(3, { head: null }),
    attempt(4, { paths_omitted: 1 }),
  ]);
  assertEquals(report.status, "insufficient-evidence");
  assertEquals(report.considered, 2);
});

Deno.test("contradictory outcomes for the same revision pair stay unresolved", () => {
  const report = finding([
    attempt(1),
    attempt(2),
    attempt(3),
    attempt(3, { outcome: "merged", conflicts: [] }),
  ]);
  assertEquals(report.status, "insufficient-evidence");
  assertEquals(report.considered, 2);
});
