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
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";
import { runAgent } from "./engine_helpers.ts";
import {
  applyConfigDoc,
  type DiscernConfigDoc,
  docHasFills,
} from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";

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

    // Files overlaid: a project script, a instruction fragment, a managed skill.
    assert(await exists(join(dir, "discern/scripts/example-deploy")));
    assert(await exists(join(dir, "discern/instructions.md")));
    assert(await exists(join(dir, "discern/skills/example-skill/SKILL.md")));
    // The overlaid project script kept its exec bit.
    const scriptInfo = await Deno.stat(
      join(dir, "discern/scripts/example-deploy"),
    );
    assert(
      ((scriptInfo.mode ?? 0) & 0o111) !== 0,
      "Project script should be executable",
    );
    // preset.json is metadata — never scaffolded into the project.
    assert(!(await exists(join(dir, "preset.json"))));

    // Config fills landed in discern.toml, comments intact.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'test = "echo running example tests"'); // known job
    assertStringIncludes(toml, 'paths = ["example/**"]'); // scope paths
    assertStringIncludes(toml, 'gate = "echo example side gate"'); // scope gate
    assertStringIncludes(toml, "[standards.examplesize]"); // standard
    assertStringIncludes(
      toml,
      generatedArtifactMarker(ARTIFACT_PROVENANCE_SOURCES.config),
    ); // comment survived
    await assertDiscernTomlTidy(dir, "preset config fills");
  });
});

Deno.test("preset --json without --yes emits exactly one envelope and applies (no confirm hang)", async () => {
  // The confirm is auto-answered under --json (B53): the machine stream carries
  // one parseable envelope, never an interaction, and the overlay still lands.
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const r = await runCli(["preset", "example", "--json"], dir, PRESET_ENV);
    assertEquals(r.code, 0, r.stderr);
    // Exactly one envelope line on stdout, and no interaction output leaked.
    const line = r.stdout.trim();
    assert(
      line.length > 0 && !line.includes("\n"),
      `expected a single envelope line, got:\n${r.stdout}`,
    );
    const result = JSON.parse(line);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "preset");
    // The overlay applied despite no --yes, because json mode auto-proceeds.
    assert(await exists(join(dir, "discern/scripts/example-deploy")));
  });
});

Deno.test("preset: the overlaid project script is runnable through its namespace", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    await runCli(["preset", "example", "--yes"], dir, PRESET_ENV);
    const r = await runAgent(dir, ["scripts", "example-deploy"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "example deploy ran");
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
    assert(!(await exists(join(dir, "discern/scripts/example-deploy"))));
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

/** Insert a real (uncommented) known job under the scaffold's `[jobs]`. */
async function setUserJob(
  dir: string,
  key: string,
  value: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/\[jobs\]\n/, `[jobs]\n${key} = "${value}"\n`),
  );
}

Deno.test("preset config fills never overwrite a value the user already set", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    // The user's own, stronger test command — possibly uncommitted tuning. The
    // example preset's fills carry a weaker `test`; it must not win.
    await setUserJob(dir, "test", "cargo test --workspace");

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
    assert(result.data.config_fills_skipped.includes("jobs.test"));
    assert(result.data.config_fills_applied.includes("standards.examplesize"));
    assertStringIncludes(toml, "[standards.examplesize]");
  });
});

Deno.test("preset --dry-run disclosures name each key filled and each kept", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    await setUserJob(dir, "test", "cargo test --workspace");
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
    assert(result.data.config_fills_applied.includes("standards.examplesize"));
    assert(result.data.config_fills_skipped.includes("jobs.test"));
    // Nothing was written.
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);

    // The human dry-run names the keys too, not just a boolean.
    const human = await runCli(
      ["preset", "example", "--yes", "--dry-run"],
      dir,
      PRESET_ENV,
    );
    assertEquals(human.code, 0, human.stderr);
    assertTerminalTextIncludes(human.stderr, "Would fill discern.toml:");
    assertStringIncludes(human.stderr, "standards.examplesize");
    assertStringIncludes(human.stderr, "jobs.test");
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
    assert(result.data.config_fills_skipped.includes("jobs.test"));
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
    assertTerminalTextIncludes(r.stderr, "no discern install here");
  });
});

Deno.test("preset reports an unknown preset as plain text (no --json)", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const r = await runCli(["preset", "nope"], dir, PRESET_ENV);
    assertEquals(r.code, 1);
    // The non-JSON branch logs the message to stderr; the example fixture is
    // listed as available.
    assertTerminalTextIncludes(r.stderr, 'unknown preset "nope"');
    assertStringIncludes(r.stderr, "example");
  });
});

Deno.test("preset human errors make hostile names inert while JSON stays exact", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const name = "nope\x1b[31m\nspoof\u009b";
    const human = await runCli(["preset", name], dir, PRESET_ENV);
    const transcript = human.stdout + human.stderr;
    assertEquals(human.code, 1);
    assertEquals(transcript.includes("\x1b[31m"), false);
    assertEquals(transcript.includes("\u009b"), false);
    assertStringIncludes(
      human.stderr,
      "nope␛[31m␊spoof<U+009B>",
    );

    const machine = await runCli(
      ["preset", name, "--json"],
      dir,
      PRESET_ENV,
    );
    assertEquals(machine.code, 1);
    const result = JSON.parse(machine.stdout) as { message?: string };
    assertStringIncludes(result.message ?? "", name);
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
    assertStringIncludes(r.stdout, "discern/scripts/example-deploy");
    assertTerminalTextIncludes(
      r.stderr,
      'Dry run — preset "example" would overlay',
    );
    assertTerminalTextIncludes(r.stderr, "Would fill discern.toml:");
    assertStringIncludes(r.stderr, "jobs.test");
    // Nothing was written.
    assert(!(await exists(join(dir, "discern/scripts/example-deploy"))));
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
      "scripts/filesonly": "# files only preset\n",
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
    assert(result.data.written.includes("scripts/filesonly"));
    assert(await exists(join(dir, "scripts/filesonly")));
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
      "scripts/badjson": "# preset with a non-object manifest\n",
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
    assert(!(await exists(join(dir, "scripts/badjson"))));
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
        jobs: { broken: { stage: "nonsense", run: "true" } },
      }),
    });

    const r = await runCli(["preset", "badfills", "--yes"], dir, env);
    assertEquals(r.code, 1);
    // The non-JSON branch logs to stderr and names the offending preset.
    assertTerminalTextIncludes(
      r.stderr,
      'preset "badfills" has invalid config fills',
    );
    assertTerminalTextIncludes(r.stderr, "unknown stage");
  });
});

Deno.test("preset rejects a preset.json with an unsupported version", async () => {
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    const { env } = await stagePreset(dir, "futurever", {
      "preset.json": JSON.stringify({
        version: "3",
        jobs: { test: "true" },
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
    assert(await exists(join(dir, "discern/scripts/example-deploy")));
  });
});

// ── Class guard: no fill-bearing field is silently dropped (B54) ─────────────
//
// The class: a preset whose ONLY config fill is field X is silently dropped
// whenever the gate that decides "is there anything to apply?" tests a
// hand-copied field list that has drifted from the fields `applyConfigDoc`
// actually consumes. (`map.dir` was the dropped member.) The cure derives that
// gate (`docHasFills`) from `applyConfigDoc` itself; this guard proves every
// fill-bearing field survives, and is driven off the routine so a new field
// auto-enrols.

/**
 * The set of fill-bearing top-level document keys, read straight from
 * `applyConfigDoc` — a maximal document applied to an empty editor fills a path
 * under exactly the keys the routine consumes, so this is the single source of
 * truth for what a preset must not drop, never a hand-copied list.
 */
function fillBearingKeys(): Set<string> {
  const maximal: DiscernConfigDoc = {
    map: { dir: "documentation/" },
    jobs: {
      test: "echo t",
      chk: { stage: "check", run: "echo c" },
    },
    scopes: { sco: { paths: ["x/**"] } },
    standards: { rat: { direction: "up", limit: 1, run: "echo r" } },
  };
  const report = applyConfigDoc(new TomlEditor(""), maximal);
  return new Set(report.filled.map((path) => path.split(".")[0] ?? path));
}

/**
 * A minimal preset.json fragment per fill-bearing key, each landing a fill on a
 * fresh scaffold, paired with the dotted path its fill discloses. `map.dir`
 * uses a non-default directory so it applies (lands) rather than being kept.
 */
const SINGLE_FIELD_PRESETS: Record<
  string,
  { fragment: Record<string, unknown>; disclosed: string }
> = {
  map: {
    fragment: { map: { dir: "documentation/" } },
    disclosed: "map.dir",
  },
  jobs: {
    fragment: {
      jobs: {
        test: "echo solo test",
        solo: { stage: "check", run: "echo solo" },
      },
    },
    disclosed: "jobs.test",
  },
  scopes: {
    fragment: { scopes: { solo: { paths: ["solo/**"] } } },
    disclosed: "scopes.solo",
  },
  standards: {
    fragment: {
      standards: { solo: { direction: "up", limit: 1, run: "echo solo" } },
    },
    disclosed: "standards.solo",
  },
};

Deno.test("every fill-bearing document field has a single-field preset guard (no drift)", () => {
  // The per-field table must cover EXACTLY the fields the routine fills — no
  // more, no fewer. A field added to `applyConfigDoc` without a case here fails
  // this, forcing the guard to grow with the routine.
  assertEquals(
    new Set(Object.keys(SINGLE_FIELD_PRESETS)),
    fillBearingKeys(),
    "SINGLE_FIELD_PRESETS must cover exactly applyConfigDoc's fill-bearing keys",
  );
});

Deno.test("docHasFills is true for a document whose only fill is one field", () => {
  // The unit half of the cure: the gate that decides whether to apply agrees
  // with the routine for a document carrying just one fill (docs-only included).
  assert(!docHasFills({}), "an empty document carries no fills");
  for (const [key, { fragment }] of Object.entries(SINGLE_FIELD_PRESETS)) {
    assert(
      docHasFills(fragment as DiscernConfigDoc),
      `docHasFills must see the fill in a ${key}-only document`,
    );
  }
});

Deno.test("a preset whose only fill is one field is never silently dropped", async () => {
  // The e2e half: for each fill-bearing field, a preset carrying only that field
  // reaches `applyConfigDoc` and discloses its fill in the result — as applied,
  // or (for a value the fresh scaffold already sets, like map.dir) as kept.
  // Pre-fix, a docs-only preset never reached `applyConfigDoc`, so its fill was
  // in NEITHER list — silently dropped. The invariant is "disclosed, not
  // vanished", which holds uniformly across every field.
  for (
    const [key, { fragment, disclosed }] of Object.entries(SINGLE_FIELD_PRESETS)
  ) {
    await withTempDir(async (dir) => {
      await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
      const { env } = await stagePreset(dir, `only-${key}`, {
        "preset.json": JSON.stringify({ version: "2", ...fragment }),
      });

      const r = await runCli(
        ["preset", `only-${key}`, "--yes", "--json"],
        dir,
        env,
      );
      assertEquals(r.code, 0, r.stderr);
      const result = JSON.parse(r.stdout);
      assertEquals(result.ok, true, `${key}: preset must succeed`);
      const applied = result.data.config_fills_applied as string[];
      const skipped = result.data.config_fills_skipped as string[];
      assert(
        [...applied, ...skipped].includes(disclosed),
        `${key}-only preset must disclose ${disclosed} (applied or kept), not drop it; applied=${
          JSON.stringify(applied)
        } skipped=${JSON.stringify(skipped)}`,
      );
    });
  }
});

Deno.test("a docs-only preset actually writes map.dir when the project has not set it", async () => {
  // The applied (not merely disclosed) proof for the field that regressed: with
  // the scaffold's own `map.dir` removed, a docs-only preset must LAND its fill
  // — the whole failure mode was this write being skipped before apply.
  await withTempDir(async (dir) => {
    await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir);
    // Drop the scaffold's [map] dir so the preset's value is not "already set".
    const original = await Deno.readTextFile(join(dir, "discern.toml"));
    const stripped = original
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("dir ="))
      .join("\n");
    await Deno.writeTextFile(join(dir, "discern.toml"), stripped);

    const { env } = await stagePreset(dir, "docsonly", {
      "preset.json": JSON.stringify({
        version: "2",
        map: { dir: "documentation/" },
      }),
    });
    const r = await runCli(["preset", "docsonly", "--yes", "--json"], dir, env);
    assertEquals(r.code, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assertEquals(result.data.config_fills, true);
    assert(
      (result.data.config_fills_applied as string[]).includes("map.dir"),
      "map.dir must be applied when not pre-set",
    );
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'dir = "documentation/"');
  });
});
