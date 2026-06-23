/**
 * CLI tests for `init --config <file>` (ADR 0005): a JSON answers file drives a
 * fresh, non-interactive install, with capabilities/checks/scopes/ratchets
 * applied to the generated discern.toml (comments preserved). Run as
 * subprocesses.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

const ANSWERS = JSON.stringify({
  "$schema": "../schema/discern-config.schema.json",
  version: "2",
  name: "My App",
  slug: "my-app",
  source_globs: ["src/**", "lib/**"],
  brief: "A declaratively-configured app.",
  agents: ["claude_code"],
  capabilities: {
    test: "vitest run",
    format: "prettier --write .",
  },
  checks: {
    licenses: { stage: "check", run: "license-scan" },
  },
  scopes: { native: { paths: ["native/**"], gate: "make -C native check" } },
  ratchets: {
    coverage: { direction: "up", limit: 80, run: "measure-cov" },
    bundle: { direction: "down", limit: 500000, run: "measure-bundle" },
  },
});

Deno.test("init --config scaffolds from a JSON answers file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const r = await runCli(["init", "--config", "answers.json", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "init");
    assertEquals(result.data.project.slug, "my-app");

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'test = "vitest run"'); // capability fill
    assertStringIncludes(toml, "[checks.licenses]"); // check table
    assertStringIncludes(toml, 'paths = ["native/**"]'); // scope fill
    assertStringIncludes(toml, 'gate = "make -C native check"'); // folded-in gate
    assertStringIncludes(toml, "[ratchets.coverage]"); // coverage ratchet table
    assertStringIncludes(toml, "[ratchets.bundle]"); // named ratchet
    assertStringIncludes(toml, "limit = 500000");
    // Template comments survive the fills.
    assert(toml.split("\n").filter((l) => l.startsWith("#")).length > 10);

    // The brief was captured.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "brief.md")),
      "A declaratively-configured app.",
    );
  });
});

Deno.test("init --config - reads the answers file from stdin", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(
      ["init", "--config", "-", "--json"],
      dir,
      {},
      ANSWERS,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).data.project.slug, "my-app");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'test = "vitest run"',
    );
  });
});

Deno.test("init --config: an explicit flag overrides the file value", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const r = await runCli(
      ["init", "--config", "answers.json", "--slug", "flag-wins", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).data.project.slug, "flag-wins");
  });
});

Deno.test("init --config --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const r = await runCli(
      ["init", "--config", "answers.json", "--dry-run", "--json"],
      dir,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).data.dry_run, true);
    // Only the answers file exists; nothing was scaffolded.
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 1);
  });
});

Deno.test("init --config rejects invalid JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "bad.json"), "{ not json");
    const r = await runCli(["init", "--config", "bad.json", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_config_file");
  });
});

Deno.test("init --config rejects an unsupported document version", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({ version: "3", slug: "x" }),
    );
    const r = await runCli(["init", "--config", "answers.json", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "invalid_config_file");
    assertStringIncludes(result.message, "version");
  });
});

Deno.test("init --config rejects an invalid fill (bad check stage)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({
        slug: "x",
        checks: { t: { stage: "bogus", run: "x" } },
      }),
    );
    const r = await runCli(["init", "--config", "answers.json", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "invalid_config_file");
    assertStringIncludes(result.message, "stage");
    // Nothing was written (the error happened during planning).
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 1); // just answers.json
  });
});
