/**
 * `init` must be non-destructive for MANAGED files (`agent`,
 * `.icculus/engine/**`, `.icculus/skills/**`). The bug these tests pin down: `init`
 * used to overwrite a same-named managed file unconditionally, silently
 * destroying a user's hand-edited recipe or a foreign file that happened to
 * share the path. The required behaviour mirrors `upgrade`'s hash-aware rule via
 * one shared helper:
 *
 *   - target absent                                   → create
 *   - present AND manifest's recorded hash matches    → overwrite (safe refresh)
 *   - present but NOT provably the kit's (no manifest,
 *     untracked, or hash differs)                     → preserve; write `<path>.new`
 *
 * These drive the real `assembleInitPlan` (the actual `init` entry point) over
 * the stable synthetic fixture, so they exercise manifest-loading + disposition
 * end to end without depending on the real templates other agents are filling.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assembleInitPlan } from "../src/commands/init.ts";
import { applyPlan, type Plan } from "../src/lib/fs_plan.ts";
import { parseManifest, recordedHash } from "../src/lib/manifest.ts";
import {
  FIXTURE_TEMPLATES,
  readTarget,
  targetExists,
  withTempDir,
} from "./helpers.ts";

/** A managed file present in the fixture tree (verbatim, executable recipe). */
const MANAGED_RECIPE = ".icculus/engine/recipe";

/** A resolved config for the fixture-backed init (matches testTokens identity). */
function fixtureConfig() {
  return {
    projectName: "Demo App",
    slug: "demo-app",
    branchPrefix: "agent/",
    sourceGlobs: ["src/**", "app/**"],
    brief: "A fixture brief.",
    agents: ["claude_code", "codex"] as ("claude_code" | "codex")[],
  };
}

/** Run the real init plan assembly over the fixture into `dir`, then apply it. */
async function initInto(dir: string): Promise<Plan> {
  const plan = await assembleInitPlan({
    templatesDir: FIXTURE_TEMPLATES,
    destDir: dir,
    config: fixtureConfig(),
  });
  await applyPlan(plan);
  return plan;
}

/** The disposition the plan resolved for one target path (or undefined). */
function dispositionOf(plan: Plan, targetRel: string): string | undefined {
  return plan.ops.find((o) => o.targetRel === targetRel)?.disposition;
}

Deno.test("init preserves a pre-existing managed file when NO manifest exists (.new written)", async () => {
  await withTempDir(async (dir) => {
    // A repo that already owns this exact path, with NO icculus manifest: the
    // file is not provably ours, so init must never clobber it.
    const userBody = "#!/bin/sh\n# the user's own recipe — must survive init\n";
    await Deno.mkdir(join(dir, ".icculus/engine"), { recursive: true });
    await Deno.writeTextFile(join(dir, MANAGED_RECIPE), userBody);

    const plan = await initInto(dir);

    // Disposition is `new`; the op targets the `.new` sibling.
    assertEquals(dispositionOf(plan, MANAGED_RECIPE), undefined);
    assertEquals(dispositionOf(plan, `${MANAGED_RECIPE}.new`), "new");

    // Original is byte-for-byte intact; the kit's version sits alongside.
    assertEquals(await readTarget(dir, MANAGED_RECIPE), userBody);
    assert(await targetExists(dir, `${MANAGED_RECIPE}.new`));
    assertStringIncludes(
      await readTarget(dir, `${MANAGED_RECIPE}.new`),
      "fixture recipe v1",
    );

    // The fresh manifest does NOT claim the kit wrote the canonical path — so a
    // later run still treats it as the user's and would not clobber it.
    const manifest = parseManifest(
      await readTarget(dir, ".icculus/manifest.json"),
    );
    assertEquals(recordedHash(manifest, MANAGED_RECIPE), undefined);
  });
});

Deno.test("init --force over an UNMODIFIED kit install overwrites in place, no .new", async () => {
  await withTempDir(async (dir) => {
    // First install lays the managed file and records its hash in the manifest.
    await initInto(dir);
    assert(await targetExists(dir, MANAGED_RECIPE));

    // Re-running init (the --force path: assembleInitPlan does not gate on the
    // toml — runInit does) over a pristine install must refresh cleanly. The
    // bytes are identical this round, so the disposition is `skip` (no needless
    // rewrite) and certainly no spurious `.new`.
    const plan = await initInto(dir);
    assertEquals(dispositionOf(plan, MANAGED_RECIPE), "skip");
    assertEquals(dispositionOf(plan, `${MANAGED_RECIPE}.new`), undefined);
    assert(
      !(await targetExists(dir, `${MANAGED_RECIPE}.new`)),
      "an unmodified re-install must not produce a .new sibling",
    );
  });
});

Deno.test("init refreshes a stale-but-pristine managed file in place (overwrite, no .new)", async () => {
  await withTempDir(async (dir) => {
    // Fixture managed files are token-free, so a re-install writes identical
    // bytes and lands on `skip`. To exercise the *overwrite* branch — on-disk
    // matches the recorded hash but differs from the kit's new bytes (a genuine
    // kit bump the user never touched) — we simulate an older kit: rewrite the
    // on-disk file to older content and point the manifest's recorded hash at
    // exactly that content. That makes the file provably ours yet stale, so the
    // next init must refresh it in place, never write a `.new`.
    await initInto(dir);

    const olderKit = "#!/usr/bin/env sh\n# an older kit version\n";
    await Deno.writeTextFile(join(dir, MANAGED_RECIPE), olderKit);
    const { sha256Hex } = await import("../src/lib/manifest.ts");
    const olderHash = await sha256Hex(new TextEncoder().encode(olderKit));
    const manifestPath = join(dir, ".icculus/manifest.json");
    const manifest = parseManifest(await Deno.readTextFile(manifestPath));
    manifest.managed = manifest.managed.map((e) =>
      e.path === MANAGED_RECIPE ? { ...e, sha256: olderHash } : e
    );
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
    );

    const plan = await initInto(dir);
    // On-disk (older) == recorded (older) != new (kit) → overwrite in place.
    assertEquals(dispositionOf(plan, MANAGED_RECIPE), "overwrite");
    assertEquals(dispositionOf(plan, `${MANAGED_RECIPE}.new`), undefined);
    assertStringIncludes(
      await readTarget(dir, MANAGED_RECIPE),
      "fixture recipe v1",
    );
  });
});

Deno.test("init preserves a USER-EDITED managed file from a prior install (.new written)", async () => {
  await withTempDir(async (dir) => {
    // First install records the pristine hash.
    await initInto(dir);

    // The user edits the managed recipe after install: on-disk no longer matches
    // the recorded hash, so it is no longer provably ours.
    const edited = '#!/usr/bin/env sh\necho "fixture recipe v1"\n# my tweak\n';
    await Deno.writeTextFile(join(dir, MANAGED_RECIPE), edited);

    const plan = await initInto(dir);
    assertEquals(dispositionOf(plan, `${MANAGED_RECIPE}.new`), "new");

    // The user's edit survives; the kit's version is alongside.
    assertEquals(await readTarget(dir, MANAGED_RECIPE), edited);
    assertStringIncludes(
      await readTarget(dir, `${MANAGED_RECIPE}.new`),
      "fixture recipe v1",
    );
    assert(
      !(await readTarget(dir, `${MANAGED_RECIPE}.new`)).includes("my tweak"),
    );
  });
});

Deno.test("init dry-run reports the .new disposition but writes nothing", async () => {
  await withTempDir(async (dir) => {
    // A pre-existing managed file, no manifest → would be preserved as `.new`.
    const userBody = "#!/bin/sh\n# do not destroy\n";
    await Deno.mkdir(join(dir, ".icculus/engine"), { recursive: true });
    await Deno.writeTextFile(join(dir, MANAGED_RECIPE), userBody);

    // Build the plan but DO NOT apply it (this is exactly what --dry-run does).
    const plan = await assembleInitPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      config: fixtureConfig(),
    });

    // The plan surfaces the `.new` decision...
    assertEquals(dispositionOf(plan, `${MANAGED_RECIPE}.new`), "new");

    // ...and nothing was written: the original is untouched and no `.new` exists.
    assertEquals(await readTarget(dir, MANAGED_RECIPE), userBody);
    assert(!(await targetExists(dir, `${MANAGED_RECIPE}.new`)));
    assert(!(await targetExists(dir, ".icculus/config.toml")));
  });
});
