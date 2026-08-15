/**
 * Engine coverage for the gate's merge precondition (ADR 0050): `done` checks
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
import { GATE_FAILURE_REMEDIES, HINTS } from "../src/shared/hints.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
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
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  `test = "echo ${MARKER}"`,
  "",
].join("\n");

/**
 * A scaffolded main repo carrying {@link CONFIG}, with one linked worktree, where
 * `main` has since moved one commit ahead of the worktree's branch. Returns the
 * worktree path — ready to drive a behind-`main` `done`.
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

Deno.test("done fails fast on the merge precondition when behind main — the capability never runs", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeBehindMain(dir, "behind");

    const r = await runAgent(wt, ["done"]);

    assertEquals(r.code, 1, r.output);
    // The fail-fast precondition skipped the stages: the capability's marker is
    // absent. (Were the merge check last, the capability would have run first.)
    assert(
      !r.output.includes(MARKER),
      `the capability must not run when behind main\n${r.output}`,
    );
    // ...and the human tail names the remedy: the deterministic `discern update`
    // verb (which brings main in and re-materializes), not a bare `git merge`.
    // The tree is unchanged, so the deliberate rerun carries the attestation.
    const json = await runAgent(wt, ["done", "--confirmed", "--json"]);
    assertEquals(json.code, 1, json.output);
    const expected = assertHasHint(
      JSON.parse(json.stdout),
      GATE_FAILURE_REMEDIES.merge,
    );
    assertTerminalTextIncludes(r.output, expected);
  });
});

Deno.test("done --json behind main: failed_stage is merge and every step is skipped", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeBehindMain(dir, "behindjson");

    const r = await runAgent(wt, ["done", "--json"]);

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

Deno.test("done up to date: the merge precondition passes and the capability runs", async () => {
  await withTempDir(async (dir) => {
    // The positive control: same config + worktree, but `main` has NOT moved, so
    // the precondition is a no-op and the gate proceeds to run the capability.
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "current");

    const r = await runAgent(wt, ["done"]);

    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, MARKER);
  });
});

Deno.test("done warns when the configured trunk is missing locally", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    await git(dir, "branch", "-m", "trunk");
    const wt = await addWorktree(dir, "missing-main");

    const human = await runAgent(wt, ["done"]);
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(
      human.output,
      "trunk branch 'main' is not available locally",
    );
    assertStringIncludes(human.output, "[repository].trunk");
    assertStringIncludes(human.output, MARKER);

    // The tree is unchanged, so the deliberate rerun carries the attestation.
    const json = await runAgent(wt, ["done", "--confirmed", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = JSON.parse(json.stdout);
    const expected = assertHasHint(
      obj,
      HINTS["missing-trunk-branch"],
      { branch: "main" },
    );
    assertTerminalTextIncludes(human.output, expected);
  });
});
