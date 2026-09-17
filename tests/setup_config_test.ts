/**
 * CLI tests for `setup begin --config <file>` (ADR 0005): a JSON answers file drives a
 * fresh, non-interactive install, with jobs/scopes/standards
 * applied to the generated discern.toml (comments preserved). Run as
 * subprocesses.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { gitInit } from "./engine_helpers.ts";
import { targetExists } from "../src/shared/fs_presence.ts";

/** Create the committed Git baseline required by setup begin. */
async function initializeSetupRepository(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Setup config fixture\n");
  await gitInit(dir);
}

const ANSWERS = JSON.stringify({
  "$schema": "../schema/discern-setup-config.schema.json",
  version: "1",
  name: "My App",
  slug: "my-app",
  branch_prefix: "agent/",
  brief: "A declaratively-configured app.",
  agents: ["claude_code"],
  map: { dir: "docs/map/" },
  jobs: {
    test: "vitest run",
    format: "prettier --write .",
    licenses: {
      stage: "check",
      run: ["license-scan", "license-verify"],
      provides: "license report",
      timeout: 41,
    },
  },
  scopes: {
    native: {
      paths: ["native/**"],
      neutral: false,
      preview: ["tool preview", "tool preview-summary"],
      gate: "make -C native check",
      timeout: 42,
    },
  },
  generated: {
    reference: {
      paths: ["reference/**"],
      run: ["tool generate-reference", "tool verify-reference"],
      linguist_generated: true,
      timeout: 43,
    },
  },
  standards: {
    coverage: {
      metric: "coverage",
      direction: "up",
      limit: 80,
      run: "measure-cov",
      per: { lines: ["src/**", "lib/**"] },
      scale: 100,
      margin: 0.5,
      inputs: ["src/**"],
      timeout: 44,
    },
    bundle: { direction: "down", limit: 500000, run: "measure-bundle" },
  },
  checkpoints: {
    review_native: {
      scope: "native",
      include_generated: true,
      mode: "advise",
      question: "Is the native change coherent?",
    },
  },
  setup: { not_applicable: ["smoke"] },
  worktree: {
    root: "../worktrees",
    inherit_env: ["APP_KEY"],
    env_files: [".env.test"],
    export_port: true,
    ignored_file_drift: false,
    resources: {
      database: {
        create: "tool database create",
        destroy: "tool database destroy",
        ensure: "tool database ensure",
        required: false,
        retries: 3,
        gc: false,
      },
    },
    setup: {
      steps: ["tool seed"],
      ensure: ["tool converge"],
    },
  },
});

Deno.test("setup begin --config scaffolds from a JSON answers file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "project");
    assert(result.data.project !== undefined);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "setup begin");
    assertEquals(result.data.project.slug, "my-app");
    assertResultDataKey(result, "config_fills");
    const configFills = result.data.config_fills;
    assert(configFills !== undefined);
    for (
      const path of [
        "scopes.native.timeout",
        "generated.reference.linguist_generated",
        "standards.coverage.per",
        "checkpoints.review_native.question",
        "setup.not_applicable",
        "worktree.resources.database.retries",
        "worktree.setup.ensure",
      ]
    ) {
      assert(configFills.filled.includes(path), path);
    }
    assertEquals(configFills.skipped, []);

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'test = "vitest run"'); // capability fill
    assertStringIncludes(toml, "[jobs.licenses]"); // check table
    assertStringIncludes(toml, 'paths = ["native/**"]'); // scope fill
    assertStringIncludes(toml, 'gate = "make -C native check"'); // folded-in gate
    assertStringIncludes(toml, "timeout = 42");
    assertStringIncludes(toml, "[generated.reference]");
    assertStringIncludes(toml, "linguist_generated = true");
    assertStringIncludes(toml, "[standards.coverage]"); // coverage standard table
    assertStringIncludes(toml, "[standards.bundle]"); // named standard
    assertStringIncludes(toml, "limit = 500000");
    assertStringIncludes(toml, "[checkpoints.review_native]");
    assertStringIncludes(toml, 'not_applicable = ["smoke"]');
    assertStringIncludes(toml, "[worktree.resources.database]");
    assertStringIncludes(toml, "retries = 3");
    assertStringIncludes(toml, "[worktree.setup]");
    assertStringIncludes(toml, 'ensure = ["tool converge"]');
    // Template comments survive the fills.
    assert(toml.split("\n").filter((l) => l.startsWith("#")).length > 10);

    // The brief was captured.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern/brief.md")),
      "A declaratively-configured app.",
    );
  });
});

Deno.test("setup begin --config - reads the answers file from stdin", async () => {
  await withTempDir(async (dir) => {
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "-", "--json"],
      dir,
      {},
      ANSWERS,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "project");
    assert(result.data.project !== undefined);
    assertEquals(result.data.project.slug, "my-app");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'test = "vitest run"',
    );
  });
});

Deno.test("setup begin --config: an explicit flag overrides the file value", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    await initializeSetupRepository(dir);
    const r = await runCli(
      [
        "setup",
        "begin",
        "--config",
        "answers.json",
        "--slug",
        "flag-wins",
        "--json",
      ],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "project");
    assert(result.data.project !== undefined);
    assertEquals(result.data.project.slug, "flag-wins");
  });
});

Deno.test("setup begin --config --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "answers.json", "--dry-run", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertEquals(result.dry_run, true);
    assertResultDataKey(result, "config_fills");
    const configFills = result.data.config_fills;
    assert(configFills !== undefined);
    assert(
      configFills.filled.includes(
        "worktree.resources.database.retries",
      ),
    );
    assertEquals(await targetExists(join(dir, "discern.toml")), false);
  });
});

Deno.test("setup begin --config rejects invalid JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "bad.json"), "{ not json");
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "bad.json", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_config_file");
  });
});

Deno.test("setup begin --config rejects an unsupported document version", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({ version: "3", slug: "x" }),
    );
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertEquals(result.error, "invalid_config_file");
    assert(result.message !== undefined);
    assertStringIncludes(result.message, "version");
  });
});

Deno.test("setup begin rejects the removed source-glob input surfaces", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({ version: "1", slug: "x", source_globs: ["src/**"] }),
    );
    await initializeSetupRepository(dir);
    const document = await runCli(
      ["setup", "begin", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(document.code, 1);
    const result = decodeCliResult(document.stdout, "setup begin");
    assertEquals(result.error, "invalid_config_file");
    assertStringIncludes(result.message ?? "", "source_globs");

    const option = await runCli(
      ["setup", "begin", "--source-globs", "src/**", "--json"],
      dir,
    );
    assertEquals(option.code, 2);
    assertStringIncludes(`${option.stdout}\n${option.stderr}`, "source-globs");
  });
});

Deno.test("setup begin --config rejects an invalid fill (bad check stage)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({
        slug: "x",
        jobs: { t: { stage: "bogus", run: "x" } },
      }),
    );
    await initializeSetupRepository(dir);
    const r = await runCli(
      ["setup", "begin", "--config", "answers.json", "--json"],
      dir,
    );
    assertEquals(r.code, 1);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertEquals(result.error, "invalid_config_file");
    assert(result.message !== undefined);
    assertStringIncludes(result.message, "stage");
    // No setup footprint was written (the error happened during planning).
    assertEquals(await targetExists(join(dir, "discern.toml")), false);
  });
});
