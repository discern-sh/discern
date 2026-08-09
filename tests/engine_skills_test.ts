/**
 * Engine coverage for the `discern skills` command group (list / eject) — the
 * dispatcher handlers that wrap `src/lib/skills.ts`. Driven through the real CLI
 * so Cliffy parsing, the feature gate, and the JSON surface are exercised.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { HINTS } from "../src/shared/hints.ts";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine, writeConfig } from "./engine_helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";

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
    assertEquals(obj.verb, "skills list");
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
      await exists(join(dir, "discern/skills/discern-write-adr/SKILL.md")),
      "ejected copy must land in the default skills dir",
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
      hints?: string[];
      data: {
        name: string;
        dest_rel: string;
        skills_dir_persisted: boolean;
        materialized: { linked: number; errors: string[] };
      };
    };
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "skills eject");
    assertEquals(obj.data.name, "discern-write-adr");
    assertEquals(obj.data.dest_rel, "discern/skills/discern-write-adr");
    assertEquals(obj.data.skills_dir_persisted, false);
    assert(obj.data.materialized.linked >= 1);
    assertEquals(obj.data.materialized.errors, []);
    assertHasHint(obj, HINTS["skills-eject-edit-override"]);
    assert(
      await exists(join(dir, "discern/skills/discern-write-adr/SKILL.md")),
      "ejected copy must land in the default skills dir",
    );
    assert(
      (await Deno.lstat(join(dir, ".claude/skills/discern-write-adr")))
        .isSymlink,
      "the override should materialize as a symlink",
    );
  });
});

Deno.test("discern skills eject partial materialization carries the registered recovery", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const skillsPath = join(dir, ".claude", "skills");
    await Deno.remove(skillsPath, { recursive: true }).catch(() => undefined);
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(skillsPath, "blocks the skills directory\n");

    const result = await runAgent(dir, [
      "skills",
      "eject",
      "--json",
      "discern-write-adr",
    ]);
    assertEquals(result.code, 1, result.output);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.error, "partial_materialization");
    assert(envelope.data.materialized.errors.length > 0, result.output);
    assertHasHint(envelope, HINTS["skills-eject-finish-materialization"]);
  });
});

Deno.test("skills eject persists an omitted skills.dir in tidy-canonical TOML", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(
      configPath,
      config.replace('dir = "discern/skills"\n', ""),
    );

    const result = await runAgent(dir, [
      "skills",
      "eject",
      "--json",
      "discern-write-adr",
    ]);
    assertEquals(result.code, 0, result.output);
    const output = JSON.parse(result.stdout) as {
      data: { skills_dir_persisted: boolean };
    };
    assertEquals(output.data.skills_dir_persisted, true);
    await assertDiscernTomlTidy(dir, "skills eject");
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
    assertEquals(obj.verb, "skills eject");
    assertEquals(obj.error, "skills_eject_failed");
    assertStringIncludes(
      obj.message,
      'no bundled skill named "does-not-exist"',
    );
  });
});

Deno.test("[skills].exclude drops a named skill end-to-end: list flags it, refresh omits it, an unknown name warns", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = true",
        "[project]",
        'slug = "demo"',
        "[skills]",
        'exclude = ["discern-write-adr", "no-such-skill"]',
        "",
      ].join("\n"),
    );
    // The listing shows the whole known set with the excluded row flagged.
    const list = await runAgent(dir, ["skills", "list", "--json"]);
    assertEquals(list.code, 0, list.output);
    const rows = (JSON.parse(list.stdout) as {
      data: { skills: { name: string; excluded: boolean }[] };
    }).data.skills;
    const excluded = rows.find((r) => r.name === "discern-write-adr");
    assertEquals(excluded?.excluded, true, JSON.stringify(rows));
    assert(
      rows.some((r) => r.name !== "discern-write-adr" && !r.excluded),
      "non-excluded skills stay effective",
    );

    // Materialization omits the excluded skill; the unknown name warns, never fails.
    const refresh = await runAgent(dir, ["refresh"]);
    assertEquals(refresh.code, 0, refresh.output);
    assertStringIncludes(refresh.output, "no-such-skill");
    const materialized = join(dir, ".claude/skills/discern-write-adr");
    assertEquals(
      await Deno.lstat(materialized).then(() => true).catch(() => false),
      false,
      "an excluded skill must not be materialized",
    );
  });
});
