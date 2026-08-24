/**
 * Unit coverage for the canary audit's pure core: per-file aggregation from
 * Logbook evidence, hottest-first ranking, and the two drift directions the
 * report names (uncovered hot files, extras with no record left).
 */

import { assert, assertEquals } from "@std/assert";
import {
  auditCanary,
  CANDIDATE_RED_RUNS,
  rankTestFailures,
  type TestFailureEvidence,
} from "../scripts/canary_audit.ts";
import { CANARY_EXTRA_TEST_FILES } from "../scripts/canary_registry.ts";

/** A verb event carrying the given test diagnostics, for ranking input. */
function redRun(
  at: string,
  diagnostics: TestFailureEvidence["diagnostics"],
): TestFailureEvidence {
  return { kind: "verb", at, diagnostics };
}

Deno.test("ranking aggregates red runs and cases per attributable file", () => {
  const ranking = rankTestFailures([
    { kind: "begin", at: "2026-08-01T00:00:00Z" },
    redRun("2026-08-02T00:00:00Z", [
      { tool: "test", file: "tests/a_test.ts", count: 3 },
      { tool: "test", file: "tests/a_test.ts" },
      { tool: "test", file: "tests/b_test.ts" },
      { tool: "lint", file: "tests/a_test.ts" },
      { tool: "test" },
    ]),
    redRun("2026-08-03T00:00:00Z", [
      { tool: "test", file: "tests/a_test.ts" },
    ]),
  ]);
  assertEquals(ranking, [
    {
      file: "tests/a_test.ts",
      redRuns: 2,
      cases: 5,
      lastAt: "2026-08-03T00:00:00Z",
    },
    {
      file: "tests/b_test.ts",
      redRuns: 1,
      cases: 1,
      lastAt: "2026-08-02T00:00:00Z",
    },
  ]);
});

Deno.test("ranking breaks red-run ties by cases, then by file name", () => {
  const ranking = rankTestFailures([
    redRun("2026-08-01T00:00:00Z", [
      { tool: "test", file: "tests/b_test.ts", count: 4 },
      { tool: "test", file: "tests/c_test.ts" },
      { tool: "test", file: "tests/a_test.ts" },
    ]),
  ]);
  assertEquals(
    ranking.map((r) => r.file),
    ["tests/b_test.ts", "tests/a_test.ts", "tests/c_test.ts"],
  );
});

Deno.test("audit names uncovered hot files and spares members and refusals", () => {
  const hot = { redRuns: CANDIDATE_RED_RUNS, cases: 9, lastAt: "2026-08-03" };
  const findings = auditCanary(
    [
      { file: "tests/uncovered_test.ts", ...hot },
      { file: "tests/member_test.ts", ...hot },
      // A recorded refusal from the registry: settled, never re-nominated.
      { file: "tests/cli_test.ts", ...hot },
      { file: "tests/warm_test.ts", ...hot, redRuns: CANDIDATE_RED_RUNS - 1 },
    ],
    new Set(["tests/member_test.ts"]),
  );
  assertEquals(
    findings.candidates.map((r) => r.file),
    ["tests/uncovered_test.ts"],
  );
});

Deno.test("audit reports extras with no failure record left", () => {
  assert(CANARY_EXTRA_TEST_FILES.length > 0, "the fixture needs a real extra");
  const first = CANARY_EXTRA_TEST_FILES[0];
  assert(first !== undefined);
  const findings = auditCanary(
    [{ file: first.file, redRuns: 1, cases: 1, lastAt: "2026-08-01" }],
    new Set([first.file]),
  );
  assertEquals(
    findings.quietExtras,
    CANARY_EXTRA_TEST_FILES.slice(1).map((e) => e.file),
  );
});
