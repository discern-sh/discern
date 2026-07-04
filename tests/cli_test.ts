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
  const p = join(dir, "discern.toml");
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

Deno.test("setup --json scaffolds and reports JSON", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      [
        "setup",
        "--confirmed",
        "--json",
        "--name",
        "CLI Demo",
        "--slug",
        "cli-demo",
      ],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "setup");
    assertEquals(result.data.project.slug, "cli-demo");
    assert(Array.isArray(result.data.written));
    // The whole machinery footprint is the single root config file (ADR 0020).
    assert(result.data.written.includes("discern.toml"));
    // setup compiles the agent files; `compiled` lists them.
    assert(Array.isArray(result.data.compiled));
    assert(result.data.compiled.includes("AGENTS.md"));
    assert(result.data.compiled.includes("CLAUDE.md"));
    // It also lays the doc skeletons; `skeletons` lists them, and it prints the
    // agent instructions inline.
    assert(result.data.skeletons.includes("docs/"));
    assert(typeof result.data.instructions === "string");
    // The files really landed.
    await Deno.stat(join(dir, "discern.toml"));
    await Deno.stat(join(dir, "AGENTS.md"));
    await Deno.stat(join(dir, "CLAUDE.md"));
    // The bundled skills are materialized into `.claude/skills/` (gitignored).
    await Deno.stat(join(dir, ".claude/skills"));
    // setup wires the discern MCP server for Claude Code (ADR 0031): `.mcp.json`
    // is written and reported under `mcp_wired`.
    assert(Array.isArray(result.data.mcp_wired));
    assert(
      result.data.mcp_wired.includes(".mcp.json"),
      JSON.stringify(result.data.mcp_wired),
    );
    const mcp = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcp.mcpServers.discern.command, "discern");
    // No committed shell engine: there is no root `agent` dispatcher.
    await assertNotExists(join(dir, "agent"));
  });
});

Deno.test("setup --dry-run --json writes nothing", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["setup", "--confirmed", "--dry-run", "--json", "--slug", "dry-demo"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.dry_run, true);
    assert(Array.isArray(result.data.plan));
    // Nothing was written.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 0);
  });
});

Deno.test("setup re-run over a set-up install reports already_set_up (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--slug", "first"], dir);
    // Mark setup complete (--force: the laid skeletons still carry markers).
    await runCli(["setup", "done", "--force"], dir);
    // `begin` on a recorded install is idempotent — it reports already_set_up rather
    // than re-scaffolding (the welcome's `phase: done` is the parent's equivalent).
    const { code, stdout } = await runCli(["setup", "begin", "--json"], dir);
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    assertEquals(result.data.already_set_up, true);
  });
});

Deno.test("setup --force re-scaffolds an existing install without erroring", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--json", "--slug", "first"], dir);
    const { code, stdout } = await runCli(
      ["setup", "--confirmed", "--force", "--json", "--slug", "first"],
      dir,
    );
    assertEquals(code, 0);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, true);
    // The existing config seed is left as-is (a present seed is skipped), so it
    // is not in the written list.
    assert(!result.data.written.includes("discern.toml"));
    // The agent files are recompiled on every run, so `compiled` lists them.
    assert(result.data.compiled.includes("AGENTS.md"));
    assert(result.data.compiled.includes("CLAUDE.md"));
  });
});

Deno.test("setup --force leaves a pre-existing seed file untouched (no overwrite, no .new)", async () => {
  await withTempDir(async (dir) => {
    // A repo already carrying the config seed the kit would scaffold; the present
    // seed is left as the user's (skipped), not overwritten.
    const userBody = "# the user's own config — must survive setup\n";
    await Deno.writeTextFile(join(dir, "discern.toml"), userBody);

    const { code } = await runCli(
      ["setup", "--confirmed", "--force", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    // The user's file is byte-for-byte intact; no `.new` sibling is produced.
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      userBody,
    );
    await assertNotExists(join(dir, "discern.toml.new"));
  });
});

Deno.test("setup rejects an invalid --slug", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runCli(
      ["setup", "--confirmed", "--slug", "Bad Slug"],
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
    const toml = result.data.checks.find((c: { name: string }) =>
      c.name === "discern.toml"
    );
    assertEquals(toml.ok, false);
    assert(typeof toml.fix === "string" && toml.fix.length > 0);
  });
});

Deno.test("doctor flags a stale schema version and points at upgrade", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["setup", "--confirmed", "--slug", "demo"], dir)).code,
      0,
    );
    // Model an install left a schema behind (a migration shipped since).
    await setSchema(dir, 1);

    const { stdout } = await runCli(["doctor", "--json"], dir);
    const result = JSON.parse(stdout);
    const schema = result.data.checks.find((c: { name: string }) =>
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
      (await runCli(["setup", "--confirmed", "--slug", "demo"], dir)).code,
      0,
    );
    const { stdout } = await runCli(["doctor", "--json"], dir);
    const result = JSON.parse(stdout);
    const schema = result.data.checks.find((c: { name: string }) =>
      c.name === "schema version"
    );
    assert(
      schema !== undefined && schema.ok === true,
      "schema should be current",
    );
  });
});

Deno.test("preset reports unknown preset with a friendly error", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--json", "--slug", "demo"], dir);
    const { code, stdout } = await runCli(
      ["preset", "node", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "unknown_preset");
  });
});

Deno.test("a malformed discern.toml fails cleanly (no stack trace), in human and JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );
    // Human mode: a one-line diagnostic on stderr, exit 1, no raw "Uncaught".
    const human = await runCli(["config", "get", "project.slug"], dir);
    assertEquals(human.code, 1);
    assertStringIncludes(human.stderr, "syntax error near line");
    assertStringIncludes(human.stderr, "discern.toml");
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
