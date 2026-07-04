/**
 * Engine coverage for the `discern skills` command group (list / eject) — the
 * dispatcher handlers that wrap `src/lib/skills.ts`. Driven through the real CLI
 * so Cliffy parsing, the feature gate, and the JSON surface are exercised.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine, writeConfig } from "./engine_helpers.ts";

Deno.test("discern skills list shows the built-ins, and --json emits structured rows", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const human = await runAgent(dir, ["skills", "list"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.stdout, "Effective skills:");
    assertStringIncludes(human.stdout, "discern-write-adr");
    assertStringIncludes(human.stdout, "built-in");

    const json = await runAgent(dir, ["skills", "list", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = JSON.parse(json.stdout) as {
      ok: boolean;
      verb: string;
      data: { skills: Array<{ name: string; source: string }> };
    };
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "skills:list");
    assert(
      obj.data.skills.some((r) =>
        r.name === "discern-write-adr" && r.source === "bundled"
      ),
    );
  });
});

Deno.test("discern skills eject copies a built-in and the effective set then prefers it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, ["skills", "eject", "discern-write-adr"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Ejected");
    assert(
      await exists(join(dir, "skills/discern-write-adr/SKILL.md")),
      "ejected copy must land in ./skills/",
    );
    // The ejected copy now overrides the built-in in the listing.
    const list = await runAgent(dir, ["skills", "list"]);
    assertStringIncludes(list.stdout, "yours (overrides built-in)");
    // And it materialized as a symlink under .claude/skills/.
    assert(
      (await Deno.lstat(join(dir, ".claude/skills/discern-write-adr")))
        .isSymlink,
      "the override should materialize as a symlink",
    );
  });
});

Deno.test("discern skills eject --json emits an envelope and materializes the override", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, [
      "skills",
      "eject",
      "--json",
      "discern-write-adr",
    ]);
    assertEquals(r.code, 0, r.output);
    assertEquals(r.stderr, "");
    const obj = JSON.parse(r.stdout) as {
      ok: boolean;
      verb: string;
      data: {
        name: string;
        dest_rel: string;
        skills_dir_persisted: boolean;
        materialized: { linked: number; errors: string[] };
      };
    };
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "skills:eject");
    assertEquals(obj.data.name, "discern-write-adr");
    assertEquals(obj.data.dest_rel, "skills/discern-write-adr");
    assertEquals(obj.data.skills_dir_persisted, false);
    assert(obj.data.materialized.linked >= 1);
    assertEquals(obj.data.materialized.errors, []);
    assert(
      await exists(join(dir, "skills/discern-write-adr/SKILL.md")),
      "ejected copy must land in ./skills/",
    );
    assert(
      (await Deno.lstat(join(dir, ".claude/skills/discern-write-adr")))
        .isSymlink,
      "the override should materialize as a symlink",
    );
  });
});

Deno.test("discern skills eject rejects an unknown skill", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["skills", "eject", "does-not-exist"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, 'no bundled skill named "does-not-exist"');
  });
});

Deno.test("discern skills eject --json reports errors in the envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, [
      "skills",
      "eject",
      "--json",
      "does-not-exist",
    ]);
    assertEquals(r.code, 1, r.output);
    assertEquals(r.stderr, "");
    const obj = JSON.parse(r.stdout) as {
      ok: boolean;
      verb: string;
      error: string;
      message: string;
    };
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "skills:eject");
    assertEquals(obj.error, "skills_eject_failed");
    assertStringIncludes(
      obj.message,
      'no bundled skill named "does-not-exist"',
    );
  });
});

Deno.test("the skills verb is hidden + errors when the skills feature is off", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[meta]",
        "schema_version = 7",
        "[project]",
        'slug = "demo"',
        "[features]",
        "skills = false",
        "",
      ].join("\n"),
    );
    // Hidden from --help.
    const help = await runAgent(dir, ["--help"]);
    assertEquals(help.stdout.includes("\n  skills"), false, help.stdout);
    // Invoking it errors with the feature-disabled message.
    const r = await runAgent(dir, ["skills", "list"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, 'the "skills" feature is disabled');
  });
});
