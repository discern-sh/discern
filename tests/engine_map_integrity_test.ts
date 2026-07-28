/**
 * Engine tests for the gate's map & guidance integrity preflight.
 *
 * Every project's `discern done` must refuse documentation whose references a
 * reader cannot follow: dead intra-map links and anchors, metadata blocks the
 * lenient reader would swallow, fenced `discern` examples the current CLI
 * rejects, published pages linking into the internal trees, and skill
 * citations naming no skill in the effective set. Each case here proves the
 * failure mode end-to-end — `failed_stage: "map_integrity"`, the grouped
 * `map-integrity` diagnostic with `file:line`, rule, and remedy — and that the
 * matching fix (or the deliberate escape) turns the gate green again. The
 * preflight is a fail-fast precondition, so it fires before scope
 * classification can excuse a docs-only change.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  defaultMapPath,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

interface GateJsonDiagnostic {
  tool: string;
  message: string;
  output?: string;
}

interface GateJson {
  ok: boolean;
  diagnostics?: GateJsonDiagnostic[];
  data: { failed_stage: string | null };
}

function parseJson(stdout: string): GateJson {
  return JSON.parse(stdout.trim()) as GateJson;
}

function diagFor(
  obj: GateJson,
  tool: string,
): GateJsonDiagnostic | undefined {
  return (obj.diagnostics ?? []).find((diagnostic) => diagnostic.tool === tool);
}

/** Write one map page (creating the configured default map dir), returning
 * its absolute path. The engine scaffold seeds no map — a docs-less project is
 * legitimately green — so each case lays exactly the corpus it needs. */
async function writeMapPage(
  dir: string,
  rel: string,
  content: string,
): Promise<string> {
  const path = defaultMapPath(dir, rel);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
  return path;
}

/** Run `done --json`, assert the map-integrity preflight blocked, and return
 * the diagnostic's captured output for content asserts. */
async function expectMapIntegrityFailure(dir: string): Promise<string> {
  const r = await runAgent(dir, ["done", "--json"]);
  assertEquals(r.code, 1, r.output);
  const obj = parseJson(r.stdout);
  assertEquals(obj.ok, false);
  assertEquals(obj.data.failed_stage, "map_integrity");
  const diag = diagFor(obj, "map-integrity");
  assert(
    diag !== undefined,
    `expected a map-integrity diagnostic: ${r.stdout}`,
  );
  assertStringIncludes(diag.message, "integrity");
  assert(diag.output !== undefined, "diagnostic must carry captured output");
  return diag.output;
}

Deno.test("done --json: a dead link fails the map_integrity preflight; repointing fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A project with no map passes trivially; the fix half of each case below
    // proves a POPULATED map passes too. The map sits outside the scaffold's
    // source scope, so a red result here also proves the preflight fires
    // regardless of scope classification.
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    await writeMapPage(dir, "overview.md", "# Overview\n\nText.\n");
    const page = await writeMapPage(
      dir,
      "tour.md",
      "# Tour\n\nStart at the [overview](missing-overview.md).\n",
    );
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "tour.md:3"); // file:line
    assertStringIncludes(output, "dead-link"); // the rule
    assertStringIncludes(output, "missing-overview.md");
    assertStringIncludes(output, "Repoint or remove the link"); // the remedy

    await Deno.writeTextFile(
      page,
      "# Tour\n\nStart at the [overview](overview.md).\n",
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "repointing the link should clear the preflight",
    );
  });
});

Deno.test("done --json: a dead anchor fails; naming a real heading fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const page = await writeMapPage(
      dir,
      "tour.md",
      "# Tour\n\n## Setup\n\nSee [elsewhere](tour.md#tear-down).\n",
    );
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "dead-anchor");
    assertStringIncludes(output, "tear-down");

    await Deno.writeTextFile(
      page,
      "# Tour\n\n## Setup\n\nSee [above](tour.md#setup).\n",
    );
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);
  });
});

Deno.test("done --json: a mis-shaped known frontmatter key fails; third-party keys never do", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Unknown keys are tolerated: projects carry third-party frontmatter.
    const page = await writeMapPage(
      dir,
      "notes.md",
      "---\nlayout: post\nsidebar_position: 4\n---\n\n# Notes\n",
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "third-party frontmatter keys must not fail the gate",
    );

    // A recognised key the lenient reader would silently drop does fail.
    await Deno.writeTextFile(page, "---\npublish: 0\n---\n\n# Notes\n");
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "frontmatter");
    assertStringIncludes(output, "publish: must be exactly true or false");

    await Deno.writeTextFile(page, "---\npublish: false\n---\n\n# Notes\n");
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);
  });
});

Deno.test("done --json: a stale fenced example fails; a Project Script verb is accepted", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeMapPage(
      dir,
      "howto.md",
      "# Howto\n\n```sh\ndiscern frobnicate --json\n```\n",
    );
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "stale-command");
    assertStringIncludes(output, "frobnicate");
    assertStringIncludes(output, "--help"); // the remedy points at the live set

    // A Project Script dispatches as a first-class verb, so an example naming
    // one is sound the moment the executable exists.
    await writeExecutable(
      join(dir, SOURCE_PATHS.scripts.defaultPath, "frobnicate"),
      "#!/bin/sh\n# desc: engine-test script\n",
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "a project-script name must validate as an extra verb",
    );
  });
});

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

Deno.test("done --json: a guidance source citing an unknown skill fails with the source named", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // [guidance].sources are read present-only, so creating the default
    // source file enrols it in the preflight's command and citation checks.
    const guidance = join(dir, SOURCE_PATHS.guidance.defaultPath);
    await Deno.mkdir(join(guidance, ".."), { recursive: true });
    await Deno.writeTextFile(
      guidance,
      "# Project guidance\n\nUse the `discern-polish-the-lamp` skill for finishing passes.\n",
    );
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, SOURCE_PATHS.guidance.defaultPath);
    assertStringIncludes(output, "skill-citation");
    assertStringIncludes(output, "discern-polish-the-lamp");
  });
});
