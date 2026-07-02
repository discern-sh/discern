/**
 * Engine coverage for the `changed-scopes` verb's output surface — the human
 * line list, the `--has` membership exit code, and the `--json` DiscernResult
 * envelope (ADR 0028: `{ok, verb, data:{scopes}}`, no longer a bare array).
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  changedScopes,
  CODE_MARKER,
  isScopeMarker,
  PREVIEWABLE_MARKER,
} from "../src/engine/scopes/changed.ts";
import { loadConfig } from "../src/shared/config_schema.ts";

async function scaffoldWithWidget(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      'main_branch = "main"',
      "",
      "[scopes.widget]",
      'paths = ["widget/**"]',
      'gate = "true"',
      "",
    ].join("\n"),
  );
  await gitInit(dir);
  await writeExecutable(join(dir, "widget/x.txt"), "x"); // make widget a changed scope
}

Deno.test("changed-scopes --json: emits the DiscernResult envelope, not a bare array", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithWidget(dir);
    const r = await runAgent(dir, ["changed-scopes", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "changed-scopes");
    assert(Array.isArray(obj.data.scopes), r.stdout);
    assert(obj.data.scopes.includes("widget"), r.stdout);
  });
});

Deno.test("changedScopes emits ONLY declared SCOPE_MARKERS alongside the configured scope names", async () => {
  // The producer's marker pushes go through the SCOPE_MARKERS SSOT; this pins that
  // behaviourally. A previewable scope change fires both derived markers, and EVERY
  // emitted entry must be either a configured scope name or a declared marker — so a
  // future bare-literal `out.push("...")` outside SCOPE_MARKERS red-lights here.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.web]",
        'paths = ["web/**"]',
        "previewable = true",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "web/x.txt"), "x"); // a previewable change

    const result = await changedScopes(dir);
    // Both derived markers fire for a previewable, non-neutral change (behaviour).
    assert(
      result.includes(CODE_MARKER),
      `expected ${CODE_MARKER} in ${result}`,
    );
    assert(
      result.includes(PREVIEWABLE_MARKER),
      `expected ${PREVIEWABLE_MARKER} in ${result}`,
    );
    // Every non-scope-name entry is a DECLARED marker (the producer-side tie).
    const scopeNames = new Set(Object.keys((await loadConfig(dir)).scopes));
    for (const entry of result) {
      assert(
        scopeNames.has(entry) || isScopeMarker(entry),
        `changedScopes emitted "${entry}", neither a configured scope nor a declared marker`,
      );
    }
  });
});

Deno.test("changed-scopes fails open when git cannot diff against the main branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.docs]",
        'paths = ["docs/**"]',
        "neutral = true",
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        "previewable = true",
        "",
        "[scopes.api]",
        'paths = ["api/**"]',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await git(dir, "branch", "-M", "trunk");

    const r = await runAgent(dir, ["changed-scopes", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.data.scopes, [
      CODE_MARKER,
      PREVIEWABLE_MARKER,
      "widget",
      "api",
    ]);
  });
});

Deno.test("changed-scopes: human mode lists scopes one per line; --has tests membership by exit code", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithWidget(dir);

    const human = await runAgent(dir, ["changed-scopes"]);
    assertEquals(human.code, 0, human.output);
    assert(
      human.stdout.split("\n").includes("widget"),
      `expected 'widget' on its own line, got: ${human.stdout}`,
    );

    const hit = await runAgent(dir, ["changed-scopes", "--has", "widget"]);
    assertEquals(hit.code, 0, "widget changed → exit 0");
    const miss = await runAgent(dir, ["changed-scopes", "--has", "nope"]);
    assertEquals(miss.code, 1, "unknown scope → exit 1");
  });
});
