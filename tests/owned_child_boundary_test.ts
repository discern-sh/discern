/**
 * Architectural guard for inherited-terminal subprocesses.
 *
 * Arbitrary user code that inherits discern's terminal must run through the
 * owned-child boundary, which installs the interruption and reap lifecycle. A
 * direct Deno.Command spawn can die beside its foreground child or leave that
 * child behind when only the wrapper receives a signal.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  AUTHORED_TS_FILES,
  authoredTsFiles,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Find every listed TypeScript source that asks a child to inherit terminal input. */
async function inheritedTerminalSites(
  root: string,
  files: string[],
): Promise<string[]> {
  const sites: string[] = [];
  for (const rel of files) {
    const source = await Deno.readTextFile(join(root, rel));
    if (/stdin\s*:\s*["']inherit["']/.test(source)) {
      sites.push(rel);
    }
  }
  return sites.sort();
}

const ALLOWED = [
  // The boundary itself — the one legitimate inherited-terminal spawn.
  "src/engine/owned_child.ts",
  // This guard: it spells the banned pattern only as fixture data below.
  "tests/owned_child_boundary_test.ts",
];

Deno.test("every inherited-terminal child uses the owned-child boundary", async () => {
  assertEquals(
    await inheritedTerminalSites(REPO_ROOT, AUTHORED_TS_FILES),
    ALLOWED,
    "move inherited-terminal Deno.Command launches into runOwnedChild",
  );
});

Deno.test("the owned-child guard enrolls an unrelated future launcher", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    for (
      const rel of ["scripts/fresh_helper.ts", "another/container/relay.ts"]
    ) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(
        join(dir, rel),
        `new Deno.Command("unrelated-tool", { stdin: "inherit" }).spawn();\n`,
      );
    }
    assertEquals(
      await inheritedTerminalSites(dir, await authoredTsFiles(dir)),
      ["another/container/relay.ts", "scripts/fresh_helper.ts"],
    );
  });
});
