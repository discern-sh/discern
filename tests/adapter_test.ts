/**
 * Tests for the adapter contract (ADR 0007), exercised end-to-end against a FAKE
 * example adapter fixture (a toy "stack" under tests/fixtures/adapters/example/ —
 * not a real ecosystem, not shipped). `add-adapter` overlays the adapter's files
 * AND applies its adapter.json config fills to icculus.toml.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
// `dirname` is used both for the fixtures path and by `stageAdapter`'s mkdir.
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

/**
 * Build a throwaway adapters dir under `<dir>/<name>/` and return the env that
 * points the CLI at it. Lets a test stage a deliberately-broken adapter (bad
 * adapter.json, no fills, …) without touching the committed fixtures.
 */
async function stageAdapter(
  dir: string,
  name: string,
  files: Record<string, string>,
): Promise<{ env: Record<string, string>; adaptersRoot: string }> {
  const adaptersRoot = join(dir, "_adapters");
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(adaptersRoot, name, rel);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
  }
  return { env: { ICCULUS_ADAPTERS_DIR: adaptersRoot }, adaptersRoot };
}

Deno.test("add-adapter reports not_initialized when there is no icculus.toml (--json)", async () => {
  await withTempDir(async (dir) => {
    // No `init` here — the dir has no icculus.toml.
    const r = await runCli(
      ["add-adapter", "example", "--yes", "--json"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "not_initialized");
    assertStringIncludes(result.message, "icculus init");
  });
});

Deno.test("add-adapter reports not_initialized as plain text without --json", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(
      ["add-adapter", "example", "--yes"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "no icculus.toml here");
  });
});

Deno.test("add-adapter reports an unknown adapter as plain text (no --json)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const r = await runCli(["add-adapter", "nope"], dir, ADAPTER_ENV);
    assertEquals(r.code, 1);
    // The non-JSON branch logs the message to stderr; the example fixture is
    // listed as available.
    assertStringIncludes(r.stderr, 'unknown adapter "nope"');
    assertStringIncludes(r.stderr, "example");
  });
});

Deno.test("add-adapter with no adapters dir reports 'ships no adapters yet'", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    // No ICCULUS_ADAPTERS_DIR and the repo bundles none, so the resolver walks
    // up, finds nothing, and the available list is empty.
    const r = await runCli(["add-adapter", "example", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "unknown_adapter");
    assertEquals(result.available, []);
    assertStringIncludes(result.message, "ships no adapters yet");
  });
});

Deno.test("add-adapter --dry-run prints the plan as plain text and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "icculus.toml"));
    const r = await runCli(
      ["add-adapter", "example", "--yes", "--dry-run"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    // The plan rows print to stdout (the user-facing channel); the heading and
    // the config-fills note are status lines on stderr.
    assertStringIncludes(r.stdout, ".icculus/recipes/example-deploy");
    assertStringIncludes(r.stderr, 'Dry run — adapter "example" would overlay');
    assertStringIncludes(
      r.stderr,
      "Would also apply config fills to icculus.toml",
    );
    // Nothing was written.
    assert(!(await exists(join(dir, ".icculus/recipes/example-deploy"))));
    assertEquals(await Deno.readTextFile(join(dir, "icculus.toml")), before);
  });
});

Deno.test("add-adapter overlays an adapter that has no adapter.json (files only, no fills)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "icculus.toml"));
    const { env } = await stageAdapter(dir, "filesonly", {
      ".ai/guidelines/filesonly.md": "# files only adapter\n",
    });

    const r = await runCli(
      ["add-adapter", "filesonly", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    // No adapter.json → no config fills, and icculus.toml is untouched.
    assertEquals(result.config_fills, false);
    assert(result.written.includes(".ai/guidelines/filesonly.md"));
    assert(await exists(join(dir, ".ai/guidelines/filesonly.md")));
    assertEquals(await Deno.readTextFile(join(dir, "icculus.toml")), before);
  });
});

Deno.test("add-adapter rejects an adapter.json that is not a JSON object", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "icculus.toml"));
    const { env } = await stageAdapter(dir, "badjson", {
      ".ai/guidelines/badjson.md": "# adapter with a non-object manifest\n",
      "adapter.json": '["not", "an", "object"]',
    });

    const r = await runCli(
      ["add-adapter", "badjson", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_adapter");
    assertStringIncludes(result.message, "must be a JSON object");
    // Failed before writing anything (neither the file nor the toml changed).
    assert(!(await exists(join(dir, ".ai/guidelines/badjson.md"))));
    assertEquals(await Deno.readTextFile(join(dir, "icculus.toml")), before);
  });
});

Deno.test("add-adapter rejects invalid config fills as plain text", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const { env } = await stageAdapter(dir, "badfills", {
      // A slot with an unknown phase — applyConfigDoc throws on it.
      "adapter.json": JSON.stringify({
        version: "1",
        slots: { broken: { phase: "nonsense", run: "true" } },
      }),
    });

    const r = await runCli(["add-adapter", "badfills", "--yes"], dir, env);
    assertEquals(r.code, 1);
    // The non-JSON branch logs to stderr and names the offending adapter.
    assertStringIncludes(
      r.stderr,
      'adapter "badfills" has invalid config fills',
    );
    assertStringIncludes(r.stderr, "unknown phase");
  });
});

Deno.test("add-adapter rejects an adapter.json with an unsupported version", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    const { env } = await stageAdapter(dir, "futurever", {
      "adapter.json": JSON.stringify({
        version: "2",
        slots: { ok: { phase: "test", run: "true" } },
      }),
    });

    const r = await runCli(
      ["add-adapter", "futurever", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "invalid_adapter");
    assertStringIncludes(result.message, "unsupported config-document version");
  });
});

Deno.test("add-adapter falls back to default agents when icculus.toml omits them", async () => {
  await withTempDir(async (dir) => {
    await runCli(["init", "--yes", "--slug", "demo"], dir);
    // Strip the `agents = [...]` line so the command takes the DEFAULTS branch
    // when building its scaffold config.
    const original = await Deno.readTextFile(join(dir, "icculus.toml"));
    const stripped = original
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("agents ="))
      .join("\n");
    await Deno.writeTextFile(join(dir, "icculus.toml"), stripped);

    const r = await runCli(
      ["add-adapter", "example", "--yes", "--json"],
      dir,
      ADAPTER_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).ok, true);
    // The overlay still applied normally despite the missing agents key.
    assert(await exists(join(dir, ".icculus/recipes/example-deploy")));
  });
});
