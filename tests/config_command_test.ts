/**
 * CLI tests for `icculus config <subcommand>` (ADR 0005), run as subprocesses so
 * Cliffy parsing, the global flags, JSON output, and exit codes are exercised for
 * real. Each scaffolds a fresh install, edits it, and asserts the resulting
 * icculus.toml (including that comments survive).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

/** Scaffold a fresh install in `dir`. */
async function init(dir: string): Promise<void> {
  const r = await runCli(
    ["init", "--yes", "--slug", "demo", "--name", "Demo"],
    dir,
  );
  assertEquals(r.code, 0, r.stderr);
}

/** Read the project's icculus.toml. */
function readToml(dir: string): Promise<string> {
  return Deno.readTextFile(join(dir, "icculus.toml"));
}

Deno.test("config set-slot fills a slot and preserves comments", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-slot",
        "test",
        "--phase",
        "test",
        "--run",
        "vitest run",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assert(
      result.edits.some((e: { key: string }) => e.key === "slots.test.run"),
    );

    const toml = await readToml(dir);
    assertStringIncludes(toml, 'run   = "vitest run"');
    // A section comment from the template survives the edit.
    assertStringIncludes(toml, "# icculus.toml");
  });
});

Deno.test("config set-slot without --phase writes a measurement slot", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-slot",
        "bundlesize",
        "--run",
        "wc -c < dist/app.js",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    // Only the run key is written — no phase, so the gate never runs it.
    assert(
      result.edits.some((e: { key: string }) =>
        e.key === "slots.bundlesize.run"
      ),
    );
    assert(
      !result.edits.some((e: { key: string }) =>
        e.key === "slots.bundlesize.phase"
      ),
    );
    const toml = await readToml(dir);
    assertStringIncludes(toml, 'run = "wc -c < dist/app.js"');
  });
});

Deno.test("config set-slot rejects an unknown phase", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-slot",
        "test",
        "--phase",
        "bogus",
        "--run",
        "x",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "unknown phase");
  });
});

Deno.test("config set-scope sets a glob array", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-scope", "native", "native/**", "native/lib/**"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      await readToml(dir),
      'native = ["native/**", "native/lib/**"]',
    );
  });
});

Deno.test("config set-side-gate sets a side-gate command", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-side-gate", "native", "--run", "make -C native check"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      await readToml(dir),
      'native = "make -C native check"',
    );
  });
});

Deno.test("config set-ratchet writes a named ratchet table", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "500000",
        "--direction",
        "down",
        "--slot",
        "bundlesize",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[ratchets.bundle]");
    assertStringIncludes(toml, "limit = 500000");
    assertStringIncludes(toml, 'direction = "down"');
    assertStringIncludes(toml, 'slot = "bundlesize"');
  });
});

Deno.test("config set-ratchet treats 'coverage' as an ordinary ratchet name", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "coverage",
        "--limit",
        "80",
        "--slot",
        "cov",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[ratchets.coverage]");
    assertStringIncludes(toml, "limit = 80");
    assertStringIncludes(toml, 'slot = "cov"');
  });
});

Deno.test("config set-ratchet requires a --slot", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-ratchet", "bundle", "--limit", "100"],
      dir,
    );
    assert(r.code !== 0); // Cliffy rejects the missing required option
  });
});

Deno.test("config set infers types (number / bool / string)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await runCli(["config", "set", "ratchets.coverage.limit", "80"], dir);
    await runCli(["config", "set", "worktree.port", "false"], dir);
    await runCli(["config", "set", "project.main_branch", "trunk"], dir);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "limit = 80"); // number (inferred)
    assertStringIncludes(toml, "port = false"); // bool (inferred)
    assertStringIncludes(toml, 'main_branch = "trunk"'); // string (inferred)
  });
});

Deno.test("config set --string forces a numeric-looking value to a string", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await runCli(["config", "set", "project.slug", "123", "--string"], dir);
    assertStringIncludes(await readToml(dir), 'slug = "123"');
  });
});

Deno.test("config --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const before = await readToml(dir);
    const r = await runCli(
      [
        "config",
        "set-slot",
        "test",
        "--phase",
        "test",
        "--run",
        "x",
        "--dry-run",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).dry_run, true);
    assertEquals(await readToml(dir), before); // unchanged
  });
});

Deno.test("config errors cleanly when not initialized", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(
      ["config", "set", "project.slug", "x", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    assertEquals(JSON.parse(r.stdout).error, "not_initialized");
  });
});
