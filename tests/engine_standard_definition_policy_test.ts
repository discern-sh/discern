/**
 * The Standard definition guard: a held number remains meaningful only while
 * every field that determines its quality claim stays equivalent to trunk.
 * These tests drive the shared Tier-1 verifier directly, with a real Git trunk
 * baseline but no measurement subprocess.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  STANDARD_DEFINITION_POLICIES,
  standardDefinitionFingerprint,
  type StandardDefinitionPolicy,
  verifyTrunkLimits,
} from "../src/engine/gate/standard_limits.ts";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";
import {
  parseConfigOrThrow,
  type StandardConfig,
} from "../src/shared/config_schema.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const COMMAND = "echo DISCERN_METRIC quality 40";

// Compile-time enrollment proof: adding a StandardConfig field makes this
// assignment (and the production `satisfies` projection) demand its policy.
const TOTAL_STANDARD_FIELD_POLICY: Record<
  keyof StandardConfig,
  StandardDefinitionPolicy
> = STANDARD_DEFINITION_POLICIES;

/** A minimal valid project config with caller-authored Standard tables. */
function config(standardLines: readonly string[] = []): string {
  return [
    "[project]",
    'slug = "definition-policy-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    ...standardLines,
    "",
  ].join("\n");
}

/** The baseline held Standard, plus optional fields for one fixture. */
function qualityStandard(extra: readonly string[] = []): string[] {
  return [
    "[standards.quality]",
    'direction = "up"',
    "limit = 40",
    `run = "${COMMAND}"`,
    ...extra,
  ];
}

/** Commit `trunkConfig`, load `branchConfig`, and inspect shared Tier 1. */
async function withVerification(
  trunkConfig: string,
  branchConfig: string,
  inspect: (
    verification: Awaited<ReturnType<typeof verifyTrunkLimits>>,
  ) => void,
): Promise<void> {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "discern.toml"), trunkConfig);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "discern.toml"), branchConfig);
    const branch = parseConfigOrThrow(branchConfig);
    inspect(
      await verifyTrunkLimits(
        dir,
        "main",
        buildStandardPlan(branch).standards,
      ),
    );
  });
}

const DEFINITION_CHANGES: readonly {
  field: string;
  branchExtra: readonly string[];
  trunkExtra?: readonly string[];
}[] = [
  { field: "direction", branchExtra: ['direction = "down"'] },
  {
    field: "run",
    branchExtra: ['run = ["echo DISCERN_METRIC quality 40", "true"]'],
  },
  { field: "metric", branchExtra: ['metric = "renamed"'] },
  { field: "per", branchExtra: ['per = "denominator"'] },
  { field: "scale", branchExtra: ["scale = 2"] },
  { field: "inputs", branchExtra: ['inputs = ["src/**"]'] },
];

/** Replace named TOML fields in one table while keeping every other line. */
function replaceFields(
  standard: readonly string[],
  replacements: readonly string[],
): string[] {
  const names = new Set(replacements.map((line) => line.split(" = ")[0]));
  return [
    ...standard.filter((line) => !names.has(line.split(" = ")[0])),
    ...replacements,
  ];
}

for (const change of DEFINITION_CHANGES) {
  Deno.test(`Standard definition: changing ${change.field} is blocked`, async () => {
    const trunk = qualityStandard(change.trunkExtra ?? []);
    const branch = replaceFields(trunk, change.branchExtra);
    await withVerification(config(trunk), config(branch), (verification) => {
      assertEquals(verification.blocking, true);
      assert(verification.blockedStandards.has("quality"));
      const diagnostic = verification.diagnostics.find((item) =>
        item.tool === "standard:quality"
      );
      assert(diagnostic !== undefined);
      assertStringIncludes(diagnostic.message, "quality");
      assertStringIncludes(diagnostic.message, change.field);
      if (change.field === "direction") {
        assertStringIncludes(
          diagnostic.message,
          'direction: "up" -> "down"',
        );
        assertStringIncludes(diagnostic.message, "old and new meanings");
        assertStringIncludes(diagnostic.message, "on the trunk");
        assertStringIncludes(diagnostic.message, "`discern update`");
        assertStringIncludes(diagnostic.message, "measured-breach override");
      }
    });
  });
}

Deno.test("Standard definition: schema-default and command spellings compare equivalent", async () => {
  const branch = replaceFields(qualityStandard(), [
    'metric = "quality"',
    `run = ["${COMMAND}"]`,
    "scale = 1",
    "margin = 0",
  ]);
  const olderTrunk = qualityStandard().filter((line) =>
    !line.startsWith("direction = ")
  );
  await withVerification(
    config(olderTrunk),
    config(branch),
    (verification) => {
      assertEquals(verification.blocking, false);
      assertEquals(verification.diagnostics, []);
    },
  );
});

Deno.test("Standard definition: changed values are bounded in the diagnostic", async () => {
  const longTail = "x".repeat(500);
  const branch = replaceFields(qualityStandard(), [
    `run = "echo DISCERN_METRIC quality 40 ${longTail}"`,
  ]);
  await withVerification(
    config(qualityStandard()),
    config(branch),
    (verification) => {
      const diagnostic = verification.diagnostics.find((item) =>
        item.tool === "standard:quality"
      );
      assert(diagnostic !== undefined);
      assertStringIncludes(diagnostic.message, "run:");
      assertStringIncludes(diagnostic.message, "…");
      assert(
        !diagnostic.message.includes(longTail),
        "the unbounded command must not be copied into the diagnostic",
      );
      assert(
        diagnostic.message.length < 900,
        `diagnostic should stay bounded: ${diagnostic.message.length}`,
      );
    },
  );
});

Deno.test("Standard definition: margin and timeout changes do not redefine the held claim", async () => {
  const branch = replaceFields(qualityStandard(), [
    "margin = 5",
    "timeout = 30",
  ]);
  await withVerification(
    config(qualityStandard()),
    config(branch),
    (verification) => {
      assertEquals(verification.blocking, false);
      assertEquals(verification.diagnostics, []);
    },
  );
});

Deno.test("Standard definition: a tighter limit and a new Standard remain permitted", async () => {
  const tightened = replaceFields(qualityStandard(), ["limit = 41"]);
  const branch = [
    ...tightened,
    "",
    "[standards.fresh]",
    'direction = "down"',
    "limit = 10",
    'run = "echo DISCERN_METRIC fresh 5"',
  ];
  await withVerification(
    config(qualityStandard()),
    config(branch),
    (verification) => {
      assertEquals(verification.blocking, false);
      assertEquals(verification.diagnostics, []);
    },
  );
});

Deno.test("Standard definition: deleting an existing Standard remains blocked", async () => {
  await withVerification(
    config(qualityStandard()),
    config(),
    (verification) => {
      assertEquals(verification.blocking, true);
      const diagnostic = verification.diagnostics.find((item) =>
        item.tool === "standard:quality"
      );
      assert(diagnostic !== undefined);
      assertStringIncludes(diagnostic.message, "deleted on this branch");
    },
  );
});

Deno.test("Standard definition: every schema field has an explicit policy and reason", () => {
  assertEquals(
    Object.fromEntries(
      Object.entries(TOTAL_STANDARD_FIELD_POLICY).map(([field, policy]) => [
        field,
        policy.kind,
      ]),
    ),
    {
      metric: "enforcement-meaning",
      direction: "enforcement-meaning",
      limit: "monotonic-bound",
      run: "enforcement-meaning",
      per: "enforcement-meaning",
      scale: "enforcement-meaning",
      margin: "execution-or-pinning",
      producer: "enforcement-meaning",
      extract: "enforcement-meaning",
      artifact: "enforcement-meaning",
      needs: "enforcement-meaning",
      artifacts: "enforcement-meaning",
      environment: "enforcement-meaning",
      toolchain: "enforcement-meaning",
      inputs: "enforcement-meaning",
      timeout: "execution-or-pinning",
    },
  );
  for (const [field, policy] of Object.entries(TOTAL_STANDARD_FIELD_POLICY)) {
    assert(
      policy.reason.length >= 20 && policy.reason.length <= 100,
      `${field} needs a short, substantive policy reason`,
    );
  }
});

Deno.test("Standard definition: an equivalent shared producer keeps the held command and inputs", async () => {
  const baseline = qualityStandard(['inputs = ["src/**"]']);
  const shared = [
    "[jobs.test]",
    `run = ["${COMMAND}"]`,
    "timeout = 10800",
    'environment = ["CI"]',
    'toolchain = ["runtime.lock"]',
    ...baseline.filter((line) => !line.startsWith("run = ")),
    'producer = "jobs.test"',
  ];
  await withVerification(config(baseline), config(shared), (verified) => {
    assertEquals(
      verified.blocking,
      false,
      JSON.stringify(verified.diagnostics),
    );
  });
});

/** A referenced producer with an explicit dependency and observed process facts. */
function sharedStandard(): string[] {
  return [
    "[jobs.build]",
    'run = "build-project"',
    'inputs = ["build/**"]',
    'environment = ["BUILD_FLAGS"]',
    "[jobs.test]",
    `run = "${COMMAND}"`,
    'needs = ["jobs.build"]',
    'inputs = ["src/**", "tests/**"]',
    'artifacts = ["report.txt"]',
    'environment = ["CI", "PATH"]',
    'toolchain = ["runtime.lock"]',
    "[standards.quality]",
    'producer = "jobs.test"',
    'direction = "up"',
    "limit = 40",
    'inputs = ["extract/**"]',
  ];
}

for (
  const [field, before, after] of [
    ["run", COMMAND, "echo DISCERN_METRIC quality 100"],
    ["inputs", 'inputs = ["src/**", "tests/**"]', 'inputs = ["src/**"]'],
    ["environment", 'environment = ["CI", "PATH"]', 'environment = ["CI"]'],
    ["toolchain", 'toolchain = ["runtime.lock"]', "toolchain = []"],
    ["artifacts", 'artifacts = ["report.txt"]', "artifacts = []"],
    ["needs", 'needs = ["jobs.build"]', "needs = []"],
    ["needs", 'run = "build-project"', 'run = "skip-build"'],
    ["needs", 'environment = ["BUILD_FLAGS"]', "environment = []"],
  ] as const
) {
  Deno.test(`Standard definition: referenced ${field} fact cannot be weakened (${before})`, async () => {
    const baseline = config(sharedStandard());
    await withVerification(
      baseline,
      baseline.replace(before, after),
      (verified) => {
        assertEquals(verified.blocking, true);
        assertStringIncludes(JSON.stringify(verified.diagnostics), field);
      },
    );
  });
}

Deno.test("Standard definition: added identities, wider inputs, context and alias names preserve protection", async () => {
  const baseline = config(sharedStandard());
  const branch = baseline.replaceAll("jobs.test", "jobs.instrumented")
    .replace(
      'environment = ["CI", "PATH"]',
      'environment = ["CI", "PATH", "LANG"]',
    )
    .replace(
      'inputs = ["src/**", "tests/**"]',
      'inputs = ["src/**", "tests/**", "assets/**"]',
    )
    .replace("[jobs.instrumented]", '[jobs.instrumented]\nstage = "test"');
  await withVerification(baseline, branch, (verified) => {
    assertEquals(
      verified.blocking,
      false,
      JSON.stringify(verified.diagnostics),
    );
  });
});

Deno.test("proposal identity resolves the entire producer recipe and ignores selector aliases", async () => {
  const source = config(sharedStandard());
  const fingerprint = (text: string): Promise<string> =>
    standardDefinitionFingerprint("quality", parseConfigOrThrow(text));
  const original = await fingerprint(source);
  assertEquals(
    await fingerprint(
      source.replaceAll("jobs.test", "jobs.instrumented").replace(
        "[jobs.instrumented]",
        '[jobs.instrumented]\nstage = "test"',
      ),
    ),
    original,
  );
  for (
    const [before, after] of [
      ["build-project", "changed-build"],
      ['environment = ["BUILD_FLAGS"]', 'environment = ["OTHER_FLAGS"]'],
      ['inputs = ["src/**", "tests/**"]', 'inputs = ["src/**"]'],
    ] as const
  ) {
    assert(
      await fingerprint(source.replace(before, after)) !== original,
      before,
    );
  }
});
