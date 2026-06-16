/**
 * Engine tests for first-class side-gates (ADR 0002).
 *
 * Side-gates now run with the slot phase model: every fired gate runs
 * concurrently via run_parallel, output is grouped and labelled `side:<scope>`,
 * and a single failure fails the gate while all gates still run. These tests
 * drive `agent finish` with custom scopes + side-gates in a real git repo,
 * triggering scopes with untracked files.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

/** A config with two custom scopes, each wired to a side-gate command. */
function sideGateConfig(widgetCmd: string, gadgetCmd: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes]",
    'neutral = ["docs/"]',
    'web = ["src/**"]',
    'widget = ["widget/**"]',
    'gadget = ["gadget/**"]',
    "",
    "[scopes.side_gates]",
    `widget = "${widgetCmd}"`,
    `gadget = "${gadgetCmd}"`,
    "",
  ].join("\n");
}

/** Create an untracked file under a path so changed-scopes classifies it. */
async function touch(dir: string, rel: string): Promise<void> {
  await writeExecutable(join(dir, rel), "x"); // writeExecutable ensures parent dirs
}

Deno.test("side-gates: a gate fires (grouped + labelled) when its scope changed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-GATE-RAN", "echo GADGET-GATE-RAN"),
    );
    await gitInit(dir);
    await touch(dir, "widget/x.txt"); // only the widget scope changed

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "side:widget"); // labelled like a slot phase
    assertStringIncludes(r.stdout, "WIDGET-GATE-RAN");
    // The gadget gate did NOT fire (its scope didn't change).
    assert(
      !r.output.includes("GADGET-GATE-RAN"),
      "an unchanged scope's side-gate must not run",
    );
  });
});

Deno.test("side-gates: no gate fires when only an unrelated scope changed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-GATE-RAN", "echo GADGET-GATE-RAN"),
    );
    await gitInit(dir);
    await touch(dir, "src/app.txt"); // web scope only; no side-gate wired to it

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 0, r.output);
    assert(!r.output.includes("WIDGET-GATE-RAN"));
    assert(!r.output.includes("GADGET-GATE-RAN"));
  });
});

Deno.test("side-gates: a failing gate fails finish and points at the gotchas", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-OK", "echo GADGET-FAIL; exit 1"),
    );
    await gitInit(dir);
    await touch(dir, "gadget/y.txt");

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stdout, "FAILED");
    assertStringIncludes(r.stderr, "side gates failed");
    // The shared gotchas pointer fires on a gated-phase failure.
    assertStringIncludes(r.stderr, "gate step failed");
  });
});

Deno.test("side-gates: all fired gates run even when one fails (run-all, not fail-fast)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-OK", "echo GADGET-FAIL; exit 1"),
    );
    await gitInit(dir);
    await touch(dir, "widget/x.txt");
    await touch(dir, "gadget/y.txt");

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    // Both ran and both are reported — not aborted at the first failure.
    assertStringIncludes(r.stdout, "WIDGET-OK");
    assertStringIncludes(r.stdout, "GADGET-FAIL");
    assertStringIncludes(r.stdout, "side:widget");
    assertStringIncludes(r.stdout, "side:gadget");
  });
});
