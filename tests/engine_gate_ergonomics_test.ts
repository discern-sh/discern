/**
 * Engine tests for the long-job ergonomics (ADR 0006): `[gate].stream` (live
 * line-prefixed output) and `[gate].fail_fast` (cancel in-flight siblings on
 * first failure). These drive `agent finish` with two independent commands in the
 * same parallel check stage: one fails fast and its sibling would otherwise
 * remain active until cancelled. The fixture stays independent of the
 * repository-wide test cap, which deliberately separates check from test when enabled.
 */

import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** A held sibling acknowledges startup before the fail-fast trigger runs. */
function failFastConfig(
  opts: {
    failFast?: boolean;
    stream?: boolean;
    ready?: string;
  },
): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    // A ready marker makes the failure wait until its sibling actually starts.
    `lint = ${
      JSON.stringify(
        opts.ready === undefined
          ? "exit 1"
          : `while [ ! -s '${opts.ready}' ]; do sleep 0.01; done; exit 1`,
      )
    }`,
    "[jobs.sibling]",
    'stage = "check"',
    `run = ${
      JSON.stringify(
        `${opts.ready === undefined ? "" : `echo started > '${opts.ready}'; `}${
          opts.ready === undefined ? "" : "tail -f /dev/null; "
        }echo RAN-TO-END${
          opts.ready === undefined ? "" : ` > '${opts.ready}.done'`
        }`,
      )
    }`,
    "",
    ...(opts.failFast === undefined ? [] : [
      "[gate]",
      `stream = ${opts.stream ? "true" : "false"}`,
      `fail_fast = ${opts.failFast ? "true" : "false"}`,
    ]),
    "",
  ].join("\n");
}

for (const failFast of [true, undefined]) {
  Deno.test(`gate fail_fast ${failFast === undefined ? "defaults on" : "is enabled"}: a failing job cancels its running sibling`, async () => {
    await withTempDir(async (markers) => {
      await withTempDir(async (dir) => {
        const ready = join(markers, "ready");
        await scaffoldEngine(dir);
        await writeConfig(
          dir,
          failFastConfig({
            ...(failFast === undefined ? {} : { failFast }),
            ready,
          }),
        );
        await gitInit(dir);
        const r = await runAgent(dir, ["done", "--json"]);
        assertEquals(r.code, 1, r.output);
        assertEquals(await Deno.readTextFile(ready), "started\n");
        const result = decodeCliResult(r.stdout, "done");
        assertEquals(
          result.steps?.find((step) => step.label === "sibling")?.outcome,
          "cancelled",
          r.output,
        );
        assert(
          !await targetExists(`${ready}.done`),
          "the running sibling must be cancelled before normal completion",
        );
      });
    });
  });
}

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
