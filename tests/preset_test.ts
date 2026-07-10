/**
 * Tests for the preset contract (ADR 0007, ADR 0018), exercised end-to-end
 * against a FAKE example preset fixture (a toy "stack" under
 * tests/fixtures/presets/example/ — not a real ecosystem, not shipped).
 * `preset` overlays the preset's files AND applies its preset.json config
 * fills to discern.toml.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
// `dirname` is used both for the fixtures path and by `stagePreset`'s mkdir.
import { runCli, withTempDir } from "./helpers.ts";
import { runAgent } from "./engine_helpers.ts";

/** Absolute path to the fixture presets dir (passed via DISCERN_PRESETS_DIR). */
const FIXTURE_PRESETS = join(
  dirname(fromFileUrl(import.meta.url)),
  "fixtures",
  "presets",
);
const PRESET_ENV = { DISCERN_PRESETS_DIR: FIXTURE_PRESETS };

/** True when a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("preset overlays the example preset's files and config fills", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      (await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir))
        .code,
      0,
    );

    const r = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "preset");
    assertEquals(result.data.config_fills, true);

    // Files overlaid: a seed recipe, a seed guideline fragment, a managed skill.
    assert(await exists(join(dir, "discern/recipes/example-deploy")));
    assert(await exists(join(dir, "discern/guidance.md")));
    assert(await exists(join(dir, "discern/skills/example-skill/SKILL.md")));
    // The overlaid recipe kept its exec bit.
    const recipeInfo = await Deno.stat(
      join(dir, "discern/recipes/example-deploy"),
    );
    assert(
      ((recipeInfo.mode ?? 0) & 0o111) !== 0,
      "recipe should be executable",
    );
    // preset.json is metadata — never scaffolded into the project.
    assert(!(await exists(join(dir, "preset.json"))));

    // Config fills landed in discern.toml, comments intact.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'test = "echo running example tests"'); // capability
    assertStringIncludes(toml, 'paths = ["example/**"]'); // scope paths
    assertStringIncludes(toml, 'gate = "echo example side gate"'); // scope gate
    assertStringIncludes(toml, "[ratchets.examplesize]"); // ratchet
    assertStringIncludes(
      toml,
      "# discern | https://discern.sh | project configuration file",
    ); // comment survived
  });
});

Deno.test("preset: the overlaid project recipe is runnable via agent", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    await runCli(["preset", "example", "--yes"], dir, PRESET_ENV);
    const r = await runAgent(dir, ["example-deploy"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "example deploy ran");
  });
});

Deno.test("preset --dry-run writes nothing (files or fills)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const r = await runCli(
      ["preset", "example", "--yes", "--dry-run", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).dry_run, true);
    assert(!(await exists(join(dir, "discern/recipes/example-deploy"))));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

/** Insert a real (uncommented) key under the scaffold's `[capabilities]`. */
async function setUserCapability(
  dir: string,
  key: string,
  value: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/\[capabilities\]\n/, `[capabilities]\n${key} = "${value}"\n`),
  );
}

Deno.test("preset config fills never overwrite a value the user already set", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    // The user's own, stronger test command — possibly uncommitted tuning. The
    // example preset's fills carry a weaker `test`; it must not win.
    await setUserCapability(dir, "test", "cargo test --workspace");

    const r = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'test = "cargo test --workspace"');
    assert(
      !toml.includes("echo running example tests"),
      "the preset's weaker command must not replace the user's",
    );
    // The kept key is disclosed, and the remaining fills still landed.
    assert(result.data.config_fills_skipped.includes("capabilities.test"));
    assert(result.data.config_fills_applied.includes("ratchets.examplesize"));
    assertStringIncludes(toml, "[ratchets.examplesize]");
  });
});

Deno.test("preset --dry-run disclosures name each key filled and each kept", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    await setUserCapability(dir, "test", "cargo test --workspace");
    const before = await Deno.readTextFile(join(dir, "discern.toml"));

    const r = await runCli(
      ["preset", "example", "--yes", "--dry-run", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.dry_run, true);
    // Per-key disclosure: what would be written, and what the user keeps.
    assert(result.data.config_fills_applied.includes("ratchets.examplesize"));
    assert(result.data.config_fills_skipped.includes("capabilities.test"));
    // Nothing was written.
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);

    // The human dry-run names the keys too, not just a boolean.
    const human = await runCli(
      ["preset", "example", "--yes", "--dry-run"],
      dir,
      PRESET_ENV,
    );
    assertEquals(human.code, 0, human.stderr);
    assertStringIncludes(human.stderr, "Would fill discern.toml:");
    assertStringIncludes(human.stderr, "ratchets.examplesize");
    assertStringIncludes(human.stderr, "capabilities.test");
  });
});

Deno.test("re-applying a preset fills nothing and leaves discern.toml byte-identical", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const first = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(first.code, 0, first.stderr);
    const afterFirst = await Deno.readTextFile(join(dir, "discern.toml"));

    const second = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(second.code, 0, second.stderr);
    const result = JSON.parse(second.stdout);
    // Every fill now exists, so the second pass writes no config at all.
    assertEquals(result.data.config_fills, false);
    assertEquals(result.data.config_fills_applied, []);
    assert(result.data.config_fills_skipped.includes("capabilities.test"));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      afterFirst,
    );
  });
});

Deno.test("preset still reports unknown presets with the fixtures dir set", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const r = await runCli(
      ["preset", "nope", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "unknown_preset");
    // The available list now includes the example fixture.
    assert(result.data.available.includes("example"));
  });
});

/**
 * Build a throwaway presets dir under `<dir>/<name>/` and return the env that
 * points the CLI at it. Lets a test stage a deliberately-broken preset (bad
 * preset.json, no fills, …) without touching the committed fixtures.
 */
async function stagePreset(
  dir: string,
  name: string,
  files: Record<string, string>,
): Promise<{ env: Record<string, string>; presetsRoot: string }> {
  const presetsRoot = join(dir, "_presets");
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(presetsRoot, name, rel);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
  }
  return { env: { DISCERN_PRESETS_DIR: presetsRoot }, presetsRoot };
}

Deno.test("preset reports not_initialized when there is no discern.toml (--json)", async () => {
  await withTempDir(async (dir) => {
    // No `setup` here — the dir has no discern.toml.
    const r = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "not_initialized");
    assertStringIncludes(result.message, "discern setup");
  });
});

Deno.test("preset reports not_initialized as plain text without --json", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(
      ["preset", "example", "--yes"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "no discern install here");
  });
});

Deno.test("preset reports an unknown preset as plain text (no --json)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const r = await runCli(["preset", "nope"], dir, PRESET_ENV);
    assertEquals(r.code, 1);
    // The non-JSON branch logs the message to stderr; the example fixture is
    // listed as available.
    assertStringIncludes(r.stderr, 'unknown preset "nope"');
    assertStringIncludes(r.stderr, "example");
  });
});

Deno.test("preset with no presets dir reports 'ships no presets yet'", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    // No DISCERN_PRESETS_DIR and the repo bundles none, so the resolver walks
    // up, finds nothing, and the available list is empty.
    const r = await runCli(["preset", "example", "--json"], dir);
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "unknown_preset");
    assertEquals(result.data.available, []);
    assertStringIncludes(result.message, "ships no presets yet");
  });
});

Deno.test("preset --dry-run prints the plan as plain text and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const r = await runCli(
      ["preset", "example", "--yes", "--dry-run"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    // The plan rows print to stdout (the user-facing channel); the heading and
    // the config-fills note are status lines on stderr.
    assertStringIncludes(r.stdout, "discern/recipes/example-deploy");
    assertStringIncludes(r.stderr, 'Dry run — preset "example" would overlay');
    assertStringIncludes(r.stderr, "Would fill discern.toml:");
    assertStringIncludes(r.stderr, "capabilities.test");
    // Nothing was written.
    assert(!(await exists(join(dir, "discern/recipes/example-deploy"))));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("preset overlays a preset that has no preset.json (files only, no fills)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const { env } = await stagePreset(dir, "filesonly", {
      "recipes/filesonly": "# files only preset\n",
    });

    const r = await runCli(
      ["preset", "filesonly", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, true);
    // No preset.json → no config fills, and discern.toml is untouched.
    assertEquals(result.data.config_fills, false);
    assert(result.data.written.includes("recipes/filesonly"));
    assert(await exists(join(dir, "recipes/filesonly")));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("preset rejects a preset.json that is not a JSON object", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const { env } = await stagePreset(dir, "badjson", {
      "recipes/badjson": "# preset with a non-object manifest\n",
      "preset.json": '["not", "an", "object"]',
    });

    const r = await runCli(
      ["preset", "badjson", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_preset");
    assertStringIncludes(result.message, "must be a JSON object");
    // Failed before writing anything (neither the file nor the toml changed).
    assert(!(await exists(join(dir, "recipes/badjson"))));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("preset rejects invalid config fills as plain text", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const { env } = await stagePreset(dir, "badfills", {
      // A check with an unknown stage — applyConfigDoc throws on it.
      "preset.json": JSON.stringify({
        version: "2",
        checks: { broken: { stage: "nonsense", run: "true" } },
      }),
    });

    const r = await runCli(["preset", "badfills", "--yes"], dir, env);
    assertEquals(r.code, 1);
    // The non-JSON branch logs to stderr and names the offending preset.
    assertStringIncludes(
      r.stderr,
      'preset "badfills" has invalid config fills',
    );
    assertStringIncludes(r.stderr, "unknown stage");
  });
});

Deno.test("preset rejects a preset.json with an unsupported version", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const { env } = await stagePreset(dir, "futurever", {
      "preset.json": JSON.stringify({
        version: "3",
        capabilities: { test: "true" },
      }),
    });

    const r = await runCli(
      ["preset", "futurever", "--yes", "--json"],
      dir,
      env,
    );
    assertEquals(r.code, 1);
    const result = JSON.parse(r.stdout);
    assertEquals(result.error, "invalid_preset");
    assertStringIncludes(result.message, "unsupported config-document version");
  });
});

Deno.test("preset falls back to default agents when discern.toml omits them", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    // Strip the `agents = [...]` line so the command takes the DEFAULTS branch
    // when building its scaffold config.
    const original = await Deno.readTextFile(join(dir, "discern.toml"));
    const stripped = original
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("agents ="))
      .join("\n");
    await Deno.writeTextFile(join(dir, "discern.toml"), stripped);

    const r = await runCli(
      ["preset", "example", "--yes", "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).ok, true);
    // The overlay still applied normally despite the missing agents key.
    assert(await exists(join(dir, "discern/recipes/example-deploy")));
  });
});
