/**
 * Coverage joins the Git-derived product-module universe to LCOV.
 *
 * The guard targets the defect class where LCOV is allowed to declare its own
 * membership: a wholly unloaded runtime module then disappears instead of
 * measuring zero. The fixtures also hold the two deliberate non-runtime
 * classes, canonical path matching, legacy-debt parity, and LCOV-only records.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  classifyModuleSource,
  evaluateModuleCoverage,
  lcovReportArgs,
  renderTable,
  type SourceModule,
  srcLineCoverage,
} from "../scripts/coverage_lib.ts";
import { fromFileUrl, join, toFileUrl } from "@std/path";

const ROOT = "/repo/checkout";

/** Render one LCOV record from explicit per-line execution counts. */
function recordWithLines(
  path: string,
  lines: ReadonlyArray<readonly [number, number]>,
): string {
  const hit = lines.filter(([, count]) => count > 0).length;
  return [
    `SF:${path}`,
    ...lines.map(([line, count]) => `DA:${line},${count}`),
    `LF:${lines.length}`,
    `LH:${hit}`,
    "end_of_record",
  ].join("\n");
}

/** Render one LCOV record whose leading lines realize the chosen hit count. */
function record(path: string, found: number, hit: number): string {
  return recordWithLines(
    path,
    Array.from(
      { length: found },
      (_, index) => [index + 1, index < hit ? 1 : 0],
    ),
  );
}

const MODULES: SourceModule[] = [
  { path: "src/empty.ts", kind: "no-executable-lines" },
  { path: "src/engine/dispatch.ts", kind: "executable" },
  { path: "src/engine/unloaded.ts", kind: "executable" },
  { path: "src/shared/config.ts", kind: "executable" },
  { path: "src/shared/types.ts", kind: "type-only" },
];

const LCOV = [
  record(`${ROOT}/src/engine/dispatch.ts`, 10, 9),
  record(`${ROOT}/src/shared/config.ts`, 10, 8),
].join("\n");

Deno.test("module syntax distinguishes runtime, erased type-only, and no-line modules", () => {
  assertEquals(
    classifyModuleSource(
      "src/runtime.ts",
      'import type { Shape } from "./types.ts";\nexport const value: Shape = {};\n',
    ),
    "executable",
  );
  assertEquals(
    classifyModuleSource(
      "src/types.ts",
      'import { type Shape } from "./shape.ts";\nexport interface Box { value: Shape }\nexport type Name = string;\n',
    ),
    "type-only",
  );
  assertEquals(
    classifyModuleSource("src/empty.ts", "/** Marker only. */\nexport {};\n"),
    "no-executable-lines",
  );
});

Deno.test("the LCOV report filter admits only this checkout's src tree", () => {
  const repoRoot = fromFileUrl(new URL("../", import.meta.url));
  const args = lcovReportArgs("profile-dir", repoRoot);
  const include = args.find((arg) => arg.startsWith("--include="));
  const pattern = new RegExp(include?.slice("--include=".length) ?? "(?!)");
  assertEquals(
    pattern.test(
      toFileUrl(join(repoRoot, "src", "engine", "gate", "test_job.ts")).href,
    ),
    true,
  );
  assertEquals(
    pattern.test(toFileUrl(join(repoRoot, "site", "page-src", "page.ts")).href),
    false,
  );
  assertEquals(args.some((arg) => arg.startsWith("--exclude=")), false);
  assertEquals(args.slice(0, 3), ["coverage", "profile-dir", "--lcov"]);
});

Deno.test("the LCOV join gives an unloaded executable module an explicit zero", () => {
  const cov = srcLineCoverage(LCOV, ROOT, MODULES);
  assertEquals(cov.files, [
    {
      path: "src/empty.ts",
      hit: 0,
      found: 0,
      pct: null,
      status: "no-executable-lines",
    },
    {
      path: "src/engine/dispatch.ts",
      hit: 9,
      found: 10,
      pct: 90,
      status: "measured",
    },
    {
      path: "src/engine/unloaded.ts",
      hit: 0,
      found: 0,
      pct: 0,
      status: "unloaded",
    },
    {
      path: "src/shared/config.ts",
      hit: 8,
      found: 10,
      pct: 80,
      status: "measured",
    },
    {
      path: "src/shared/types.ts",
      hit: 0,
      found: 0,
      pct: null,
      status: "type-only",
    },
  ]);
  assertEquals(cov.hit, 17);
  assertEquals(cov.found, 20);
  assertEquals(cov.pct, 85);
  assertEquals(cov.issues, []);
});

Deno.test("canonical LCOV records union per line while foreign and mismatched paths diagnose", () => {
  const lcov = [
    record(`${ROOT}/src/engine/dispatch.ts`, 5, 4),
    record(`file://${ROOT}/src/engine/dispatch.ts`, 5, 5),
    record(`${ROOT}/src/engine/lcov-only.ts`, 3, 2),
    record("src/shared/config.ts", 10, 8),
    record("/elsewhere/src/other.ts", 4, 4),
  ].join("\n");
  const cov = srcLineCoverage(lcov, `${ROOT}/`, MODULES);
  assertEquals(
    cov.files.find((file) => file.path === "src/engine/dispatch.ts"),
    {
      path: "src/engine/dispatch.ts",
      hit: 5,
      found: 5,
      pct: 100,
      status: "measured",
    },
  );
  assertEquals(cov.issues.map((issue) => issue.kind), [
    "lcov-outside-universe",
    "lcov-path-mismatch",
    "lcov-outside-universe",
  ]);
  assertStringIncludes(cov.issues[0]?.message ?? "", "lcov-only.ts");
  assertStringIncludes(cov.issues[1]?.message ?? "", "absolute");
  assertStringIncludes(cov.issues[2]?.message ?? "", "/elsewhere");
});

Deno.test("shard reports union per line so a line hit in any pass counts hit once", () => {
  const shardA = [
    recordWithLines(`${ROOT}/src/engine/dispatch.ts`, [
      [1, 1],
      [2, 1],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ]),
    record(`${ROOT}/src/shared/config.ts`, 10, 8),
  ].join("\n");
  const shardB = recordWithLines(`${ROOT}/src/engine/dispatch.ts`, [
    [1, 0],
    [2, 0],
    [3, 1],
    [4, 1],
    [5, 0],
    [6, 0],
  ]);
  const cov = srcLineCoverage([shardA, shardB], ROOT, MODULES);
  assertEquals(
    cov.files.find((file) => file.path === "src/engine/dispatch.ts"),
    {
      path: "src/engine/dispatch.ts",
      hit: 4,
      found: 6,
      pct: 66.7,
      status: "measured",
    },
  );
  assertEquals(
    cov.files.find((file) => file.path === "src/shared/config.ts"),
    {
      path: "src/shared/config.ts",
      hit: 8,
      found: 10,
      pct: 80,
      status: "measured",
    },
  );
  assertEquals(cov.issues, []);
});

Deno.test("records whose DA lines disagree with their summary diagnose instead of counting", () => {
  const forged = [
    `SF:${ROOT}/src/engine/dispatch.ts`,
    "DA:1,1",
    "DA:2,0",
    "LF:5",
    "LH:4",
    "end_of_record",
  ].join("\n");
  const duplicated = [
    `SF:${ROOT}/src/engine/dispatch.ts`,
    "DA:1,1",
    "DA:1,0",
    "LF:2",
    "LH:1",
    "end_of_record",
  ].join("\n");
  const unterminated = [
    `SF:${ROOT}/src/engine/dispatch.ts`,
    "DA:1,1",
    "LF:1",
    "LH:1",
  ].join("\n");
  for (
    const [lcov, detail] of [
      [forged, "disagrees"],
      [duplicated, "twice"],
      [unterminated, "end_of_record"],
    ] as const
  ) {
    const cov = srcLineCoverage(lcov, ROOT, MODULES);
    assertEquals(cov.issues.map((issue) => issue.kind), ["invalid-lcov"]);
    assertStringIncludes(cov.issues[0]?.message ?? "", detail);
    assertEquals(
      cov.files.find((file) => file.path === "src/engine/dispatch.ts")?.status,
      "unloaded",
    );
  }
});

Deno.test("a new low module, exact exception, regression, and stale exception are distinct", () => {
  const cov = srcLineCoverage(LCOV, ROOT, MODULES);
  const base = {
    path: "src/shared/config.ts",
    measuredPct: 80,
    owner: "configuration runtime",
    reason: "failure branches require filesystem seams",
    recovery: "cover the remaining parse and permission outcomes",
  } as const;

  const newlyLow = evaluateModuleCoverage(cov, 85, []);
  assertEquals(newlyLow.failureCount, 2);
  assertStringIncludes(newlyLow.failures.join("\n"), "src/engine/unloaded.ts");
  assertStringIncludes(newlyLow.failures.join("\n"), "src/shared/config.ts");

  const exact = evaluateModuleCoverage(cov, 85, [base]);
  assertEquals(exact.failureCount, 1);
  assertStringIncludes(exact.failures[0] ?? "", "unloaded");

  const regressed = evaluateModuleCoverage(cov, 85, [{
    ...base,
    measuredPct: 81,
  }]);
  assertStringIncludes(regressed.failures.join("\n"), "regressed");

  const stale = evaluateModuleCoverage(cov, 80, [base]);
  assertStringIncludes(stale.failures.join("\n"), "stale");
});

Deno.test("renderTable exposes module states and derives its total from one analysis", () => {
  const table = renderTable(srcLineCoverage(LCOV, ROOT, MODULES));
  assertStringIncludes(table, "src/engine/dispatch.ts");
  assertStringIncludes(table, "src/engine/unloaded.ts");
  assertStringIncludes(table, "unloaded");
  assertStringIncludes(table, "src/shared/types.ts");
  assertStringIncludes(table, "type-only");
  assertStringIncludes(table, "src/empty.ts");
  assertStringIncludes(table, "no executable lines");
  assertStringIncludes(table, "All measured src/ files");
  assertStringIncludes(table, "85.0%");
});
