/**
 * Engine coverage for the gate's merge precondition (ADR 0050): `finish` checks
 * that the branch contains the latest `main` FIRST and fail-fast, so a branch
 * behind `main` is rejected *before* the expensive fix/build/check/test run — the
 * work the forced re-integration would discard anyway. The regression guard for
 * the ordering: were the check to slip back to the end, the capability would run
 * (its marker would print, its step would be `ok`) and these tests would fail.
 *
 * Each test drives a REAL linked worktree behind a moved `main`, shelling out to
 * the dispatcher so the bytes under test are what an install runs.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/**
 * A config with a single observable `test` capability — its echoed marker is the
 * tell for whether the expensive stage ran. Guidance/skills off so the only thing
 * standing between the merge check and a green gate is that one capability.
 */
const MARKER = "RAN-THE-CAPABILITY";
const CONFIG = [
  "[project]",
  'slug = "engine-test"',
  'main_branch = "main"',
  "",
  "[features]",
  "guidance = false",
  "skills = false",
  "",
  "[capabilities]",
  `test = "echo ${MARKER}"`,
  "",
].join("\n");

/**
 * A scaffolded main repo carrying {@link CONFIG}, with one linked worktree, where
 * `main` has since moved one commit ahead of the worktree's branch. Returns the
 * worktree path — ready to drive a behind-`main` `finish`.
 */
async function worktreeBehindMain(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG);
  await gitInit(dir);
  const wt = await addWorktree(dir, name);
  // Advance `main` in the main checkout after the worktree branched off it, so the
  // worktree's `agent/<name>` is now one commit behind `main`.
  await Deno.writeTextFile(join(dir, "main-moved.txt"), "main advanced\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");
  return wt;
}

Deno.test("finish fails fast on the merge precondition when behind main — the capability never runs", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeBehindMain(dir, "behind");

    const r = await runAgent(wt, ["finish"]);

    assertEquals(r.code, 1, r.output);
    // The fail-fast precondition skipped the stages: the capability's marker is
    // absent. (Were the merge check last, the capability would have run first.)
    assert(
      !r.output.includes(MARKER),
      `the capability must not run when behind main\n${r.output}`,
    );
    // ...and the human tail names the remedy: the deterministic `discern integrate`
    // verb (which brings main in and re-materializes), not a bare `git merge`.
    assertStringIncludes(r.output, "discern integrate");
  });
});

Deno.test("finish --json behind main: failed_stage is merge and every step is skipped", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeBehindMain(dir, "behindjson");

    const r = await runAgent(wt, ["finish", "--json"]);

    assertEquals(r.code, 1, r.output);
    const obj = JSON.parse(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "merge");
    // Nothing downstream ran: the planned capability is serialized, but skipped.
    assert(obj.steps.length >= 1, `expected planned steps\n${r.stdout}`);
    assert(
      obj.steps.every((s: { outcome: string }) => s.outcome === "skipped"),
      `every step must be skipped when the merge precondition fails first\n${r.stdout}`,
    );
  });
});

Deno.test("finish up to date: the merge precondition passes and the capability runs", async () => {
  await withTempDir(async (dir) => {
    // The positive control: same config + worktree, but `main` has NOT moved, so
    // the precondition is a no-op and the gate proceeds to run the capability.
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "current");

    const r = await runAgent(wt, ["finish"]);

    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, MARKER);
  });
});
