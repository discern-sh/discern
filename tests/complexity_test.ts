/** Qualification tests for the exact, ratcheted FTA complexity census. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { COMPLEXITY_HOTSPOT_BUDGETS } from "../scripts/complexity_hotspots.ts";
import {
  complexityHotspotFindings,
  contextualizeComplexity,
  expectedFtaFiles,
  ftaEnrollmentFindings,
  parseFtaJson,
  rankComplexity,
} from "../scripts/complexity_lib.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { decodeWith } from "./decode_cli_result.ts";

const DenoFtaImportSchema = z.object({
  imports: z.object({ "fta-cli": z.literal("npm:fta-cli@3.0.1") }),
});
const FtaConfigSchema = z.object({
  exclude_under: z.literal(0),
  include_comments: z.literal(false),
  extensions: z.tuple([
    z.literal(".mts"),
    z.literal(".cts"),
    z.literal(".mjs"),
    z.literal(".cjs"),
  ]),
}).strict();

Deno.test("FTA parsing and enrollment reject silent source omissions", () => {
  const metrics = parseFtaJson(JSON.stringify([
    {
      file_name: "./src/one.ts",
      fta_score: 12.5,
      cyclo: 4,
      line_count: 80,
    },
    {
      file_name: "src/two.mts",
      fta_score: 8,
      cyclo: 2,
      line_count: 40,
    },
  ]));
  assertEquals(metrics.map((metric) => metric.file), [
    "src/one.ts",
    "src/two.mts",
  ]);
  assertEquals(
    expectedFtaFiles(["src/public.d.ts", "src/two.mts", "src/one.ts"]),
    ["src/one.ts", "src/two.mts"],
  );
  const firstMetric = metrics[0];
  assert(firstMetric !== undefined);
  assertEquals(
    ftaEnrollmentFindings(
      ["src/one.ts", "src/two.mts"],
      [firstMetric, firstMetric],
    ),
    [
      "FTA returned src/one.ts 2 times",
      "FTA omitted authored source src/two.mts",
    ],
  );
});

Deno.test("complexity context keeps ownership lanes and rankings independent", () => {
  const metrics = contextualizeComplexity(
    [
      { file: "src/slow.ts", score: 20, cyclo: 5, lines: 90 },
      { file: "src/branchy.ts", score: 10, cyclo: 30, lines: 60 },
      { file: "scripts/tool.ts", score: 15, cyclo: 10, lines: 70 },
      { file: "tests/generated.ts", score: 1000, cyclo: 1000, lines: 1000 },
    ],
    new Set(["tests/generated.ts"]),
    new Map([["src/slow.ts", 12], ["src/branchy.ts", 20]]),
  );
  assertEquals(metrics.map((metric) => metric.area), [
    "production",
    "production",
    "tooling",
    "generated",
  ]);
  assertEquals(
    rankComplexity(metrics, "production", "score").map((metric) => metric.file),
    ["src/slow.ts", "src/branchy.ts"],
  );
  assertEquals(
    rankComplexity(metrics, "production", "touches").map((metric) =>
      metric.file
    ),
    ["src/branchy.ts", "src/slow.ts"],
  );
});

Deno.test("hotspot budgets reject additions and regressions but ignore generated projections", () => {
  const budget = {
    file: "src/legacy.ts",
    maxScore: 110.25,
    maxCyclo: 220,
    owner: "legacy owner",
    reason: "A reviewed legacy responsibility remains concentrated.",
    recovery: "Extract one coherent responsibility and remeasure it.",
  } as const;
  const baseline = contextualizeComplexity(
    [
      { file: "src/legacy.ts", score: 110.254, cyclo: 220, lines: 500 },
      { file: "src/generated.ts", score: 500, cyclo: 500, lines: 500 },
    ],
    new Set(["src/generated.ts"]),
    new Map(),
  );
  assertEquals(complexityHotspotFindings(baseline, [budget]), []);

  const findings = complexityHotspotFindings([
    ...baseline,
    {
      file: "src/new.ts",
      score: 101,
      cyclo: 10,
      lines: 40,
      area: "production",
      touches: 1,
    },
  ], [{ ...budget, maxCyclo: 219 }]);
  assertStringIncludes(
    findings.join("\n"),
    "new extreme complexity hotspot src/new.ts",
  );
  assertStringIncludes(
    findings.join("\n"),
    "src/legacy.ts cyclomatic complexity 220 exceeds 219",
  );
});

Deno.test("hotspot budgets become stale once a file leaves the extreme tail", () => {
  const metrics = contextualizeComplexity(
    [{ file: "src/improved.ts", score: 99, cyclo: 200, lines: 100 }],
    new Set(),
    new Map(),
  );
  const findings = complexityHotspotFindings(metrics, [{
    file: "src/improved.ts",
    maxScore: 120,
    maxCyclo: 250,
    owner: "engine maintainers",
    reason: "This was a reviewed legacy hotspot before decomposition.",
    recovery: "Remove this registry row and lower the Standard limit.",
  }]);
  assertEquals(findings, [
    "stale complexity hotspot budget src/improved.ts",
  ]);
});

Deno.test("FTA configuration pins the qualified analyzer and exact extensions", async () => {
  const denoConfig = decodeWith(
    DenoFtaImportSchema,
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  );
  assertEquals(denoConfig.imports["fta-cli"], "npm:fta-cli@3.0.1");
  const ftaConfig = decodeWith(
    FtaConfigSchema,
    await Deno.readTextFile(join(REPO_ROOT, "fta.json")),
  );
  assertEquals(ftaConfig, {
    exclude_under: 0,
    include_comments: false,
    extensions: [".mts", ".cts", ".mjs", ".cjs"],
  });
});

Deno.test("every reviewed complexity hotspot has unique actionable ownership", () => {
  const files = COMPLEXITY_HOTSPOT_BUDGETS.map((budget) => budget.file);
  assertEquals(new Set(files).size, files.length);
  for (const budget of COMPLEXITY_HOTSPOT_BUDGETS) {
    assertStringIncludes(budget.recovery, " ");
    assertStringIncludes(budget.reason, " ");
    assertStringIncludes(budget.owner, " ");
  }
});
