/**
 * The parameterized engine run (ADR 0102): a representative slice of the
 * scaffolded engine suite driven against a FULLY non-default paths config —
 * every keyed registry path repointed via {@link repointSourcePaths} (derived
 * from the registry, so a new path auto-enrols). Scaffold (the installer's own
 * plan/apply — setup's surface), refresh, finish, and the skills
 * materialization pass must behave identically to the default layout: this is
 * the behavioral-parity-under-reconfiguration guard no grep can fake.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists, walk } from "@std/fs";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  repointSourcePaths,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

Deno.test("engine on non-default paths: refresh compiles guidance and renders skills to the configured layout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const repointed = await repointSourcePaths(dir);
    const mapDir = repointed.find((p) => p.name === "map")?.value;
    const guidanceSrc = repointed.find((p) => p.name === "guidance")?.value;
    const skillsDir = repointed.find((p) => p.name === "skills")?.value;
    assert(
      mapDir !== undefined && guidanceSrc !== undefined &&
        skillsDir !== undefined,
    );

    // A user source at the repointed guidance path, and an authored skill in
    // the repointed skills dir — both must be picked up from the new layout.
    await Deno.writeTextFile(join(dir, guidanceSrc), "# ZZ custom rules\n");
    await Deno.mkdir(join(dir, skillsDir, "my-alt-skill"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, skillsDir, "my-alt-skill", "SKILL.md"),
      "# my-alt-skill\n",
    );

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    // Compiled guidance speaks the repointed layout and carries the user source.
    const claude = await Deno.readTextFile(join(dir, "CLAUDE.md"));
    assertStringIncludes(claude, mapDir);
    assertStringIncludes(claude, "ZZ custom rules");

    // Bundled skills render to the configured paths — and no registry default
    // (list derived from the registry) survives anywhere in the materialized set.
    const adr = await Deno.readTextFile(
      join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
    );
    assertStringIncludes(adr, `${mapDir}_adr/`);
    const defaults = SOURCE_PATH_NAMES.map((n) => SOURCE_PATHS[n].defaultPath);
    for await (
      const e of walk(join(dir, ".claude/skills"), {
        includeDirs: false,
        followSymlinks: false,
      })
    ) {
      if (e.isSymlink || !e.isFile) {
        continue; // authored entries are the user's own symlinked content
      }
      const text = await Deno.readTextFile(e.path);
      assert(!text.includes("{{"), `unrendered token residue in ${e.path}`);
      for (const def of defaults) {
        assert(
          !text.includes(def),
          `${e.path} leaks the registry default "${def}"`,
        );
      }
    }

    // The authored skill from the repointed dir is symlinked live.
    assert(
      await exists(join(dir, ".claude/skills/my-alt-skill/SKILL.md")),
      `authored skill from ${skillsDir} must materialize\n${r.output}`,
    );
  });
});

Deno.test("engine on non-default paths: finish is green, and a later repoint is stale until refresh", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await repointSourcePaths(dir);
    await gitInit(dir);

    let r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    // The full gate passes on the repointed layout exactly as on the default one.
    r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(JSON.parse(r.stdout).ok, true, r.output);

    // Repoint the map tree AGAIN (a user moving a convention): the rendered
    // skills go stale, status reports it, and `done` refuses until refresh.
    const configPath = join(dir, "discern.toml");
    const editor = new TomlEditor(await Deno.readTextFile(configPath));
    editor.setString("map.dir", "zz-alt2-docs/");
    await Deno.writeTextFile(configPath, editor.toString());
    await git(dir, "commit", "-aqm", "repoint docs", "--no-gpg-sign");

    r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const stale: Array<{ name: string }> =
      JSON.parse(r.stdout).data.stale_materialized ?? [];
    assert(
      stale.length > 0,
      `status must flag rendered skills stale after a repoint\n${r.stdout}`,
    );

    r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, `finish must refuse stale skills\n${r.output}`);
    assertStringIncludes(r.output, "refresh");

    // Refresh re-renders; finish is green again and the skills speak the new path.
    r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);
    r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(
      await Deno.readTextFile(
        join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
      ),
      "zz-alt2-docs/_adr/",
    );
  });
});
