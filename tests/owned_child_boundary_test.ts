/**
 * Architectural guard for inherited-terminal subprocesses.
 *
 * Arbitrary user code that inherits discern's terminal must run through the
 * owned-child boundary, which installs the interruption and reap lifecycle. A
 * direct Deno.Command spawn can die beside its foreground child or leave that
 * child behind when only the wrapper receives a signal.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));

/** Find every TypeScript source that asks a child to inherit terminal input. */
async function inheritedTerminalSites(
  scanRoot: string,
  displayRoot = scanRoot,
): Promise<string[]> {
  const sites: string[] = [];
  for await (
    const entry of walk(scanRoot, {
      includeDirs: false,
      exts: [".ts"],
    })
  ) {
    const source = await Deno.readTextFile(entry.path);
    if (/stdin\s*:\s*["']inherit["']/.test(source)) {
      sites.push(relative(displayRoot, entry.path).replaceAll("\\", "/"));
    }
  }
  return sites.sort();
}

Deno.test("every inherited-terminal child uses the owned-child boundary", async () => {
  assertEquals(
    await inheritedTerminalSites(join(REPO_ROOT, "src"), REPO_ROOT),
    ["src/engine/owned_child.ts"],
    "move inherited-terminal Deno.Command launches into runOwnedChild",
  );
});

Deno.test("the owned-child guard enrolls an unrelated future launcher", async () => {
  await withTempDir(async (dir) => {
    const future = `${dir}/another/container/relay.ts`;
    await Deno.mkdir(`${dir}/another/container`, { recursive: true });
    await Deno.writeTextFile(
      future,
      `new Deno.Command("unrelated-tool", { stdin: "inherit" }).spawn();\n`,
    );
    assertEquals(
      await inheritedTerminalSites(dir),
      ["another/container/relay.ts"],
    );
  });
});
