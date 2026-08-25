/**
 * The prose standards measure PROSE, never metadata: each denominator comes
 * from the exact corpus its numerator reads. Vale's staged input excludes
 * frontmatter and every `_private` subtree, so neither may contribute words to
 * the alert-density denominator.
 */

import { dirname, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  blankFrontmatter,
  decodeValeReport,
  restoreStagePaths,
  selectProseGateAlerts,
  stageProseInput,
  valeJsonToSarif,
} from "../scripts/prose_lib.ts";
import {
  extractSarif,
  sarifToDiagnostics,
} from "../src/engine/gate/diagnostics.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import {
  BUNDLED_PUBLIC_DOC_DIRS,
  MANUAL_SECTION_REGISTRY,
} from "../src/lib/paths.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const SARIF_LOG_SCHEMA = z.object({
  $schema: z.string(),
  version: z.literal("2.1.0"),
  runs: z.tuple([z.object({
    tool: z.object({ driver: z.object({ name: z.string() }) }),
    results: z.array(z.object({
      ruleId: z.string(),
      level: z.enum(["error", "warning", "note"]),
      message: z.object({ text: z.string() }),
      locations: z.tuple([z.object({
        physicalLocation: z.object({
          artifactLocation: z.object({ uri: z.string() }),
          region: z.object({
            startLine: z.number().int().positive().optional(),
            startColumn: z.number().int().positive().optional(),
          }),
        }),
      })]),
    })),
  })]),
});

/** A registered public section, so the density script admits the fixture. */
const PUBLIC_SECTION = BUNDLED_PUBLIC_DOC_DIRS[0] ?? "00-orientation";
/** A registered contributor section outside the public projection. */
const CONTRIBUTOR_SECTION =
  MANUAL_SECTION_REGISTRY.find((section) => section.audience === "contributor")
    ?.dir ?? "50-engine-internals";

const FRONTMATTERED = "---\n" +
  "title: Meta words that must not count\n" +
  "aliases:\n  - extra\n" +
  "---\n" +
  "# Doc\n\nSeven words of actual prose live here.\n";

Deno.test("Vale alerts validate before prose consumers inspect them", () => {
  const error = assertThrows(
    () =>
      decodeValeReport(
        JSON.stringify({
          "docs/page.md": [{
            Severity: "error",
            Check: "Discern.Example",
            Message: 42,
          }],
        }),
        "Vale output fixture for the prose gate",
      ),
    Error,
  );
  assertStringIncludes(error.message, "Vale output fixture for the prose gate");
  assertStringIncludes(error.message, "docs/page.md.0.Message");
});

Deno.test("blankFrontmatter removes the block but keeps line numbers stable", () => {
  const blanked = blankFrontmatter(FRONTMATTERED);
  assertEquals(
    blanked.split("\n").length,
    FRONTMATTERED.split("\n").length,
    "line count is preserved so Vale diagnostics stay accurate",
  );
  assert(!blanked.includes("Meta words"));
  assertStringIncludes(blanked, "Seven words of actual prose");
  // A block-less doc passes through byte-identical.
  assertEquals(blankFrontmatter("# Plain\n\nBody.\n"), "# Plain\n\nBody.\n");
});

Deno.test("stageProseInput blanks frontmatter and skips _private", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    await Deno.mkdir(join(map, "_private"), { recursive: true });
    await Deno.mkdir(join(map, "10-tier", "_private"), { recursive: true });
    await Deno.writeTextFile(join(map, "10-tier/page.md"), FRONTMATTERED);
    await Deno.writeTextFile(
      join(map, "_private/notes.md"),
      `# Unshipped notes\n\n${"private ".repeat(100)}`,
    );
    await Deno.writeTextFile(
      join(map, "10-tier/_private/notes.md"),
      `# Nested private notes\n\n${"private ".repeat(100)}`,
    );

    const stage = await stageProseInput(map);
    try {
      const staged = await Deno.readTextFile(
        join(stage.dir, "10-tier/page.md"),
      );
      assert(!staged.includes("Meta words"));
      assertStringIncludes(staged, "Seven words of actual prose");
      // "# Doc" + "Seven words of actual prose live here." = 8 words.
      // Neither frontmatter nor either private subtree contributes.
      assertEquals(stage.words, 8);

      for (
        const privatePath of [
          "_private/notes.md",
          "10-tier/_private/notes.md",
        ]
      ) {
        let sawPrivate = false;
        try {
          await Deno.stat(join(stage.dir, privatePath));
          sawPrivate = true;
        } catch {
          // absent, as required
        }
        assertEquals(sawPrivate, false, `${privatePath} never reaches Vale`);
      }

      // Diagnostics map back to the real tree.
      assertEquals(
        restoreStagePaths(
          `${stage.dir}/10-tier/page.md:3:1 alert`,
          stage.dir,
          map,
        ),
        `${map}/10-tier/page.md:3:1 alert`,
      );
    } finally {
      await Deno.remove(stage.dir, { recursive: true });
    }
  });
});

Deno.test("valeJsonToSarif feeds the gate's own SARIF normalization", () => {
  // The shape `vale --output=JSON` emits: a staged-path → alert-list map.
  const stageDir = "/tmp/discern-prose-abc123";
  const valeJson = {
    [`${stageDir}/10-tier/page.md`]: [
      {
        Action: { Name: "", Params: null },
        Span: [12, 20],
        Check: "Style.Wordiness",
        Description: "",
        Link: "",
        Message: "Consider a shorter phrase.",
        Severity: "error",
        Match: "in order to",
        Line: 7,
      },
      {
        Span: [3, 9],
        Check: "Style.Passive",
        Message: "Passive voice.",
        Severity: "suggestion",
        Line: 12,
      },
      "not an alert object", // skipped, never thrown
    ],
    unrelated: 42, // a non-array value is skipped
  };
  const sarifText = JSON.stringify(valeJsonToSarif(
    valeJson,
    (path) => restoreStagePaths(path, stageDir, "docs/map"),
  ));

  // Close the loop through the ACTUAL consumer: the gate must recognize the
  // log and project one Tier-1 diagnostic per finding, with the real path.
  const sarif = extractSarif(sarifText);
  assert(sarif !== undefined, "the gate must auto-detect the emitted log");
  const diagnostics = sarifToDiagnostics(sarif, "prose", "reproduce-cmd");
  assert(diagnostics !== undefined);
  assertEquals(diagnostics.length, 2);
  assertEquals(diagnostics[0]?.file, "docs/map/10-tier/page.md");
  assertEquals(diagnostics[0]?.line, 7);
  assertEquals(diagnostics[0]?.col, 12);
  assertEquals(diagnostics[0]?.rule, "Style.Wordiness");
  assertEquals(diagnostics[0]?.message, "Consider a shorter phrase.");
  assertEquals(diagnostics[0]?.severity, "error");
  // Vale "suggestion" maps to SARIF "note", which the gate reads as a warning.
  assertEquals(diagnostics[1]?.severity, "warning");
});

Deno.test("whole-map prose holds discern voice alerts at exact zero", () => {
  const stageDir = "/tmp/discern-prose-contract";
  const customAlerts = [
    {
      path: `${stageDir}/${PUBLIC_SECTION}/published.md`,
      check: "Discern.Padding",
      severity: "suggestion",
    },
    {
      path: `${stageDir}/${CONTRIBUTOR_SECTION}/maintainer.md`,
      check: "DiscernProduct.AgentBlame",
      severity: "warning",
    },
    {
      path: `${stageDir}/_internal/operations.md`,
      check: "DiscernAgent.BestJudgment",
      severity: "warning",
    },
    {
      path: `${stageDir}/_internal/brand/canon.md`,
      check: "DiscernBrand.StackedSlogans",
      severity: "suggestion",
    },
    {
      path: `${stageDir}/_adr/decision.md`,
      check: "Discern.Padding",
      severity: "suggestion",
    },
  ] as const;
  const selected = selectProseGateAlerts(
    Object.fromEntries([
      ...customAlerts.map((fixture) =>
        [fixture.path, [
          {
            Check: fixture.check,
            Severity: fixture.severity,
            Message: "Custom advisory blocks wherever its style emits it.",
          },
          {
            Check: "Microsoft.Passive",
            Severity: "warning",
            Message: "Third-party advisories stay in the density metric.",
          },
        ]] as const
      ),
      [`${stageDir}/external-error.md`, [
        {
          Check: "Microsoft.Spelling",
          Severity: "error",
          Message: "Errors still block everywhere.",
        },
      ]],
    ]),
  );

  for (const fixture of customAlerts) {
    assertEquals(
      (selected[fixture.path] ?? []).map((alert) =>
        (alert as { Check?: unknown }).Check
      ),
      [fixture.check],
      `${fixture.path} must block its custom alert without a path allowlist`,
    );
  }
  assertEquals(
    (selected[`${stageDir}/external-error.md`] ?? []).map((alert) =>
      (alert as { Check?: unknown }).Check
    ),
    ["Microsoft.Spelling"],
  );
});

Deno.test("the prose command enforces custom zero across maintained Map tiers", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    const pages = {
      public: join(map, PUBLIC_SECTION, "published.md"),
      contributor: join(map, CONTRIBUTOR_SECTION, "maintainer.md"),
      operational: join(map, "_internal", "operations.md"),
      brand: join(map, "_internal", "brand", "canon.md"),
      adr: join(map, "_adr", "decision.md"),
      private: join(map, "_private", "notes.md"),
      protected: join(map, PUBLIC_SECTION, "protected.md"),
      thirdParty: join(map, CONTRIBUTOR_SECTION, "third-party.md"),
    } as const;
    for (const path of Object.values(pages)) {
      await Deno.mkdir(dirname(path), { recursive: true });
    }
    const fixtures: Readonly<Record<keyof typeof pages, string>> = {
      public: "# Public\n\nDiscern actually records the state.\n",
      contributor:
        "# Contributor\n\nActually, use your best judgment for this step.\n",
      operational:
        "# Operations\n\nThe agent forgot the branch. It actually remains behind.\n",
      brand: "# Brand\n\nWe actually transform records.\n",
      adr:
        "# Decision\n\nDiscern actually records the state. The file was written by the command.\n",
      private: "# Private\n\nDiscern actually transforms records.\n",
      protected:
        "# Protected\n\nThe literals `Discern`, `actually`, and `transform` appear in source.\n",
      thirdParty: "# Advisory\n\nThe file was written by the command.\n",
    };
    for (const [name, path] of Object.entries(pages)) {
      await Deno.writeTextFile(path, fixtures[name as keyof typeof pages]);
    }

    const run = async (args: string[]): Promise<Deno.CommandOutput> =>
      await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          join(REPO_ROOT, "scripts/prose_check.ts"),
          map,
          ...args,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();

    const raw = await run(["--min-level=suggestion", "--sarif"]);
    const rawSarif = decodeWith(
      SARIF_LOG_SCHEMA,
      new TextDecoder().decode(raw.stdout),
    );
    const rawResults = rawSarif.runs[0].results;
    const expectedRules = new Map<string, string[]>([
      [pages.public, ["Discern.Padding", "DiscernProduct.ProductName"]],
      [
        pages.contributor,
        ["Discern.Padding", "DiscernAgent.BestJudgment"],
      ],
      [
        pages.operational,
        ["Discern.Padding", "DiscernProduct.AgentBlame"],
      ],
      [pages.brand, ["Discern.Padding", "DiscernBrand.GenericVerbs"]],
    ]);
    for (const [path, rules] of expectedRules) {
      assertEquals(
        rawResults.filter((result) =>
          result.locations[0].physicalLocation.artifactLocation.uri === path &&
          result.ruleId.startsWith("Discern")
        ).map((result) => result.ruleId).sort(),
        [...rules].sort(),
        `${path} must load its configured custom styles`,
      );
    }
    assert(
      rawResults.some((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri ===
          pages.thirdParty && result.ruleId === "Microsoft.Passive"
      ),
      "the density corpus must retain a real third-party advisory",
    );
    assert(
      rawResults.some((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri ===
          pages.adr && result.ruleId === "Microsoft.Passive"
      ),
      "ADRs must retain their reduced third-party style set",
    );
    assert(
      !rawResults.some((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri ===
          pages.adr && result.ruleId.startsWith("Discern")
      ),
      "ADRs must not load custom styles",
    );
    assert(
      !rawResults.some((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri ===
          pages.private
      ),
      "_private must remain outside the staged corpus",
    );
    assert(
      !rawResults.some((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri ===
          pages.protected && result.ruleId.startsWith("Discern")
      ),
      "code-spanned custom counter-examples must remain exempt",
    );

    const blocked = await run(["--sarif", "--custom-zero"]);
    assertEquals(blocked.code, 1);
    const blockedSarif = decodeWith(
      SARIF_LOG_SCHEMA,
      new TextDecoder().decode(blocked.stdout),
    );
    const blockedResults = blockedSarif.runs[0].results;
    assertEquals(
      [
        ...new Set(
          blockedResults.map((result) =>
            result.locations[0].physicalLocation.artifactLocation.uri
          ),
        ),
      ].sort(),
      [...expectedRules.keys()].sort(),
    );
    for (const [path, rules] of expectedRules) {
      const results = blockedResults.filter((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri === path
      );
      assertEquals(
        results.map((result) => result.ruleId).sort(),
        [...rules].sort(),
      );
      assertEquals(
        [...new Set(results.map((result) => result.level))].sort(),
        ["note", "warning"],
        `${path} must block both custom suggestion and warning severities`,
      );
    }
    assert(
      blockedResults.every((result) =>
        result.ruleId.startsWith("Discern") &&
        (result.level === "warning" || result.level === "note")
      ),
      "custom warnings and suggestions are the only selected fixture alerts",
    );

    for (const path of expectedRules.keys()) {
      await Deno.writeTextFile(path, "# Clean\n\ndiscern records the state.\n");
    }
    const clean = await run(["--sarif", "--custom-zero"]);
    assertEquals(clean.code, 0, new TextDecoder().decode(clean.stderr));
    const cleanSarif = decodeWith(
      SARIF_LOG_SCHEMA,
      new TextDecoder().decode(clean.stdout),
    );
    assertEquals(cleanSarif.runs[0].results, []);

    const density = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        join(REPO_ROOT, "scripts/prose.ts"),
        map,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(density.code, 0, new TextDecoder().decode(density.stderr));
    const densityMatch = new TextDecoder().decode(density.stdout).match(
      /DISCERN_METRIC prose (\d+)/,
    );
    assert(densityMatch !== null);
    assert(
      Number(densityMatch[1]) > 0,
      "third-party advisories remain in the prose-density numerator",
    );
  });
});

Deno.test("the prose standard divides by its staged-corpus word metric", async () => {
  const config = parseToml(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  ) as {
    jobs?: {
      prose?: {
        run?: unknown;
      };
    };
    standards?: {
      prose?: {
        per?: unknown;
        scale?: unknown;
      };
    };
  };
  assertEquals(config.standards?.prose?.per, "prose_words");
  assertEquals(config.standards?.prose?.scale, 1000);
  assertStringIncludes(
    String(config.jobs?.prose?.run),
    "--custom-zero",
  );
});

Deno.test("the public-doc word count excludes frontmatter", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    await Deno.mkdir(join(map, PUBLIC_SECTION), { recursive: true });
    await Deno.writeTextFile(
      join(map, PUBLIC_SECTION, "page.md"),
      FRONTMATTERED,
    );

    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        join(REPO_ROOT, "scripts/public_doc_density.ts"),
        map,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(run.code, 0, new TextDecoder().decode(run.stderr));
    const stdout = new TextDecoder().decode(run.stdout);
    // "# Doc" + "Seven words of actual prose live here." = 8 words; the
    // frontmatter's words never count.
    assertStringIncludes(stdout, "DISCERN_METRIC public_doc_words 8");
    assertStringIncludes(stdout, "DISCERN_METRIC public_doc_leaves 1");
  });
});
