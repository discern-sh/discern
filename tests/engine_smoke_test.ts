/**
 * Smoke tests for the engine-test harness itself: prove the scaffold-and-shell-
 * out path works and lock in the baseline behaviour of the core recipes
 * (`--help`, `done`, `doctor`, unknown-word) before feature tests build on
 * the same harness.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";

Deno.test("engine smoke: discern --help lists commands and exits 0", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["--help"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Commands:");
    assertStringIncludes(r.stdout, "done");
    // `accept` is promoted to a top-level command; the worktree group still
    // surfaces its colon-spelled sub-verbs in its description, so the top-level
    // help teaches both the promotion and the colon spelling.
    assertStringIncludes(r.stdout, "accept");
    assertStringIncludes(r.stdout, "worktree", "teardown");
  });
});

Deno.test("engine smoke: done on a fresh no-op gate passes and says so", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 0, r.output);
    // Every slot ships as a no-op, so the gate is honest about checking nothing.
    assertStringIncludes(r.stdout, "no-op");
  });
});

Deno.test("engine smoke: doctor passes with warnings on a fresh install", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["doctor"]);
    // Warnings (all-no-op gate) are advisories: doctor still exits 0.
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("engine smoke: an unknown word exits 1 and teaches the next step", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["definitely-not-a-recipe"]);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, 'unknown command "definitely-not-a-recipe"');
    assertStringIncludes(r.stderr, "discern help");
  });
});

Deno.test("engine smoke: the dispatcher finds the root from a subdirectory", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(`${dir}/src/deep`, { recursive: true });
    const r = await runAgent(dir, ["--help"], { cwd: `${dir}/src/deep` });
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Commands:");
  });
});
