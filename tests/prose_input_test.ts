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
  EDITORIAL_PROSE_RULES,
  isEditorialProseCheck,
  restoreStagePaths,
  selectProseGateAlerts,
  valeJsonToSarif,
  withStagedProseInput,
} from "../scripts/prose_lib.ts";
import {
  extractSarif,
  sarifToDiagnostics,
} from "../src/engine/gate/diagnostics.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { measurePublicDocs } from "../scripts/public_doc_density_lib.ts";

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

const PUBLIC_SECTION = "20-quality-gate";
const CONTRIBUTOR_SECTION = "50-engine-internals";

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

Deno.test("withStagedProseInput blanks frontmatter and skips _private", async () => {
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

    await withStagedProseInput(map, async (stage) => {
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
    });
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

Deno.test("editorial prose review excludes only registered non-error findings", () => {
  const editorialChecks = Object.keys(EDITORIAL_PROSE_RULES);
  const report = {
    "published.md": editorialChecks.flatMap((Check) => [
      { Check, Severity: "warning", Message: "Review in context." },
      { Check, Severity: "suggestion", Message: "Review in context." },
    ]),
    "internal.md": [
      { Check: "Discern.NewRule", Severity: "suggestion" },
      { Check: "Discern.Numeration", Severity: "warning" },
      { Check: "Discern.Seasoning", Severity: "warning" },
      { Check: "DiscernProduct.ProductName", Severity: "warning" },
      { Check: "DiscernProduct.AgentBlame", Severity: "warning" },
      { Check: "DiscernAgent.BestJudgment", Severity: "warning" },
      { Check: "DiscernBrand.StackedSlogans", Severity: "suggestion" },
      { Check: "Microsoft.Passive", Severity: "warning" },
    ],
    "errors.md": [
      { Check: "Vale.Spelling", Severity: "error" },
      { Check: editorialChecks[0], Severity: "error" },
    ],
  };
  const before = structuredClone(report);
  const selected = selectProseGateAlerts(report);
  assertEquals(selected, {
    "internal.md": report["internal.md"].slice(0, -1),
    "errors.md": report["errors.md"],
  });
  assertEquals(report, before, "review output retains every original finding");
  for (const check of editorialChecks) assert(isEditorialProseCheck(check));
  for (
    const check of [
      "Discern.NewRule",
      "Discern.NumerationExtra",
      "Discern.Numeration",
      "Discern.Seasoning",
      "Other.Numeration",
      "toString",
      undefined,
    ]
  ) {
    assertEquals(isEditorialProseCheck(check), false, String(check));
  }
});

Deno.test("every editorial disposition names an existing authored rule and explains its judgment", async () => {
  for (const [check, rationale] of Object.entries(EDITORIAL_PROSE_RULES)) {
    assert(
      rationale.trim().length > 0,
      `${check} needs its editorial rationale`,
    );
    const file = join(REPO_ROOT, ".vale", `${check.replace(".", "/")}.yml`);
    assert((await Deno.stat(file)).isFile, `${check} must name a real rule`);
  }
});

Deno.test("the prose command separates editorial review from defects across maintained Map tiers", async () => {
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
    const blockingRules = new Map<string, string[]>([
      [pages.public, ["DiscernProduct.ProductName"]],
      [pages.contributor, ["DiscernAgent.BestJudgment"]],
      [pages.operational, ["DiscernProduct.AgentBlame"]],
      [pages.brand, ["DiscernBrand.GenericVerbs"]],
    ]);
    for (const [path, rules] of blockingRules) {
      const results = blockedResults.filter((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri === path
      );
      assertEquals(
        results.map((result) => result.ruleId).sort(),
        [...rules].sort(),
      );
      assertEquals(
        [...new Set(results.map((result) => result.level))].sort(),
        ["warning"],
        `${path} must block its defect while leaving padding for review`,
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
      await Deno.writeTextFile(
        path,
        "# Review\n\nMake the book easy to find.\n",
      );
    }
    const clean = await run(["--sarif", "--custom-zero"]);
    assertEquals(clean.code, 0, new TextDecoder().decode(clean.stderr));
    const cleanSarif = decodeWith(
      SARIF_LOG_SCHEMA,
      new TextDecoder().decode(clean.stdout),
    );
    assertEquals(cleanSarif.runs[0].results, []);
    const review = await run(["--min-level=suggestion", "--sarif"]);
    const reviewSarif = decodeWith(
      SARIF_LOG_SCHEMA,
      new TextDecoder().decode(review.stdout),
    );
    for (const path of expectedRules.keys()) {
      assert(
        reviewSarif.runs[0].results.some((result) =>
          result.locations[0].physicalLocation.artifactLocation.uri === path &&
          result.ruleId === "Discern.Padding"
        ),
        `${path} keeps editorial findings in full review`,
      );
    }

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

Deno.test("the public-doc density command reports canonical manual metrics", async () => {
  const manualDir = resolveRepositoryManualDir(REPO_ROOT).abs;
  const expected = await measurePublicDocs(REPO_ROOT, manualDir);
  const run = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      join(REPO_ROOT, "scripts/public_doc_density.ts"),
      manualDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(run.code, 0, new TextDecoder().decode(run.stderr));
  const stdout = new TextDecoder().decode(run.stdout);
  assertStringIncludes(
    stdout,
    `DISCERN_METRIC public_doc_words ${expected.words}`,
  );
  assertStringIncludes(
    stdout,
    `DISCERN_METRIC public_doc_leaves ${expected.leaves}`,
  );
});
