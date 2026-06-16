/**
 * CLI-surface tests: run `src/main.ts` as a subprocess so Cliffy parsing, the
 * global flags, JSON output, and process exit codes are all exercised for real.
 * These complement the unit/plan tests, which call the command functions
 * directly.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

/** True when a path exists on disk. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("--version prints the kit version", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["--version"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "1.0.0");
  });
});

Deno.test("init --yes --json scaffolds and reports JSON", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["init", "--yes", "--json", "--name", "CLI Demo", "--slug", "cli-demo"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    assertEquals(result.project.slug, "cli-demo");
    assert(Array.isArray(result.written));
    assert(result.written.includes("icculus.toml"));
    assert(result.written.includes("bin/agent"));
    // The files really landed.
    await Deno.stat(join(dir, "icculus.toml"));
    await Deno.stat(join(dir, "bin/agent"));
  });
});

Deno.test("init --dry-run --json writes nothing", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["init", "--yes", "--dry-run", "--json", "--slug", "dry-demo"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.dry_run, true);
    assert(Array.isArray(result.plan));
    // Nothing was written.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 0);
  });
});

Deno.test("init refuses over an existing icculus.toml without --force", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--json", "--slug", "first"], dir);
    const { code, stdout } = await runCli(
      ["init", "--yes", "--json", "--slug", "again"],
      dir,
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "already_initialized");
  });
});

Deno.test("init --force proceeds over an existing install", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--json", "--slug", "first"], dir);
    const { code, stdout } = await runCli(
      ["init", "--yes", "--force", "--json", "--slug", "first"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    // A pristine re-install refreshes nothing into `.new`.
    assertEquals(result.new_files, []);
  });
});

Deno.test("init preserves a pre-existing managed file: .new in plan and result JSON", async () => {
  await withTempDir(async (dir) => {
    // A repo already carrying a same-named managed file, no icculus manifest.
    await Deno.mkdir(join(dir, ".icculus/engine"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/engine/finish"),
      "#!/bin/sh\n# the user's own finish recipe\n",
    );

    // 1. Dry-run --json must show the `.new` disposition without writing.
    const dry = await runCli(
      ["init", "--yes", "--dry-run", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(dry.code, 0);
    const dryResult = JSON.parse(dry.stdout);
    const newOp = dryResult.plan.find((op: { path: string }) =>
      op.path === ".icculus/engine/finish.new"
    );
    assert(newOp, "dry-run plan should contain a .new op for the managed file");
    assertEquals(newOp.action, "new");
    // Dry-run wrote nothing: no manifest, no .new on disk.
    assert(!(await pathExists(join(dir, ".icculus/engine/finish.new"))));
    assert(!(await pathExists(join(dir, "icculus.toml"))));

    // 2. The real run preserves the original and reports the `.new` in JSON.
    const { code, stdout } = await runCli(
      ["init", "--yes", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assert(
      result.new_files.includes(".icculus/engine/finish.new"),
      "result JSON should list the preserved file's .new sibling",
    );
    // Original survived byte-for-byte; the kit's version is alongside.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".icculus/engine/finish")),
      "the user's own finish recipe",
    );
    await Deno.stat(join(dir, ".icculus/engine/finish.new"));
  });
});

Deno.test("init rejects an invalid --slug", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runCli(
      ["init", "--yes", "--slug", "Bad Slug"],
      dir,
    );
    assert(code !== 0);
    assertStringIncludes(stderr, "invalid --slug");
  });
});

Deno.test("doctor --json reports invalid result when not initialized", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["doctor", "--json"], dir);
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    const toml = result.checks.find((c: { name: string }) =>
      c.name === "icculus.toml"
    );
    assertEquals(toml.ok, false);
    assert(typeof toml.fix === "string" && toml.fix.length > 0);
  });
});

Deno.test("add-adapter reports unknown adapter with a friendly error", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--json", "--slug", "demo"], dir);
    const { code, stdout } = await runCli(
      ["add-adapter", "node", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "unknown_adapter");
  });
});
