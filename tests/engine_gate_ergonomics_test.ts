/**
 * Engine tests for the long-job ergonomics (ADR 0006): `[gate].stream` (live
 * line-prefixed output) and `[gate].fail_fast` (cancel in-flight siblings on
 * first failure). These drive `agent finish` with two jobs in the SAME parallel
 * stage — a `lint` (check-stage) capability that fails fast and a `test`
 * capability that would otherwise run for seconds — since fail-fast cancels
 * concurrent siblings, and check+test is the gate's parallel stage (fix and
 * build run in their own ordered stages).
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
 * A config with two jobs in the SAME parallel stage: a `lint` (check-stage)
 * capability that fails immediately and a `test` capability that is slow. (check
 * and test run together.)
 */
function failFastConfig(opts: { failFast: boolean; stream?: boolean }): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[capabilities]",
    'lint = "exit 1"', // fails fast (check stage)
    'test = "sleep 5; echo RAN-TO-END"', // slow sibling in the same parallel stage
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
    const r = await runAgent(dir, ["done"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // The slow sibling was cancelled before it could print its marker...
    assert(
      !r.output.includes("RAN-TO-END"),
      "fail_fast should cancel the slow sibling before it completes",
    );
    // ...and the gate returned well before the 5s sleep would have elapsed.
    assert(elapsed < 10_000, `expected a fast abort, took ${elapsed}ms`);
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[capabilities]",
        'lint = "exit 1"',
        'test = "sleep 5; echo RAN-TO-END"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = Date.now();
    const r = await runAgent(dir, ["done"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    assert(
      !r.output.includes("RAN-TO-END"),
      "fail_fast should be the default and cancel the slow sibling",
    );
    assert(elapsed < 10_000, `expected a fast abort, took ${elapsed}ms`);
  });
});

Deno.test("gate fail_fast=false: the slow sibling runs to completion", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, failFastConfig({ failFast: false }));
    await gitInit(dir);

    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 1, r.output);
    // Without fail_fast every job runs to completion (buffered, grouped).
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[capabilities]",
        'format = "echo HELLO-FROM-FIX"', // format is a fix-stage capability
        "",
        "[gate]",
        "stream = true",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 0, r.output);
    // Streamed lines carry the `── <label> │ ` prefix.
    assertStringIncludes(r.output, "│ HELLO-FROM-FIX");
  });
});
