/**
 * CLI tests for `init --config <file>` (ADR 0005): a JSON answers file drives a
 * fresh, non-interactive install, with slots/scopes/side_gates/ratchets applied
 * to the generated icculus.toml (comments preserved). Run as subprocesses.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

const ANSWERS = JSON.stringify({
  name: "My App",
  slug: "my-app",
  source_globs: ["src/**", "lib/**"],
  brief: "A declaratively-configured app.",
  agents: ["claude_code"],
  slots: {
    test: { phase: "test", run: "vitest run" },
    format: { phase: "fix", run: "prettier --write ." },
  },
  scopes: { native: ["native/**"] },
  side_gates: { native: "make -C native check" },
  ratchets: {
    coverage_min: 80,
    bundle: { direction: "down", limit: 500000, slot: "bundlesize" },
  },
});

Deno.test("init --config scaffolds from a JSON answers file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "answers.json"), ANSWERS);
    const r = await runCli(["init", "--config", "answers.json", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.project.slug, "my-app");

    const toml = await Deno.readTextFile(join(dir, "icculus.toml"));
    assertStringIncludes(toml, 'run   = "vitest run"'); // slot fill
    assertStringIncludes(toml, 'native = ["native/**"]'); // scope fill
    assertStringIncludes(toml, 'native = "make -C native check"'); // side-gate fill
    assertStringIncludes(toml, "coverage_min = 80"); // ratchet scalar
    assertStringIncludes(toml, "[ratchets.bundle]"); // named ratchet
    assertStringIncludes(toml, "limit = 500000");
    // Template comments survive the fills.
    assert(toml.split("\n").filter((l) => l.startsWith("#")).length > 10);

    // The brief was captured.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".icculus/brief.md")),
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
    assertEquals(JSON.parse(r.stdout).project.slug, "my-app");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "icculus.toml")),
      'run   = "vitest run"',
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
    assertEquals(JSON.parse(r.stdout).project.slug, "flag-wins");
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
    assertEquals(JSON.parse(r.stdout).dry_run, true);
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

Deno.test("init --config rejects an invalid fill (bad phase)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "answers.json"),
      JSON.stringify({ slug: "x", slots: { t: { phase: "bogus", run: "x" } } }),
    );
    const r = await runCli(["init", "--config", "answers.json", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "invalid_config_file");
    assertStringIncludes(result.message, "phase");
    // Nothing was written (the error happened during planning).
    let entries = 0;
    for await (const _ of Deno.readDir(dir)) {
      entries++;
    }
    assertEquals(entries, 1); // just answers.json
  });
});
