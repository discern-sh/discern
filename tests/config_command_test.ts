/**
 * CLI tests for `icculus config <subcommand>` (ADR 0005), run as subprocesses so
 * Cliffy parsing, the global flags, JSON output, and exit codes are exercised for
 * real. Each scaffolds a fresh install, edits it, and asserts the resulting
 * .icculus/config.toml (including that comments survive).
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

/** Read the project's .icculus/config.toml. */
function readToml(dir: string): Promise<string> {
  return Deno.readTextFile(join(dir, ".icculus/config.toml"));
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
    assertStringIncludes(toml, "# .icculus/config.toml");
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

Deno.test("config errors to stderr (not JSON) when not initialized", async () => {
  await withTempDir(async (dir) => {
    // No --json: the message lands on stderr and stdout stays empty.
    const r = await runCli(["config", "set", "project.slug", "x"], dir);
    assertEquals(r.code, 1);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "no icculus install here");
  });
});

Deno.test("config set-slot rejects a malformed slot name", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-slot", "bad name", "--run", "x", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_argument");
    assertStringIncludes(result.message, "slot name must be");
  });
});

Deno.test("config set-scope rejects a malformed scope name", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-scope", "bad/name", "src/**", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "scope name must be");
  });
});

Deno.test("config set-scope: Cliffy rejects zero globs before the handler", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // `<globs...>` is a required variadic, so Cliffy fails (exit 2) before the
    // handler's own globs.length===0 guard can run — see findings.
    const r = await runCli(["config", "set-scope", "native"], dir);
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "Missing argument");
  });
});

Deno.test("config set-side-gate rejects a malformed scope name", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-side-gate", "bad.scope", "--run", "make", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "side-gate scope must be");
  });
});

Deno.test("config set-ratchet rejects a malformed ratchet name", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bad name",
        "--limit",
        "80",
        "--slot",
        "cov",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "ratchet name must be");
  });
});

Deno.test("config set-ratchet rejects an invalid --direction", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "80",
        "--slot",
        "cov",
        "--direction",
        "sideways",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, '--direction must be "up" or "down"');
  });
});

Deno.test("config set-ratchet rejects a non-numeric --limit", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "lots",
        "--slot",
        "cov",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "--limit must be a number");
  });
});

Deno.test("config set-ratchet defaults metric to the name and direction to up", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set-ratchet", "cov", "--limit", "80", "--slot", "cov"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    // No --metric / --direction given: metric falls back to the ratchet name,
    // direction to "up".
    assertStringIncludes(toml, 'metric = "cov"');
    assertStringIncludes(toml, 'direction = "up"');
  });
});

Deno.test("config set rejects a key without a section", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["config", "set", "slug", "x", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "key must be section.key");
  });
});

Deno.test("config set rejects more than one type flag", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set", "project.slug", "1", "--number", "--bool", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "at most one of");
  });
});

Deno.test("config set --bool forces a boolean and rejects a non-boolean", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Valid: "true"/"false" pass through tomlBool.
    const ok = await runCli(
      ["config", "set", "worktree.enabled", "true", "--bool"],
      dir,
    );
    assertEquals(ok.code, 0, ok.stderr);
    assertStringIncludes(await readToml(dir), "enabled = true");

    // Invalid: --bool with a non-boolean throws, surfaced as a failure.
    const bad = await runCli(
      ["config", "set", "worktree.enabled", "yes", "--bool", "--json"],
      dir,
    );
    assertEquals(bad.code, 1);
    const result = JSON.parse(bad.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "--bool value must be");
  });
});

Deno.test("config set --number forces a numeric literal and rejects non-numbers", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Valid: preserves the written form.
    const ok = await runCli(
      ["config", "set", "ratchets.coverage.limit", "0.0", "--number"],
      dir,
    );
    assertEquals(ok.code, 0, ok.stderr);
    assertStringIncludes(await readToml(dir), "limit = 0.0");

    // Invalid: --number with a non-number is rejected (tomlNumber throws).
    const bad = await runCli(
      [
        "config",
        "set",
        "ratchets.coverage.limit",
        "lots",
        "--number",
        "--json",
      ],
      dir,
    );
    assertEquals(bad.code, 1);
    assertEquals(JSON.parse(bad.stdout).ok, false);
  });
});

Deno.test("config set prints a human success line without --json", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(
      ["config", "set", "project.main_branch", "trunk"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    // Non-JSON path: the green summary goes to stderr; the edit line to stdout.
    assertStringIncludes(r.stderr, "Set project.main_branch.");
    assertStringIncludes(r.stdout, 'project.main_branch = "trunk"');
    assertStringIncludes(await readToml(dir), 'main_branch = "trunk"');
  });
});

Deno.test("config --dry-run prints the edit without --json and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const before = await readToml(dir);
    const r = await runCli(
      ["config", "set", "project.main_branch", "trunk", "--dry-run"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    // Human dry-run path: the "Dry run" notice goes to stderr (log.info), the
    // would-be edit line to stdout (log.line).
    assertStringIncludes(r.stderr, "Dry run");
    assertStringIncludes(r.stdout, 'project.main_branch = "trunk"');
    assertEquals(await readToml(dir), before); // unchanged
  });
});

Deno.test("config set --dry-run --json reports the edit and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const before = await readToml(dir);
    const r = await runCli(
      ["config", "set", "project.slug", "renamed", "--dry-run", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.dry_run, true);
    assertEquals(result.file, ".icculus/config.toml");
    assert(
      result.edits.some((e: { key: string; literal: string }) =>
        e.key === "project.slug" && e.literal === '"renamed"'
      ),
    );
    assertEquals(await readToml(dir), before); // unchanged
  });
});
