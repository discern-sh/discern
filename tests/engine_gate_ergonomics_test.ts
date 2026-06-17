/**
 * Engine tests for the long-slot ergonomics (ADR 0006): `[gate].stream` (live
 * line-prefixed output) and `[gate].fail_fast` (cancel in-flight siblings on
 * first failure). These drive `agent finish` with two slots in the SAME parallel
 * stage — a `check` slot that fails fast and a `test` slot that would otherwise
 * run for seconds — since fail-fast cancels concurrent siblings, and check+test
 * is the gate's parallel stage (fix and build run in their own ordered stages).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/**
 * A config with two slots in the SAME parallel stage: a `check` slot that fails
 * immediately and a `test` slot that is slow. (check and test run together.)
 */
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
    "[slots.lint]",
    'phase = "check"',
    'run = "exit 1"', // fails fast
    "",
    "[slots.slowtest]",
    'phase = "test"',
    'run = "sleep 5; echo RAN-TO-END"', // slow sibling in the same stage
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
      !r.output.includes("RAN-TO-END"),
      "fail_fast should cancel the slow sibling before it completes",
    );
    // ...and the gate returned well before the 5s sleep would have elapsed.
    assert(elapsed < 4500, `expected a fast abort, took ${elapsed}ms`);
  });
});

Deno.test("gate fail_fast is ON by default (no [gate] section)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // No [gate] section at all — fail_fast defaults on in 1.0.
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
        "[slots.lint]",
        'phase = "check"',
        'run = "exit 1"',
        "",
        "[slots.slowtest]",
        'phase = "test"',
        'run = "sleep 5; echo RAN-TO-END"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = Date.now();
    const r = await runAgent(dir, ["finish"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    assert(
      !r.output.includes("RAN-TO-END"),
      "fail_fast should be the default and cancel the slow sibling",
    );
    assert(elapsed < 4500, `expected a fast abort, took ${elapsed}ms`);
  });
});

Deno.test("gate fail_fast=false: the slow sibling runs to completion", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, failFastConfig({ failFast: false }));
    await gitInit(dir);

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    // Without fail_fast every job runs to completion (buffered, grouped).
    assertStringIncludes(r.output, "RAN-TO-END");
  });
});

Deno.test("gate fail_fast: this project's config wins over an inherited env var", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, failFastConfig({ failFast: false }));
    await gitInit(dir);

    // Simulate `finish` running nested inside another gate: the PARENT exported
    // ICCULUS_GATE_FAIL_FAST=1 (the suite shells out to `agent finish`). This
    // child's own config says false, so it must still run the slow sibling to
    // completion — the inherited env must not override [gate].fail_fast.
    const r = await runAgent(dir, ["finish"], {
      env: { ICCULUS_GATE_FAIL_FAST: "1" },
    });
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "RAN-TO-END");
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
