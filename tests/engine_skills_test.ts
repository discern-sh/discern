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
    assertStringIncludes(human.stdout, "bootstrap");
    assertStringIncludes(human.stdout, "built-in");

    const json = await runAgent(dir, ["skills", "list", "--json"]);
    assertEquals(json.code, 0, json.output);
    const rows = JSON.parse(json.stdout) as Array<{
      name: string;
      source: string;
    }>;
    assert(rows.some((r) => r.name === "bootstrap" && r.source === "bundled"));
  });
});

Deno.test("discern skills eject copies a built-in and the effective set then prefers it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, ["skills", "eject", "bootstrap"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Ejected");
    assert(
      await exists(join(dir, "skills/bootstrap/SKILL.md")),
      "ejected copy must land in ./skills/",
    );
    // The ejected copy now overrides the built-in in the listing.
    const list = await runAgent(dir, ["skills", "list"]);
    assertStringIncludes(list.stdout, "yours (overrides built-in)");
    // And it materialized as a symlink under .claude/skills/.
    assert(
      (await Deno.lstat(join(dir, ".claude/skills/bootstrap"))).isSymlink,
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

Deno.test("the skills verb is hidden + errors when the skills feature is off", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[meta]",
        "schema_version = 6",
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
