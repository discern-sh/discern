/**
 * Map-integrity gate tests over the publication and citation rules: the
 * audience boundary (_internal/), bundled-skill citations, and instructions
 * sources. Split from `engine_map_integrity_test.ts` so `deno test --parallel`
 * (per-FILE distribution) can spread the serial `done` runs.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  convergeFixtureGitattributes,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  expectMapIntegrityFailure,
  writeMapPage,
} from "./engine_map_integrity_shared.ts";

Deno.test("done --json: a published page linking into _internal/ fails; publish: false opts it out", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The target exists — the finding is the audience boundary, not a dead link.
    await writeMapPage(
      dir,
      "_internal/documenter-agent-brief.md",
      "# Documenter brief\n",
    );
    const page = await writeMapPage(
      dir,
      "tour.md",
      "# Tour\n\nSee the [documenter brief](_internal/documenter-agent-brief.md).\n",
    );
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "audience-boundary");
    assertStringIncludes(output, "_internal/");
    assertStringIncludes(output, "publish: false"); // the escape is named

    // Declaring the page internal-facing is the sanctioned escape.
    await Deno.writeTextFile(
      page,
      "---\npublish: false\n---\n\n# Tour\n\nSee the " +
        "[documenter brief](_internal/documenter-agent-brief.md).\n",
    );
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);
  });
});

Deno.test("done --json: excluding a bundled skill the map still cites fails until the citation follows", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // materialize the effective set
    // A map README recommending a bundled skill — the shape `discern setup`
    // seeds — is sound while the skill is effective.
    const readme = await writeMapPage(
      dir,
      "README.md",
      "# Map\n\nGrow each subtree with the `discern-document-subsystem` skill.\n",
    );
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // Excluding that skill removes it from the effective set everywhere —
    // leaving the recommendation pointing at nothing. The refresh keeps the
    // materialized dirs current so THIS preflight, not the currency check,
    // is what fires.
    const configPath = join(dir, "discern.toml");
    const editor = new TomlEditor(await Deno.readTextFile(configPath));
    editor.setStringArray("skills.exclude", ["discern-document-subsystem"]);
    await Deno.writeTextFile(configPath, editor.toString());
    await runAgent(dir, ["refresh"]);

    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "skill-citation");
    assertStringIncludes(output, "discern-document-subsystem");
    assertStringIncludes(output, "skills list"); // where to see the live set

    // Updating the citation (here: dropping the recommendation) clears it.
    await Deno.writeTextFile(
      readme,
      "# Map\n\nGrow each subtree by hand.\n",
    );
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);
  });
});

Deno.test("done --json: a instruction source citing an unknown skill fails with the source named", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // [instructions].sources are read present-only, so creating the default
    // source file enrols it in the preflight's command and citation checks.
    const instructions = join(dir, SOURCE_PATHS.instructions.defaultPath);
    await Deno.mkdir(join(instructions, ".."), { recursive: true });
    await Deno.writeTextFile(
      instructions,
      "# Project instructions\n\nUse the `discern-polish-the-lamp` skill for finishing passes.\n",
    );
    await convergeFixtureGitattributes(dir);
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, SOURCE_PATHS.instructions.defaultPath);
    assertStringIncludes(output, "skill-citation");
    assertStringIncludes(output, "discern-polish-the-lamp");
  });
});
