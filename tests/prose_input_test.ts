/**
 * The prose standards measure PROSE, never metadata: each denominator comes
 * from the exact corpus its numerator reads. Vale's staged input excludes
 * frontmatter and every `_private` subtree, so neither may contribute words to
 * the alert-density denominator.
 */

import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  blankFrontmatter,
  restoreStagePaths,
  type SarifLog,
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
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";

/** A registered public section, so the density script admits the fixture. */
const PUBLIC_SECTION = BUNDLED_PUBLIC_DOC_DIRS[0] ?? "00-orientation";

const FRONTMATTERED = "---\n" +
  "title: Meta words that must not count\n" +
  "aliases:\n  - extra\n" +
  "---\n" +
  "# Doc\n\nSeven words of actual prose live here.\n";

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

Deno.test("public prose holds discern voice alerts at exact zero", () => {
  const stageDir = "/tmp/discern-prose-contract";
  const publicRel = `${PUBLIC_SECTION}/published.md`;
  const selected = selectProseGateAlerts(
    {
      [`${stageDir}/${publicRel}`]: [
        {
          Check: "Discern.Padding",
          Severity: "suggestion",
          Message: "Custom advisory on a published page.",
        },
        {
          Check: "DiscernProduct.AgentBlame",
          Severity: "warning",
          Message: "Register advisory on a published page.",
        },
        {
          Check: "Microsoft.Passive",
          Severity: "warning",
          Message: "Third-party advisory stays in the density metric.",
        },
      ],
      [`${stageDir}/_internal/notes.md`]: [
        {
          Check: "Discern.Padding",
          Severity: "suggestion",
          Message: "Internal custom advisory remains editorial debt.",
        },
        {
          Check: "Microsoft.Spelling",
          Severity: "error",
          Message: "Errors still block everywhere.",
        },
      ],
      [`${stageDir}/${PUBLIC_SECTION}/withheld.md`]: [{
        Check: "Discern.Hype",
        Severity: "warning",
        Message: "A withheld page is outside the published contract.",
      }],
    },
    {
      stageDir,
      publicRelPaths: new Set([publicRel]),
    },
  );

  assertEquals(
    (selected[`${stageDir}/${publicRel}`] ?? []).map((alert) =>
      (alert as { Check?: unknown }).Check
    ),
    ["Discern.Padding", "DiscernProduct.AgentBlame"],
  );
  assertEquals(
    (selected[`${stageDir}/_internal/notes.md`] ?? []).map((alert) =>
      (alert as { Check?: unknown }).Check
    ),
    ["Microsoft.Spelling"],
  );
  assertEquals(
    selected[`${stageDir}/${PUBLIC_SECTION}/withheld.md`],
    undefined,
  );
});

Deno.test("the prose command blocks public voice advisories and ignores withheld ones", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    const section = join(map, PUBLIC_SECTION);
    await Deno.mkdir(section, { recursive: true });
    const published = join(section, "published.md");
    const withheld = join(section, "withheld.md");
    await Deno.writeTextFile(
      published,
      "# Published\n\nDiscern actually records the state.\n",
    );
    await Deno.writeTextFile(
      withheld,
      "---\npublish: false\n---\n\n# Withheld\n\nDiscern actually records the state.\n",
    );

    const run = async (): Promise<Deno.CommandOutput> =>
      await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          join(REPO_ROOT, "scripts/prose_check.ts"),
          "--sarif",
          "--public-custom-zero",
          map,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();

    const blocked = await run();
    assertEquals(blocked.code, 1);
    const blockedSarif = JSON.parse(
      new TextDecoder().decode(blocked.stdout),
    ) as SarifLog;
    assertEquals(
      blockedSarif.runs[0].results.map((result) => result.ruleId).sort(),
      ["Discern.Padding", "DiscernProduct.ProductName"],
    );
    assert(
      blockedSarif.runs[0].results.every((result) =>
        result.locations[0].physicalLocation.artifactLocation.uri === published
      ),
      "only the published page belongs to the exact-zero projection",
    );

    await Deno.writeTextFile(
      published,
      "# Published\n\ndiscern records the state.\n",
    );
    const clean = await run();
    assertEquals(clean.code, 0, new TextDecoder().decode(clean.stderr));
    const cleanSarif = JSON.parse(
      new TextDecoder().decode(clean.stdout),
    ) as SarifLog;
    assertEquals(cleanSarif.runs[0].results, []);
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
    "--public-custom-zero",
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
