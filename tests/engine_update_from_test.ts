/**
 * `update --from <ref>` — the pull axis of the landing model. A worktree may
 * pull ANY ref into itself (composing work below the trunk); a bare `update`
 * still targets the trunk; a conflicting `--from` aborts to a clean tree; and a
 * no-op re-run (nothing to merge) still re-converges the worktree — the recovery
 * path the conflict refusal names.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { HINTS } from "../src/shared/hints.ts";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Commit a file on a new branch off main in the MAIN checkout, then return to main. */
async function commitOnBranch(
  dir: string,
  branch: string,
  file: string,
  content: string,
): Promise<void> {
  await git(dir, "switch", "-q", "-c", branch);
  await Deno.writeTextFile(join(dir, file), content);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `work on ${branch}`, "--no-gpg-sign");
  await git(dir, "switch", "-q", "main");
}

Deno.test("update --from <branch>: that branch's commits arrive in the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "pull-target");
    await commitOnBranch(dir, "phase-one", "phase-one.txt", "prototype\n");

    const r = await runAgent(wt, [
      "update",
      "--json",
      "--from",
      "phase-one",
    ]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "phase-one.txt")),
      `the named ref's commits must arrive\n${r.output}`,
    );
    const result = JSON.parse(r.stdout) as {
      data?: { range: { main: string } };
      hints?: string[];
    };
    // The change summary is computed against the resolved ref: `range.main` is the
    // incoming tip — here, phase-one's tip, not the trunk's.
    assertEquals(
      result.data?.range.main,
      await gitOut(dir, "rev-parse", "phase-one"),
      `range.main must anchor the incoming ref's tip\n${r.stdout}`,
    );
    assertHasHint(result, HINTS["update-no-overlap"], {
      source: "phase-one",
      predicted: false,
      filesRange: undefined,
      commitsRange: undefined,
    });
  });
});

Deno.test("update (bare): still targets the trunk, not any other ref", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "trunk-pull");
    // Advance the trunk AND park a decoy branch with different content.
    await commitOnBranch(dir, "decoy", "decoy.txt", "not this\n");
    await Deno.writeTextFile(join(dir, "trunk.txt"), "trunk advance\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance trunk", "--no-gpg-sign");

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "trunk.txt")),
      `the trunk's commits must arrive\n${r.output}`,
    );
    assertEquals(
      await exists(join(wt, "decoy.txt")),
      false,
      `a bare update must not pull any other ref\n${r.output}`,
    );
  });
});

Deno.test("update --from: a conflicting ref aborts to a clean tree and names the recovery", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "conflict-pull");
    // Both sides edit the same file: the source branch in main, and the worktree.
    await commitOnBranch(dir, "clashing", "clash.txt", "source version\n");
    await Deno.writeTextFile(join(wt, "clash.txt"), "worktree version\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "worktree edit", "--no-gpg-sign");

    const r = await runAgent(wt, ["update", "--json", "--from", "clashing"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout) as { message: string };
    assertStringIncludes(result.message, "clash.txt");
    // The recovery converges: re-run update (with the same --from), not finish.
    assertStringIncludes(
      result.message,
      "re-run `discern update --from clashing`",
    );
    // The merge was aborted: clean tree, no MERGE_HEAD, worktree content intact.
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
    assertEquals(
      await Deno.readTextFile(join(wt, "clash.txt")),
      "worktree version\n",
    );
  });
});

Deno.test("update --from: a non-conflict merge failure surfaces git's real reason, not a fake conflict", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "unrelated-pull");
    // An orphan branch shares no history with main: `git merge` refuses outright
    // ("refusing to merge unrelated histories") — no conflicted files, no
    // MERGE_HEAD. Reporting that as a conflict buries the actual cause.
    await git(dir, "checkout", "-q", "--orphan", "island");
    await git(dir, "rm", "-rfq", ".");
    await Deno.writeTextFile(join(dir, "island.txt"), "elsewhere\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "island", "--no-gpg-sign");
    await git(dir, "switch", "-q", "main");

    const r = await runAgent(wt, ["update", "--json", "--from", "island"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout) as { error: string; message: string };
    assertEquals(result.error, "precondition_failed");
    // The message is the failure taxonomy's, carrying git's own reason — not the
    // conflict refusal (whose "merge was aborted" would be false here).
    assertStringIncludes(result.message, "failed before any merge began");
    assertStringIncludes(result.message, "Git refused:");
    assert(
      !result.message.includes("The merge was aborted"),
      `a non-conflict failure must not claim an aborted merge\n${result.message}`,
    );
    // The tree really is untouched.
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
  });
});

Deno.test("update --from refuses an unknown ref in plain language", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "unknown-pull");
    const r = await runAgent(wt, ["update", "--json", "--from", "nope"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout) as { error: string; message: string };
    assertEquals(result.error, "precondition_failed");
    assertStringIncludes(result.message, "Unknown ref 'nope'");
  });
});

Deno.test("a no-op update still re-converges: refresh + ensure run with nothing to merge", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
        '[worktree.setup]\nensure = ["touch converged.marker"]\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "noop-converge");
    // Up to date with main — nothing to merge. The convergence must still run.
    await Deno.remove(join(wt, "converged.marker")).catch(() => {});
    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "converged.marker")),
      `ensure must re-run on a no-op update\n${r.output}`,
    );
    const result = JSON.parse(r.stdout) as {
      steps: { label: string; outcome: string }[];
    };
    const merge = result.steps.find((s) => s.label === "merge");
    assertEquals(merge?.outcome, "skipped", r.stdout);
    const refresh = result.steps.find((s) =>
      s.label === BUILT_IN_STEP_LABELS.completeRefresh
    );
    assertEquals(refresh?.outcome, "ok", r.stdout);
  });
});
