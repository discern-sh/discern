/**
 * Engine tests for the long-job ergonomics (ADR 0006): `[gate].stream` (live
 * line-prefixed output) and `[gate].fail_fast` (cancel in-flight siblings on
 * first failure). These drive `agent finish` with two independent commands in the
 * same parallel check stage: one fails fast and its sibling would otherwise
 * run for seconds. The fixture stays independent of the repository-wide test
 * cap, which deliberately separates check from test when enabled.
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/**
 * A config with two jobs in the same parallel check stage. `sleepS` sets
 * how long the slow sibling would run uncancelled — a cancellation test needs a
 * window wide enough that a loaded machine cannot let the sleep win the race
 * against the abort.
 */
function failFastConfig(
  opts: { failFast: boolean; stream?: boolean; sleepS?: number },
): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    // Both commands share the check stage; the first fails immediately.
    `lint = "exit 1"`,
    "[jobs.sibling]",
    'stage = "check"',
    `run = "sleep ${opts.sleepS ?? 5}; echo RAN-TO-END"`,
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
    await writeConfig(dir, failFastConfig({ failFast: true, sleepS: 30 }));
    await gitInit(dir);

    const start = SYSTEM_CLOCK.wallNow();
    const r = await runAgent(dir, ["done"]);
    const elapsed = SYSTEM_CLOCK.wallNow() - start;

    assertEquals(r.code, 1, r.output);
    // The slow sibling was cancelled before it could print its marker...
    assert(
      !r.output.includes("RAN-TO-END"),
      "fail_fast should cancel the slow sibling before it completes",
    );
    // ...and the gate returned well before the 30s sleep would have elapsed.
    // The bound stays far under the sleep so the assertions discriminate, and
    // far over a loaded machine's engine startup so they don't flake.
    assert(elapsed < 20_000, `expected a fast abort, took ${elapsed}ms`);
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
        "[jobs]",
        'lint = "exit 1"',
        "[jobs.sibling]",
        'stage = "check"',
        'run = "sleep 30; echo RAN-TO-END"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = SYSTEM_CLOCK.wallNow();
    const r = await runAgent(dir, ["done"]);
    const elapsed = SYSTEM_CLOCK.wallNow() - start;

    assertEquals(r.code, 1, r.output);
    assert(
      !r.output.includes("RAN-TO-END"),
      "fail_fast should be the default and cancel the slow sibling",
    );
    assert(elapsed < 20_000, `expected a fast abort, took ${elapsed}ms`);
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
        "[jobs]",
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
    assertTerminalTextIncludes(r.output, "│ HELLO-FROM-FIX");
  });
});
