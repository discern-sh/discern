/**
 * Vale is part of the prose standard's measuring instrument. Its binary and
 * package versions therefore come from tracked authorities, and every authored
 * caller goes through the version-checking wrapper.
 */

import { join } from "@std/path";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { AUTHORED_DENO_FILES, REPO_ROOT } from "./repo_authored_paths.ts";
import { parseValeVersion } from "../scripts/vale_lib.ts";

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
  for (const rel of AUTHORED_DENO_FILES) {
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
