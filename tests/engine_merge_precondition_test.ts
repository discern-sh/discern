/**
 * A behind-trunk source without a declared composition environment stops before
 * expensive producers. The same current source runs normally. An eligible
 * released environment is exercised by the public prefix composition tests.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
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
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/**
 * A config with a single observable `test` capability — its echoed marker is the
 * tell for whether the expensive stage ran. Instructions/skills off so the only thing
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

Deno.test("done behind trunk without a composition environment stops before the capability", async () => {
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
    // The tree is unchanged, so the deliberate rerun is explicit.
    const json = await runAgent(wt, ["done", "--rerun", "--json"]);
    assertEquals(json.code, 1, json.output);
    const result = decodeCliResult(json.stdout, "done");
    assertHasHint(result, HINTS["completion-pending"], {
      action:
        "Make an eligible declared execution environment available, or run discern update to bring the source to the current trunk before running discern done.",
    });
    assertTerminalTextIncludes(r.output, "discern update");
  });
});

Deno.test("done --json behind trunk reports unavailable composition environment without running jobs", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeBehindMain(dir, "behindjson");

    const r = await runAgent(wt, ["done", "--json"]);

    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    assertEquals(obj.ok, false);
    assert(obj.data !== undefined && "failed_stage" in obj.data, r.stdout);
    assertEquals(obj.data.failed_stage, null);
    assertResultDataKey(obj, "completion");
    assert(
      obj.data.completion?.pending?.some((item) =>
        item.kind === "environment-unavailable"
      ),
    );
    assertEquals(obj.data.producer_executions, {});
    // No producer demand was installed before the environment refusal.
    assertEquals(obj.data.gate_ran, false);
    assert(
      (obj.steps ?? []).every((s: { outcome: string }) =>
        s.outcome === "skipped"
      ),
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

Deno.test("strict done and done --ci fail closed when local trunk is unreadable", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    await git(dir, "branch", "-m", "trunk");
    await git(
      dir,
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    );
    const wt = await addWorktree(dir, "missing-main");

    const human = await runAgent(wt, ["done"]);
    assertEquals(human.code, 1, human.output);
    assertTerminalTextIncludes(
      human.output,
      "trunk branch 'main' is not available locally",
    );
    assertStringIncludes(human.output, "[repository].trunk");
    assert(!human.output.includes(MARKER), human.output);
    assertTerminalTextIncludes(human.output, "git fetch origin main:main");

    const json = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(json.code, 1, json.output);
    const obj = decodeCliResult(json.stdout, "done");
    assertResultDataKey(obj, "failed_stage");
    assertEquals(obj.data?.failed_stage, "standards");
    const expected = assertHasHint(
      obj,
      HINTS["missing-trunk-branch"],
      { branch: "main" },
    );
    assertTerminalTextIncludes(human.output, expected);
  });
});
