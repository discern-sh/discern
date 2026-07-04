/**
 * Engine tests for scope gates (ADR 0018, folding in the former side-gates of
 * ADR 0002).
 *
 * A scope gate is a `gate` command on a `[scopes.<name>]` table: every fired
 * gate runs concurrently via run_parallel, output is grouped and labelled
 * `scope:<name>`, and a single failure fails the gate while all gates still run.
 * These tests drive `agent finish` with custom scopes + gates in a real git
 * repo, triggering scopes with untracked files.
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

/** A config with two custom scopes, each wired to a scope-gate command. */
function sideGateConfig(widgetCmd: string, gadgetCmd: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes.docs]",
    'paths = ["docs/"]',
    "neutral = true",
    "",
    "[scopes.widget]",
    'paths = ["widget/**"]',
    `gate = "${widgetCmd}"`,
    "",
    "[scopes.gadget]",
    'paths = ["gadget/**"]',
    `gate = "${gadgetCmd}"`,
    "",
  ].join("\n");
}

/** Create an untracked file under a path so scopes classifies it. */
async function touch(dir: string, rel: string): Promise<void> {
  await writeExecutable(join(dir, rel), "x"); // writeExecutable ensures parent dirs
}

Deno.test("scope-gates: a gate fires (grouped + labelled) when its scope changed", async () => {
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
    assertStringIncludes(r.stdout, "scope:widget"); // labelled like a gate job
    assertStringIncludes(r.stdout, "WIDGET-GATE-RAN");
    // The gadget gate did NOT fire (its scope didn't change).
    assert(
      !r.output.includes("GADGET-GATE-RAN"),
      "an unchanged scope's gate must not run",
    );
  });
});

Deno.test("scope-gates: a gate fires for a NESTED path, not just a direct child of its scope dir", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-GATE-RAN", "echo GADGET-GATE-RAN"),
    );
    await gitInit(dir);
    // A change nested several levels under widget/, with widget/ present at the
    // repo root. The scope glob is "widget/**": if scopes lets the shell
    // pathname-expand it against the working tree, it collapses to the direct
    // child "widget/sub" and this deeper file matches nothing — silently skipping
    // the gate. The gate firing here is the guard that pattern matching stays
    // literal (i.e. set -f in scopes). Real source lives nested, so this
    // is the case that bit a Swift sub-app's gate in the field.
    await touch(dir, "widget/sub/deep/x.txt");

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "scope:widget");
    assertStringIncludes(r.stdout, "WIDGET-GATE-RAN");
    assert(
      !r.output.includes("GADGET-GATE-RAN"),
      "an unchanged scope's gate must not run",
    );
  });
});

Deno.test("scope-gates: no gate fires when only an unrelated path changed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-GATE-RAN", "echo GADGET-GATE-RAN"),
    );
    await gitInit(dir);
    await touch(dir, "src/app.txt"); // matches no gated scope (just "code")

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 0, r.output);
    assert(!r.output.includes("WIDGET-GATE-RAN"));
    assert(!r.output.includes("GADGET-GATE-RAN"));
  });
});

Deno.test("scope-gates: a failing gate fails finish and points at the gotchas", async () => {
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
    assertStringIncludes(r.stderr, "scope gates failed");
    // The shared gotchas pointer fires on a gated-phase failure.
    assertStringIncludes(r.stderr, "gate step failed");
  });
});

Deno.test("scope-gates: with fail_fast=false, all fired gates run even when one fails", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // fail_fast defaults ON in 1.0, so run-all is the explicit opt-out.
    await writeConfig(
      dir,
      sideGateConfig("echo WIDGET-OK", "echo GADGET-FAIL; exit 1") +
        "\n[gate]\nfail_fast = false\n",
    );
    await gitInit(dir);
    await touch(dir, "widget/x.txt");
    await touch(dir, "gadget/y.txt");

    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    // Both ran and both are reported — not aborted at the first failure.
    assertStringIncludes(r.stdout, "WIDGET-OK");
    assertStringIncludes(r.stdout, "GADGET-FAIL");
    assertStringIncludes(r.stdout, "scope:widget");
    assertStringIncludes(r.stdout, "scope:gadget");
  });
});
