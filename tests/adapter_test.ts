/**
 * Tests for the adapter contract (ADR 0007), exercised end-to-end against a FAKE
 * example adapter fixture (a toy "stack" under tests/fixtures/adapters/example/ —
 * not a real ecosystem, not shipped). `add-adapter` overlays the adapter's files
 * AND applies its adapter.json config fills to icculus.toml.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { runAgent } from "./engine_helpers.ts";

/** Absolute path to the fixture adapters dir (passed via ICCULUS_ADAPTERS_DIR). */
const FIXTURE_ADAPTERS = join(
  dirname(fromFileUrl(import.meta.url)),
  "fixtures",
  "adapters",
);
const ADAPTER_ENV = { ICCULUS_ADAPTERS_DIR: FIXTURE_ADAPTERS };

/** True when a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("add-adapter overlays the example adapter's files and config fills", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
      0,
    );

    const r = await runCli(
      ["add-adapter", "example", "--yes", "--json"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.config_fills, true);

    // Files overlaid: a seed recipe, a seed guideline fragment, a managed skill.
    assert(await exists(join(dir, ".icculus/recipes/example-deploy")));
    assert(await exists(join(dir, ".ai/guidelines/example.md")));
    assert(await exists(join(dir, ".ai/skills/example-skill/SKILL.md")));
    // The overlaid recipe kept its exec bit.
    const recipeInfo = await Deno.stat(
      join(dir, ".icculus/recipes/example-deploy"),
    );
    assert(
      ((recipeInfo.mode ?? 0) & 0o111) !== 0,
      "recipe should be executable",
    );
    // adapter.json is metadata — never scaffolded into the project.
    assert(!(await exists(join(dir, "adapter.json"))));

    // Config fills landed in icculus.toml, comments intact.
    const toml = await Deno.readTextFile(join(dir, "icculus.toml"));
    assertStringIncludes(toml, 'run = "echo running example tests"'); // slot
    assertStringIncludes(toml, 'example = ["example/**"]'); // scope
    assertStringIncludes(toml, 'example = "echo example side gate"'); // side-gate
    assertStringIncludes(toml, "[ratchets.examplesize]"); // ratchet
    assertStringIncludes(toml, "# icculus.toml"); // template comment survived
  });
});

Deno.test("add-adapter: the overlaid project recipe is runnable via agent", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    await runCli(["add-adapter", "example", "--yes"], dir, ADAPTER_ENV);
    const r = await runAgent(dir, ["example-deploy"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "example deploy ran");
  });
});

Deno.test("add-adapter --dry-run writes nothing (files or fills)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "icculus.toml"));
    const r = await runCli(
      ["add-adapter", "example", "--yes", "--dry-run", "--json"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).dry_run, true);
    assert(!(await exists(join(dir, ".icculus/recipes/example-deploy"))));
    assertEquals(await Deno.readTextFile(join(dir, "icculus.toml")), before);
  });
});

Deno.test("add-adapter still reports unknown adapters with the fixtures dir set", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const r = await runCli(
      ["add-adapter", "nope", "--json"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "unknown_adapter");
    // The available list now includes the example fixture.
    assert(result.available.includes("example"));
  });
});
