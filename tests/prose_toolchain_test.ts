/**
 * Vale is part of the prose standard's measuring instrument. Its binary and
 * package versions therefore come from tracked authorities, and every authored
 * caller goes through the version-checking wrapper.
 */

import { dirname, join } from "@std/path";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { parseValeVersion, runVale } from "../scripts/vale_lib.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

const ValeAlertSchema = z.object({
  Check: z.string().optional(),
  Severity: z.string().optional(),
});
const ValeOutputSchema = z.record(z.string(), z.array(ValeAlertSchema));
type ValeAlert = z.infer<typeof ValeAlertSchema>;

/** Alerts Vale returned for one fixture path, tolerant of `/tmp` symlinks. */
function fixtureAlerts(
  result: z.infer<typeof ValeOutputSchema>,
  suffix: string,
): ValeAlert[] {
  const entry = Object.entries(result).find(([path]) => path.endsWith(suffix));
  return entry?.[1] ?? [];
}

Deno.test("the Vale binary has one tracked version authority", async () => {
  const expected = (
    await Deno.readTextFile(join(REPO_ROOT, ".vale-version"))
  ).trim();
  assertMatch(expected, /^\d+\.\d+\.\d+$/);

  const workflow = await Deno.readTextFile(
    join(REPO_ROOT, ".github/workflows/gate.yml"),
  );
  assert(!workflow.includes("VALE_VERSION:"), "the workflow has no second pin");
  assertStringIncludes(workflow, 'VALE_VERSION="$(<.vale-version)"');
  assertEquals(parseValeVersion(`vale version ${expected}\n`), expected);
});

Deno.test("Vale packages are immutable release artifacts", async () => {
  const config = await Deno.readTextFile(join(REPO_ROOT, ".vale.ini"));
  const packages = config.match(/^Packages\s*=\s*(.+)$/m)?.[1]
    ?.split(",")
    .map((entry) => entry.trim()) ?? [];
  assertEquals(packages.length, 2);
  for (const packageUrl of packages) {
    assertMatch(
      packageUrl,
      /^https:\/\/github\.com\/vale-cli\/[^/]+\/releases\/download\/v[^/]+\/[^/]+\.zip$/,
    );
  }
});

Deno.test("authored Deno sources invoke Vale only through its wrapper", async () => {
  const directVale = /new\s+Deno\.Command\(\s*["']vale["']/;
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/prose_toolchain_test.ts#prose-toolchain-imports",
      universe: "authored-deno",
    })
  ) {
    if (rel === "scripts/vale_lib.ts") continue;
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (directVale.test(source)) offenders.push(rel);
  }
  assertEquals(
    offenders,
    [],
    `direct Vale invocations bypass the version check: ${offenders.join(", ")}`,
  );
});

Deno.test("brand-path severity cannot downgrade house errors on other map pages", async () => {
  await withTempDir(async (dir) => {
    const publicRel = "00-orientation/future-sibling.md";
    const brandRel = "_internal/brand/declarations.md";
    const adrRel = "_adr/9999-history.md";
    const body = [
      "# Voice fixture",
      "",
      "We leverage a robust system.",
      "It quietly records state.",
      "Obviously, the command works.",
      "In a world where agents work, this is the shape of the workflow.",
      "",
    ].join("\n");
    for (const rel of [publicRel, brandRel, adrRel]) {
      const path = join(dir, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, body);
    }

    const run = await runVale(REPO_ROOT, [
      "--output=JSON",
      "--minAlertLevel=suggestion",
      dir,
    ]);
    const parsed = decodeWith(
      ValeOutputSchema,
      new TextDecoder().decode(run.stdout),
    );
    const expected = [
      "Discern.VendorSpeak",
      "Discern.Hype",
      "Discern.MaturedSeasoning",
      "Discern.Filler",
      "Discern.SceneSetting",
      "Discern.Jargon",
    ];
    for (const rel of [publicRel, brandRel]) {
      const alerts = fixtureAlerts(parsed, rel);
      for (const check of expected) {
        assertEquals(
          alerts.find((alert) => alert.Check === check)?.Severity,
          "error",
          `${rel}: ${check} must keep its authored error severity`,
        );
      }
    }
    assertEquals(
      fixtureAlerts(parsed, adrRel).filter((alert) =>
        typeof alert.Check === "string" && alert.Check.startsWith("Discern.")
      ),
      [],
      "historical ADRs do not receive the house-voice style",
    );
  });
});
