/**
 * `init` error / edge branches not exercised by the happy-path suites
 * (`cli_test.ts`, `init_config_test.ts`, `init_managed_test.ts`). Each existing
 * error test asserts the `--json` surface; these pin the *human* (non-JSON)
 * reporting branches that print to stderr instead, plus the templates-not-found
 * guard and the fills-over-a-skipped-seed early return. Run as subprocesses via
 * `runCli` so Cliffy parsing, exit codes, and both output channels are real.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

const ANSWERS = JSON.stringify({
  version: "2",
  name: "Edge App",
  slug: "edge-app",
  capabilities: { test: "vitest run" },
});

// --- templates_not_found: resolveTemplatesDir throws (init.ts 172-180) ---

Deno.test("init reports templates_not_found in JSON when the override dir is missing", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["init", "--yes", "--json", "--slug", "demo"],
      dir,
      { DISCERN_TEMPLATES_DIR: join(dir, "does-not-exist") },
    );
    assertEquals(code, 1);
    const result = JSON.parse(stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "templates_not_found");
    assertStringIncludes(result.message, "not a directory");
    // Nothing was scaffolded — the guard fires before any plan is built.
    assert(!(await pathExists(join(dir, "discern.toml"))));
  });
});

Deno.test("init reports templates_not_found to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout, stderr } = await runCli(
      ["init", "--yes", "--slug", "demo"],
      dir,
      { DISCERN_TEMPLATES_DIR: join(dir, "nope") },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "not a directory");
    // The human branch emits no JSON payload on stdout.
    assertEquals(stdout.trim(), "");
  });
});

// --- already_initialized, human branch (init.ts 163-165) ---

Deno.test("init refuses over an existing discern.toml to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "first"], dir)).code,
      0,
    );
    const { code, stdout, stderr } = await runCli(
      ["init", "--yes", "--slug", "again"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "a discern install already exists here");
    assertStringIncludes(stderr, "--force");
    // No JSON payload printed in the human branch.
    assertEquals(stdout.trim(), "");
  });
});

// --- invalid_config_file from loadConfigDoc, human branch (init.ts 191-193) ---

Deno.test("init reports invalid --config JSON to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "bad.json"), "{ not json");
    const { code, stdout, stderr } = await runCli(
      ["init", "--config", "bad.json"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "not valid JSON");
    assertEquals(stdout.trim(), "");
    // The guard fired before planning — nothing scaffolded.
    assert(!(await pathExists(join(dir, "discern.toml"))));
  });
});

Deno.test("init reports a missing --config file to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout, stderr } = await runCli(
      ["init", "--config", "absent.json"],
      dir,
    );
    assertEquals(code, 1);
    // loadConfigDoc wraps a read failure with the path it tried.
    assertStringIncludes(stderr, "could not read --config file");
    assertStringIncludes(stderr, "absent.json");
    assertEquals(stdout.trim(), "");
  });
});

// --- invalid fills from assembleInitPlan, human branch (init.ts 220-222) ---

Deno.test("init reports invalid --config fills to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    // A document that parses and is the right version, but carries an invalid
    // fill (bad check stage) — so loadConfigDoc succeeds and the error surfaces
    // later, inside assembleInitPlan via applyConfigDoc.
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({
        slug: "x",
        checks: { t: { stage: "bogus", run: "x" } },
      }),
    );
    const { code, stdout, stderr } = await runCli(
      ["init", "--config", "answers.json"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "invalid --config fills");
    assertStringIncludes(stderr, "stage");
    assertEquals(stdout.trim(), "");
    // The failure happened during planning: nothing was written.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 1); // just answers.json
  });
});

// --- applyFillsToPlan early return when discern.toml is a skip (init.ts 143-145) ---

Deno.test("init --force --config leaves an existing discern.toml untouched (fills skip the seed)", async () => {
  await withTempDir(async (dir) => {
    // First, a plain install so a seed discern.toml exists on disk.
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "edge-app"], dir)).code,
      0,
    );
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    // The fresh seed carries no capability fills.
    assert(!before.includes('test = "vitest run"'));

    // Re-init with --force AND a --config that *would* fill capabilities. Because
    // discern.toml is a seed already present, its plan op is `skip`, so
    // applyFillsToPlan returns early and never applies the fills — the seed is
    // left exactly as the user's.
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const run = await runCli(
      ["init", "--force", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(run.code, 0, run.stderr);
    assertEquals(JSON.parse(run.stdout).ok, true);

    // The seed is byte-for-byte unchanged: the fills did not land.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    assertEquals(after, before);
    assert(!after.includes('test = "vitest run"'));
  });
});

/** True when a path exists on disk. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
