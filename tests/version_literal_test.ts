/**
 * Guard against duplicating the package version in source. `deno.json` is the
 * single source; code imports `KIT_VERSION` from `src/lib/version.ts`. The ban
 * covers every authored TypeScript tree: a hardcoded version in a test pins an
 * assertion that breaks on the next release, and one in `scripts/` codegen
 * writes the stale number into committed artifacts.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { KIT_VERSION } from "../src/lib/version.ts";
import {
  AUTHORED_TS_FILES,
  authoredTsFiles,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Every listed TypeScript source quoting `version` verbatim, minus `allowed`. */
async function hardcodedVersionSites(
  root: string,
  files: string[],
  version: string,
  allowed: readonly string[],
): Promise<string[]> {
  const quotes = [`"${version}"`, `'${version}'`, `\`${version}\``];
  const offenders: string[] = [];
  for (const rel of files) {
    if (allowed.includes(rel)) continue;
    const text = await Deno.readTextFile(join(root, rel));
    if (quotes.some((quote) => text.includes(quote))) {
      offenders.push(rel);
    }
  }
  return offenders.sort();
}

// The single source itself — the one place the semver may appear quoted.
const ALLOWED = ["src/lib/version.ts"];

Deno.test("authored TypeScript never hardcodes the package semver", async () => {
  assertEquals(
    await hardcodedVersionSites(
      REPO_ROOT,
      AUTHORED_TS_FILES,
      KIT_VERSION,
      ALLOWED,
    ),
    [],
    `import KIT_VERSION instead of hardcoding ${KIT_VERSION}; sample semvers ` +
      `in fixtures must not collide with the current package version`,
  );
});

Deno.test("the version guard enrolls a fresh literal in any authored tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    await Deno.mkdir(join(dir, "scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "scripts", "emit_release.ts"),
      `export const banner = "unrelated v3.2.1";\n`,
    );
    assertEquals(
      await hardcodedVersionSites(dir, await authoredTsFiles(dir), "3.2.1", []),
      [],
      "a version inside a longer string is not a quoted literal",
    );
    await Deno.writeTextFile(
      join(dir, "scripts", "emit_release.ts"),
      `export const version = "3.2.1";\n`,
    );
    assertEquals(
      await hardcodedVersionSites(dir, await authoredTsFiles(dir), "3.2.1", []),
      ["scripts/emit_release.ts"],
    );
  });
});
