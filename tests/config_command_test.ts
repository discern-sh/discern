/**
 * CLI tests for `discern config <subcommand>` (ADR 0005), run as subprocesses so
 * Cliffy parsing, the global flags, JSON output, and exit codes are exercised for
 * real. Each scaffolds a fresh install, edits it, and asserts the resulting
 * discern.toml (including that comments survive).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { recordConfigPaths } from "../src/shared/config_codegen.ts";
import { runCli, withTempDir } from "./helpers.ts";

/** Scaffold a fresh install in `dir`. */
async function setup(dir: string): Promise<void> {
  const r = await runCli(
    ["setup", "--confirmed", "--yes", "--slug", "demo", "--name", "Demo"],
    dir,
  );
  assertEquals(r.code, 0, r.stderr);
}

/** Read the project's discern.toml. */
function readToml(dir: string): Promise<string> {
  return Deno.readTextFile(join(dir, "discern.toml"));
}

Deno.test("config set-capability fills a capability and preserves comments", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      ["config", "set-capability", "test", "vitest run", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "config");
    assert(
      result.data.edits.some((e: { key: string }) =>
        e.key === "capabilities.test"
      ),
    );

    const toml = await readToml(dir);
    assertStringIncludes(toml, 'test = "vitest run"');
    // A section comment from the template survives the edit.
    assertStringIncludes(
      toml,
      "# discern | https://discern.sh | project configuration file",
    );
  });
});

Deno.test("config set-capability round-trips the smoke capability (ADR 0090)", async () => {
  // `smoke` is a first-class known capability (stage: test), so set-capability accepts
  // it and the written line re-parses cleanly — the same path every capability takes.
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      // `true` is a real, PATH-resolvable stand-in for a boot check (so doctor stays
      // green); the point is that `smoke` takes the same accept→write→load path as any
      // known capability.
      ["config", "set-capability", "smoke", "true", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assert(
      result.data.edits.some((e: { key: string }) =>
        e.key === "capabilities.smoke"
      ),
    );
    assertStringIncludes(await readToml(dir), 'smoke = "true"');
    // The install still loads cleanly with smoke wired.
    const doctor = await runCli(["doctor", "--json"], dir);
    assertEquals(JSON.parse(doctor.stdout).ok, true);
  });
});

Deno.test("config set refuses an unknown key at write time (no bricked config)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const before = await readToml(dir);
    const r = await runCli(
      ["config", "set", "project.frobnicate", "hello", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "unknown_key");
    assertStringIncludes(result.message, "unknown config key");
    // The config is untouched — the bad key was never written.
    assertEquals(await readToml(dir), before);
    // And the install still loads cleanly.
    const doctor = await runCli(["doctor", "--json"], dir);
    assertEquals(JSON.parse(doctor.stdout).ok, true);
  });
});

Deno.test("config set allows a valid-but-incomplete path (incremental table build)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Setting one key of a ratchet table before its siblings is legitimate.
    const r = await runCli(
      ["config", "set", "ratchets.coverage.limit", "80"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(await readToml(dir), "limit = 80");
  });
});

Deno.test("config set-capability rejects an unknown capability name", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      ["config", "set-capability", "deploy", "deploy.sh", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "unknown capability");
  });
});

Deno.test("config set-check writes a check table", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-check",
        "licenses",
        "--stage",
        "check",
        "--run",
        "license-scan",
        "--provides",
        "license-audit",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assert(
      result.data.edits.some((e: { key: string }) =>
        e.key === "checks.licenses.run"
      ),
    );
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[checks.licenses]");
    assertStringIncludes(toml, 'stage = "check"');
    assertStringIncludes(toml, 'run = "license-scan"');
    assertStringIncludes(toml, 'provides = "license-audit"');
  });
});

Deno.test("config set-check rejects an unknown stage", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-check",
        "x",
        "--stage",
        "deploy",
        "--run",
        "y",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "unknown stage");
  });
});

Deno.test("config set-scope sets a paths array", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      ["config", "set-scope", "native", "native/**", "native/lib/**"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[scopes.native]");
    assertStringIncludes(toml, 'paths = ["native/**", "native/lib/**"]');
  });
});

Deno.test("config set-scope folds in --neutral and --gate", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-scope",
        "native",
        "native/**",
        "--gate",
        "make -C native check",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      await readToml(dir),
      'gate = "make -C native check"',
    );
  });
});

Deno.test("config set-ratchet writes a named ratchet table", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "500000",
        "--direction",
        "down",
        "--run",
        "measure-bundle",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[ratchets.bundle]");
    assertStringIncludes(toml, "limit = 500000");
    assertStringIncludes(toml, 'direction = "down"');
    assertStringIncludes(toml, 'run = "measure-bundle"');
  });
});

Deno.test("config set-ratchet treats 'coverage' as an ordinary ratchet name", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "coverage",
        "--limit",
        "80",
        "--run",
        "measure-cov",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "[ratchets.coverage]");
    assertStringIncludes(toml, "limit = 80");
    assertStringIncludes(toml, 'run = "measure-cov"');
  });
});

Deno.test("config set-ratchet requires a --run", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      ["config", "set-ratchet", "bundle", "--limit", "100"],
      dir,
    );
    assert(r.code !== 0); // Cliffy rejects the missing required option
  });
});

Deno.test("config set infers types (number / bool / string)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await runCli(["config", "set", "ratchets.coverage.limit", "80"], dir);
    await runCli(["config", "set", "worktree.port", "false"], dir);
    await runCli(["config", "set", "project.main_branch", "trunk"], dir);
    const toml = await readToml(dir);
    assertStringIncludes(toml, "limit = 80"); // number (inferred)
    assertStringIncludes(toml, "port = false"); // bool (inferred)
    assertStringIncludes(toml, 'main_branch = "trunk"'); // string (inferred)
  });
});

Deno.test("config set preserves the edited line's inline comment", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      ["config", "set", "features.worktrees", "false"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      await readToml(dir),
      "worktrees = false   # the isolated git-worktree workflow",
    );
  });
});

Deno.test("config set --string forces a numeric-looking value to a string", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await runCli(["config", "set", "project.slug", "123", "--string"], dir);
    assertStringIncludes(await readToml(dir), 'slug = "123"');
  });
});

Deno.test("config --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const before = await readToml(dir);
    const r = await runCli(
      [
        "config",
        "set-capability",
        "test",
        "vitest run",
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
    assertStringIncludes(r.stderr, "no discern install here");
  });
});

Deno.test("config set-<record> rejects a malformed name in every record section", async () => {
  // Every `config set-<record>` subcommand validates its <name> through the same
  // rule. Sections derive from the schema SSOT (recordConfigPaths); the args differ
  // per subcommand (scope takes globs, check takes --stage/--run, ratchet takes
  // --limit/--run), so a fixture arg-list is mapped per kind and asserted to cover
  // exactly the sections — a new record section forces an entry here (or an
  // exemption). worktree.resources has no `set-resource` subcommand: a self-checking
  // exemption from the CLI record-writer set.
  const SET_RECORD_ARGS: Record<string, string[]> = {
    check: ["--stage", "check", "--run", "x"],
    scope: ["src/**"],
    ratchet: ["--limit", "80", "--run", "m"],
  };
  const EXEMPT = new Set(["worktree.resources"]);
  const all = recordConfigPaths();
  for (const p of EXEMPT) {
    assert(all.includes(p), `EXEMPT lists "${p}", no longer a record section`);
  }
  const kinds = all.filter((p) => !EXEMPT.has(p)).map((p) =>
    p.replace(/s$/, "")
  );
  assertEquals(
    Object.keys(SET_RECORD_ARGS).sort(),
    [...kinds].sort(),
    "SET_RECORD_ARGS must cover exactly the record-section set-<kind> subcommands",
  );

  for (const [kind, extra] of Object.entries(SET_RECORD_ARGS)) {
    await withTempDir(async (dir) => {
      await setup(dir);
      const r = await runCli(
        ["config", `set-${kind}`, "bad name", ...extra, "--json"],
        dir,
      );
      assertEquals(r.code, 1, r.stderr);
      const result = JSON.parse(r.stdout);
      assertEquals(result.ok, false);
      assertEquals(result.error, "invalid_argument");
      assertStringIncludes(result.message, `${kind} name must be`);
    });
  }
});

Deno.test("config set-scope: Cliffy rejects zero globs before the handler", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // `<globs...>` is a required variadic, so Cliffy fails (exit 2) before the
    // handler's own globs.length===0 guard can run — see findings.
    const r = await runCli(["config", "set-scope", "native"], dir);
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "Missing argument");
  });
});

Deno.test("config set-ratchet rejects an invalid --direction", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "80",
        "--run",
        "m",
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
    await setup(dir);
    const r = await runCli(
      [
        "config",
        "set-ratchet",
        "bundle",
        "--limit",
        "lots",
        "--run",
        "m",
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
    await setup(dir);
    const r = await runCli(
      ["config", "set-ratchet", "cov", "--limit", "80", "--run", "measure-cov"],
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
    await setup(dir);
    const r = await runCli(["config", "set", "slug", "x", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertStringIncludes(result.message, "key must be section.key");
  });
});

Deno.test("config set rejects more than one type flag", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
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
    await setup(dir);
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
    await setup(dir);
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
    await setup(dir);
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
    await setup(dir);
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
    await setup(dir);
    const before = await readToml(dir);
    const r = await runCli(
      ["config", "set", "project.slug", "renamed", "--dry-run", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.dry_run, true);
    assertEquals(result.data.file, "discern.toml");
    assert(
      result.data.edits.some((e: { key: string; literal: string }) =>
        e.key === "project.slug" && e.literal === '"renamed"'
      ),
    );
    assertEquals(await readToml(dir), before); // unchanged
  });
});
