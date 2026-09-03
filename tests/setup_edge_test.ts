/**
 * `setup` error / edge branches not exercised by the happy-path suites
 * (`cli_test.ts`, `setup_config_test.ts`). Each existing
 * error test asserts the `--json` surface; these pin the *human* (non-JSON)
 * reporting branches that print to stderr instead, plus the templates-not-found
 * guard and the fills-over-a-skipped-seed early return. Run as subprocesses via
 * `runCli` so Cliffy parsing, exit codes, and both output channels are real.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

const ANSWERS = JSON.stringify({
  version: "2",
  name: "Edge App",
  slug: "edge-app",
  jobs: { test: "vitest run" },
});

// --- templates_not_found: resolveTemplatesDir throws ---

Deno.test("setup reports templates_not_found in JSON when the override dir is missing", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["setup", "begin", "--confirmed", "--json", "--slug", "demo"],
      dir,
      { DISCERN_TEMPLATES_DIR: join(dir, "does-not-exist") },
    );
    assertEquals(code, 1);
    const result = decodeCliResult(stdout, "setup begin");
    assertEquals(result.ok, false);
    assertEquals(result.error, "templates_not_found");
    assertExists(result.message);
    assertStringIncludes(result.message, "not a directory");
    // Nothing was scaffolded — the guard fires before any plan is built.
    assert(!(await targetExists(join(dir, "discern.toml"))));
  });
});

Deno.test("setup begin --json reports a partial refresh as top-level not-ok while keeping the scaffold", async () => {
  await withTempDir(async (dir) => {
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);

    const { code, stdout } = await runCli(
      ["setup", "begin", "--confirmed", "--json", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 1);
    const result = decodeCliResult(stdout, "setup begin");
    assertResultDataKey(result, "instruction_refresh");
    assertEquals(result.ok, false);
    assertEquals(result.error, "partial_refresh");
    const refresh = result.data.instruction_refresh;
    assertExists(refresh);
    assertEquals(refresh.status, "partial");
    if (refresh.status !== "partial") return;
    assertStringIncludes(
      refresh.failures.map((failure) => failure.evidence).join("\n"),
      "malformed JSON",
    );
    assertEquals(refresh.effects_preserved, true);
    assertEquals(refresh.recovery.command, "discern refresh");
    assert(await targetExists(join(dir, "discern.toml")));
    assertEquals(await Deno.readTextFile(join(dir, ".mcp.json")), malformed);
  });
});

Deno.test("setup reports templates_not_found to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout, stderr } = await runCli(
      ["setup", "begin", "--confirmed", "--slug", "demo"],
      dir,
      { DISCERN_TEMPLATES_DIR: join(dir, "nope") },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "not a directory");
    // The human branch emits no JSON payload on stdout.
    assertEquals(stdout.trim(), "");
  });
});

// --- already-set-up, human branch (setup is idempotent, not a refusal) ---

Deno.test("setup reports already-set-up to stdout once recorded, without --json", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["setup", "begin", "--confirmed", "--slug", "first"], dir))
        .code,
      0,
    );
    // Record completion (--force: the laid skeletons still carry markers).
    assertEquals((await runCli(["setup", "done", "--force"], dir)).code, 0);

    // A re-run is not a refusal — it reports it is already set up and exits 0.
    const { code, stdout } = await runCli([
      "setup",
      "begin",
      "--confirmed",
      "--slug",
      "again",
    ], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "already set up");
  });
});

// --- invalid_config_file from loadConfigDoc, human branch ---

Deno.test("setup reports invalid --config JSON to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "bad.json"), "{ not json");
    const { code, stdout, stderr } = await runCli(
      ["setup", "begin", "--config", "bad.json"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "not valid JSON");
    assertEquals(stdout.trim(), "");
    // The guard fired before planning — nothing scaffolded.
    assert(!(await targetExists(join(dir, "discern.toml"))));
  });
});

Deno.test("setup reports a missing --config file to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout, stderr } = await runCli(
      ["setup", "begin", "--config", "absent.json"],
      dir,
    );
    assertEquals(code, 1);
    // loadConfigDoc wraps a read failure with the path it tried.
    assertStringIncludes(stderr, "could not read --config file");
    assertStringIncludes(stderr, "absent.json");
    assertEquals(stdout.trim(), "");
  });
});

// --- schema-invalid config document from loadConfigDoc, human branch ---

Deno.test("setup reports schema-invalid --config fields to stderr without --json", async () => {
  await withTempDir(async (dir) => {
    // A syntactically valid document with a bad known field fails at the shared
    // config-document boundary before setup planning begins.
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({
        slug: "x",
        jobs: { t: { stage: "bogus", run: "x" } },
      }),
    );
    const { code, stdout, stderr } = await runCli(
      ["setup", "begin", "--config", "answers.json"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, '--config file "answers.json" is invalid');
    assertStringIncludes(stderr, "jobs.t.stage");
    assertEquals(stdout.trim(), "");
    // The failure happened during planning: nothing was written.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 1); // just answers.json
  });
});

// --- applyFillsToPlan early return when discern.toml is a skip ---

Deno.test("setup begin --force --config leaves an existing discern.toml untouched (fills skip the seed)", async () => {
  await withTempDir(async (dir) => {
    // First, a plain install so a seed discern.toml exists on disk.
    assertEquals(
      (await runCli(
        ["setup", "begin", "--confirmed", "--slug", "edge-app"],
        dir,
      )).code,
      0,
    );
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    // The fresh seed carries no capability fills.
    assert(!before.includes('test = "vitest run"'));

    // Re-run setup with --force AND a --config that *would* fill capabilities. Because
    // discern.toml is a seed already present, its plan op is `skip`, so
    // applyFillsToPlan returns early and never applies the fills — the seed is
    // left exactly as the user's.
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const run = await runCli(
      ["setup", "begin", "--force", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(run.code, 0, run.stderr);
    assertEquals(decodeCliResult(run.stdout, "setup begin").ok, true);

    // The seed is byte-for-byte unchanged: the fills did not land.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    assertEquals(after, before);
    assert(!after.includes('test = "vitest run"'));
  });
});
