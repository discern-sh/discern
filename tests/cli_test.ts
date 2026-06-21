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

/** Assert a path does NOT exist on disk. */
async function assertNotExists(path: string): Promise<void> {
  assert(!(await pathExists(path)), `expected ${path} not to exist`);
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "icculus.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
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
    // The whole footprint is the single root config file (ADR 0020).
    assert(result.written.includes("icculus.toml"));
    // init now compiles the agent files; `compiled` lists them.
    assert(Array.isArray(result.compiled));
    assert(result.compiled.includes("AGENTS.md"));
    assert(result.compiled.includes("CLAUDE.md"));
    // The files really landed.
    await Deno.stat(join(dir, "icculus.toml"));
    await Deno.stat(join(dir, "AGENTS.md"));
    await Deno.stat(join(dir, "CLAUDE.md"));
    // The bundled skills are materialized into `.claude/skills/` (gitignored).
    await Deno.stat(join(dir, ".claude/skills"));
    // No committed shell engine: there is no root `agent` dispatcher.
    await assertNotExists(join(dir, "agent"));
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

Deno.test("init --force proceeds over an existing install (re-runs without erroring)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--json", "--slug", "first"], dir);
    const { code, stdout } = await runCli(
      ["init", "--yes", "--force", "--json", "--slug", "first"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    // The existing config seed is left as-is (a present seed is skipped), so it
    // is not in the written list.
    assert(!result.written.includes("icculus.toml"));
    // The agent files are recompiled on every run, so `compiled` lists them.
    assert(result.compiled.includes("AGENTS.md"));
    assert(result.compiled.includes("CLAUDE.md"));
  });
});

Deno.test("init leaves a pre-existing seed file untouched (no overwrite, no .new)", async () => {
  await withTempDir(async (dir) => {
    // A repo already carrying the config seed the kit would scaffold. `--force`
    // is needed since init otherwise refuses over an existing install; with it,
    // the present seed is left as the user's (skipped), not overwritten.
    const userBody = "# the user's own config — must survive init\n";
    await Deno.writeTextFile(join(dir, "icculus.toml"), userBody);

    const { code } = await runCli(
      ["init", "--yes", "--force", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    // The user's file is byte-for-byte intact; no `.new` sibling is produced.
    assertEquals(
      await Deno.readTextFile(join(dir, "icculus.toml")),
      userBody,
    );
    await assertNotExists(join(dir, "icculus.toml.new"));
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

Deno.test("doctor flags a stale schema version and points at upgrade", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
      0,
    );
    // Model an install left a schema behind (a migration shipped since).
    await setSchema(dir, 1);

    const { stdout } = await runCli(["doctor", "--json"], dir);
    const result = JSON.parse(stdout);
    const schema = result.checks.find((c: { name: string }) =>
      c.name === "schema version"
    );
    assert(schema !== undefined, "expected a 'schema version' check");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.fix, "upgrade");
  });
});

Deno.test("doctor reports the schema version is current on a fresh install", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
      0,
    );
    const { stdout } = await runCli(["doctor", "--json"], dir);
    const result = JSON.parse(stdout);
    const schema = result.checks.find((c: { name: string }) =>
      c.name === "schema version"
    );
    assert(
      schema !== undefined && schema.ok === true,
      "schema should be current",
    );
  });
});

Deno.test("add-preset reports unknown preset with a friendly error", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--json", "--slug", "demo"], dir);
    const { code, stdout } = await runCli(
      ["add-preset", "node", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "unknown_preset");
  });
});

Deno.test("a malformed icculus.toml fails cleanly (no stack trace), in human and JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "icculus.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );
    // Human mode: a one-line diagnostic on stderr, exit 1, no raw "Uncaught".
    const human = await runCli(["config", "get", "project.slug"], dir);
    assertEquals(human.code, 1);
    assertStringIncludes(human.stderr, "syntax error near line");
    assertStringIncludes(human.stderr, "icculus.toml");
    assert(
      !human.stderr.includes("Uncaught"),
      `must not dump a stack trace:\n${human.stderr}`,
    );
    // JSON mode: a structured error on stdout (a CI/agent consumer parses it).
    const json = await runCli(["finish", "--json"], dir);
    assertEquals(json.code, 1);
    const result = JSON.parse(json.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_toml");
  });
});
