/**
 * CLI-surface tests: run `src/main.ts` as a subprocess so Cliffy parsing, the
 * global flags, JSON output, and process exit codes are all exercised for real.
 * These complement the unit/plan tests, which call the command functions
 * directly.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTempDir } from "./helpers.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const MAIN = join(ROOT, "src", "main.ts");
const REAL_TEMPLATES = join(ROOT, "templates");

/** Run the CLI as a subprocess in `cwd`, returning code + decoded streams. */
async function runCli(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      MAIN,
      ...args,
    ],
    cwd,
    env: { ICCULUS_TEMPLATES_DIR: REAL_TEMPLATES, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("--version prints the kit version", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["--version"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "0.1.0");
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
    assertEquals(JSON.parse(stdout).ok, true);
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
