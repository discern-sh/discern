/**
 * Engine tests for the gate's map & instructions integrity preflight.
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
 *
 * Guards: claim:map-mechanically-checked
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  convergeFixtureGitattributes,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

import {
  expectMapIntegrityFailure,
  writeMapPage,
} from "./engine_map_integrity_shared.ts";

Deno.test("done --json: a dead link fails the map_integrity preflight; repointing fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A project with no map passes trivially; the fix half of each case below
    // proves a POPULATED map passes too. The map sits outside the scaffold's
    // source scope, so a red result here also proves the preflight fires
    // regardless of scope classification.
    assertEquals(
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
      0,
    );

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
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
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
    assertEquals(
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
      0,
    );
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
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
      0,
      "third-party frontmatter keys must not fail the gate",
    );

    // A recognised key the lenient reader would silently drop does fail.
    await Deno.writeTextFile(page, "---\npublish: 0\n---\n\n# Notes\n");
    const output = await expectMapIntegrityFailure(dir);
    assertStringIncludes(output, "frontmatter");
    assertStringIncludes(output, "publish: must be exactly true or false");

    await Deno.writeTextFile(page, "---\npublish: false\n---\n\n# Notes\n");
    assertEquals(
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
      0,
    );
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
    await convergeFixtureGitattributes(dir);
    assertEquals(
      (await runAgent(dir, ["done", "--standalone", "--json"])).code,
      0,
      "a project-script name must validate as an extra verb",
    );
  });
});
