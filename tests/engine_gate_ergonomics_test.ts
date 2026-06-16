/**
 * Engine tests for the opt-in long-slot ergonomics (ADR 0006): `[gate].stream`
 * (live line-prefixed output) and `[gate].fail_fast` (cancel in-flight siblings
 * on first failure). Both default off; these tests drive `agent finish` with a
 * fix slot that fails fast and a build slot that would otherwise run for seconds.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** A config whose fix slot fails immediately and whose build slot is slow. */
function failFastConfig(opts: { failFast: boolean; stream?: boolean }): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes]",
    'neutral = ["docs/"]',
    'web = ["src/**"]',
    "",
    "[slots.format]",
    'phase = "fix"',
    'run = "exit 1"', // fails fast
    "",
    "[slots.build]",
    'phase = "build"',
    'run = "sleep 5; echo BUILT-AFTER-SLEEP"', // slow sibling
    "",
    "[gate]",
    `stream = ${opts.stream ? "true" : "false"}`,
    `fail_fast = ${opts.failFast ? "true" : "false"}`,
    "",
  ].join("\n");
}

Deno.test("gate fail_fast: a failing job cancels its slow sibling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, failFastConfig({ failFast: true }));
    await gitInit(dir);

    const start = Date.now();
    const r = await runAgent(dir, ["finish"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // The slow sibling was cancelled before it could print its marker...
    assert(
      !r.output.includes("BUILT-AFTER-SLEEP"),
      "fail_fast should cancel the slow sibling before it completes",
    );
    // ...and the gate returned well before the 5s sleep would have elapsed.
    assert(elapsed < 4500, `expected a fast abort, took ${elapsed}ms`);
  });
});

Deno.test("gate default (no fail_fast): the slow sibling runs to completion", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, failFastConfig({ failFast: false }));
    await gitInit(dir);

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    // Without fail_fast every job runs to completion (buffered, grouped).
    assertStringIncludes(r.output, "BUILT-AFTER-SLEEP");
  });
});

Deno.test("gate stream: output is line-prefixed with the job label", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        "",
        "[slots.format]",
        'phase = "fix"',
        'run = "echo HELLO-FROM-FIX"',
        "",
        "[gate]",
        "stream = true",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 0, r.output);
    // Streamed lines carry the `── <label> │ ` prefix.
    assertStringIncludes(r.output, "│ HELLO-FROM-FIX");
  });
});
