/**
 * CLI tests for `icculus migrate` (ADR 0009): rewrite a pre-1.0 icculus.toml to
 * the 1.0 shape — coverage_min → [ratchets.coverage], the coverage phase →
 * measurement slot, and {{db}} → @db@ — comment-preserving, idempotent, and
 * honouring --dry-run / --json. Run as subprocesses.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

/** A representative pre-1.0 config carrying all three removed shapes. */
const PRE_1_0 = [
  "# icculus.toml",
  "[project]",
  'slug = "demo"',
  "",
  "[slots.coverage]",
  'phase = "coverage"',
  'run = "echo ICCULUS_METRIC coverage 90"',
  "",
  "[ratchets]",
  "coverage_min = 80",
  "",
  "[worktree.db]",
  'clone = "createdb {{db}}"',
  "",
].join("\n");

function writeToml(dir: string, text: string): Promise<void> {
  return Deno.writeTextFile(join(dir, "icculus.toml"), text);
}
function readToml(dir: string): Promise<string> {
  return Deno.readTextFile(join(dir, "icculus.toml"));
}

Deno.test("migrate converts coverage_min, the coverage phase, and worktree tokens", async () => {
  await withTempDir(async (dir) => {
    await writeToml(dir, PRE_1_0);
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).migrated, true);

    const toml = await readToml(dir);
    assertStringIncludes(toml, "[ratchets.coverage]");
    assertStringIncludes(toml, "limit = 80");
    assertStringIncludes(toml, 'slot = "coverage"');
    assert(!toml.includes("coverage_min"), "the scalar should be removed");
    assert(
      !toml.includes('phase = "coverage"'),
      "the phase should be stripped",
    );
    assertStringIncludes(toml, 'clone = "createdb @db@"'); // token rewritten
    assert(!toml.includes("{{db}}"));
    // Comment-preserving: the leading comment survives.
    assertStringIncludes(toml, "# icculus.toml");
  });
});

Deno.test("migrate drops a disabled coverage_min = 0 without creating a ratchet", async () => {
  await withTempDir(async (dir) => {
    await writeToml(
      dir,
      ["[project]", 'slug = "demo"', "", "[ratchets]", "coverage_min = 0", ""]
        .join("\n"),
    );
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assert(!toml.includes("coverage_min"));
    assert(!toml.includes("[ratchets.coverage]"));
  });
});

Deno.test("migrate is idempotent — a fresh 1.0 install reports nothing to migrate", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
      0,
    );
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).migrated, false);
  });
});

Deno.test("migrate --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    await writeToml(dir, PRE_1_0);
    const before = await readToml(dir);
    const r = await runCli(["migrate", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).dry_run, true);
    assertEquals(await readToml(dir), before);
  });
});

Deno.test("migrate errors cleanly when not initialized", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 1);
    assertEquals(JSON.parse(r.stdout).error, "not_initialized");
  });
});
