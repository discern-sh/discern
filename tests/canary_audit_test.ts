/** Canary history is identified evidence for review, never a defect count or membership authority. */
import { assert, assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { withTempDir } from "./temp_dir.ts";
import {
  auditCanary,
  CANDIDATE_RED_RUNS,
  rankTestFailures,
  type TestFailureEvidence,
} from "../scripts/canary_audit.ts";
import { CANARY_EXTRA_TEST_FILES } from "../scripts/canary_registry.ts";
import { LOGBOOK_SCHEMA_VERSION } from "../src/engine/logbook/schema.ts";

/** A completed native test verdict with the invocation identity that deduplication needs. */
function redRun(
  at: string,
  diagnostics: TestFailureEvidence["diagnostics"],
): TestFailureEvidence {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    kind: "verb",
    at,
    invocation: at,
    verb: "done",
    surface: "cli",
    branch: "effort",
    head: "head",
    clean: true,
    outcome: "failed",
    duration_ms: 1,
    epoch: "epoch",
    steps: [{ kind: "job", label: "test", outcome: "failed", duration_ms: 1 }],
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

Deno.test("ranking counts identified failing invocations and diagnostic rows without expanding samples", () => {
  const first = redRun("2026-08-02T00:00:00Z", [
    { tool: "test", file: "tests/a_test.ts", count: 300 },
    { tool: "test", file: "tests/a_test.ts" },
    { tool: "test", file: "tests/b_test.ts" },
    { tool: "lint", file: "tests/a_test.ts" },
    { tool: "test" },
  ]);
  const ranking = rankTestFailures([
    { ...first, kind: "begin", invocation: first.at, driver: {} },
    first,
    first,
    redRun("2026-08-03T00:00:00Z", [{ tool: "test", file: "tests/a_test.ts" }]),
  ]);
  assertEquals(ranking, [
    {
      file: "tests/a_test.ts",
      redRuns: 2,
      diagnosticRows: 3,
      lastAt: "2026-08-03T00:00:00Z",
    },
    {
      file: "tests/b_test.ts",
      redRuns: 1,
      diagnosticRows: 1,
      lastAt: "2026-08-02T00:00:00Z",
    },
  ]);
});

Deno.test("unidentified, contradictory, cancelled and incomplete test observations cannot nominate a canary", () => {
  const failed = redRun("2026-08-02T00:00:00Z", [{
    tool: "test",
    file: "tests/a_test.ts",
  }]);
  const { invocation: _invocation, ...unidentified } = failed;
  assertEquals(rankTestFailures([unidentified]), []);
  for (
    const outcome of ["cancelled", "unrun", "skipped", "stale", "ok"] as const
  ) {
    const changed = {
      ...failed,
      steps: [{ kind: "job" as const, label: "test", outcome, duration_ms: 1 }],
    };
    assertEquals(rankTestFailures([changed]), []);
    assertEquals(rankTestFailures([failed, changed]), []);
  }
  assertEquals(rankTestFailures([{ ...failed, steps: [] }]), []);
});

Deno.test("ranking breaks equal invocation counts by file name instead of sampled diagnostics", () => {
  const ranking = rankTestFailures([redRun("2026-08-01T00:00:00Z", [
    { tool: "test", file: "tests/b_test.ts", count: 400 },
    { tool: "test", file: "tests/c_test.ts" },
    { tool: "test", file: "tests/a_test.ts" },
  ])]);
  assertEquals(ranking.map((row) => row.file), [
    "tests/a_test.ts",
    "tests/b_test.ts",
    "tests/c_test.ts",
  ]);
});

Deno.test("audit nominates current uncovered hot files while preserving members, refusals and missing paths", () => {
  const hot = {
    redRuns: CANDIDATE_RED_RUNS,
    diagnosticRows: 9,
    lastAt: "2026-08-03",
  };
  const findings = auditCanary(
    [
      { file: "tests/uncovered_test.ts", ...hot },
      { file: "tests/member_test.ts", ...hot },
      { file: "tests/cli_test.ts", ...hot },
      { file: "tests/removed_test.ts", ...hot },
      { file: "tests/warm_test.ts", ...hot, redRuns: CANDIDATE_RED_RUNS - 1 },
    ],
    new Set(["tests/member_test.ts"]),
    new Set([
      "tests/uncovered_test.ts",
      "tests/member_test.ts",
      "tests/cli_test.ts",
      "tests/warm_test.ts",
    ]),
  );
  assertEquals(findings.candidates.map((row) => row.file), [
    "tests/uncovered_test.ts",
  ]);
  assertEquals(findings.unavailableFiles, ["tests/removed_test.ts"]);
});

Deno.test("missing canary history remains unknown rather than evidence to retire a member", () => {
  const first = CANARY_EXTRA_TEST_FILES[0];
  assert(first !== undefined);
  const modules = new Set(CANARY_EXTRA_TEST_FILES.map((entry) => entry.file));
  const empty = auditCanary([], modules, modules);
  assertEquals(empty.candidates, []);
  assertEquals(empty.unobservedExtras, [...modules]);
  const observed = auditCanary(
    [{ file: first.file, redRuns: 1, diagnosticRows: 1, lastAt: "2026-08-01" }],
    modules,
    modules,
  );
  assertEquals(
    observed.unobservedExtras,
    CANARY_EXTRA_TEST_FILES.slice(1).map((entry) => entry.file),
  );
});

Deno.test("canary audit resolves its repository under the command's declared permissions", async () => {
  const wrapper = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.scripts, "canary-audit"),
  );
  const flags = wrapper.match(
    /^exec deno run (.+?) scripts\/canary_audit\.ts /m,
  )?.[1]?.split(/\s+/);
  assert(
    flags !== undefined,
    "the audit command must declare its native permissions",
  );
  // One read-only Deno child and Git query; no repository or gate fixture.
  await withTempDir(async (dir) => {
    const probe = join(dir, "canary_repository.ts");
    await Deno.writeTextFile(
      probe,
      `import { resolveCommonGitDir } from ${
        JSON.stringify(
          toFileUrl(join(REPO_ROOT, "scripts/canary_audit.ts")).href,
        )
      };
const common = await resolveCommonGitDir(${JSON.stringify(REPO_ROOT)});
if (!common.startsWith("/") || !common.endsWith("/.git")) throw new Error("missing common Git directory");
`,
    );
    const result = await runOwnedChild(Deno.execPath(), {
      args: [
        "run",
        "--config",
        join(REPO_ROOT, "deno.json"),
        "--no-prompt",
        ...flags,
        probe,
      ],
      cwd: REPO_ROOT,
    });
    assertEquals(
      result.status.success,
      true,
      "canary-audit must work with its published permissions",
    );
  });
});
