/**
 * `discern worktree drop <id|path>` — the sanctioned removal for abandoned work.
 * Before this verb the only path was raw `rm -rf` + prune (`worktree prune`
 * deliberately keeps anything unmerged or dirty). Drop tears down resources,
 * removes the worktree, and deletes its branch — refusing anything a drop would
 * DISCARD (uncommitted changes, unmerged commits) unless `--force` consents.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
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

/** Whether the branch still exists in the repo at `dir`. */
async function branchExists(dir: string, branch: string): Promise<boolean> {
  return (await gitOut(dir, "branch", "--list", branch)) !== "";
}

Deno.test("worktree drop <id>: removes a clean, merged worktree and deletes its branch", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "abandoned");

    const r = await runAgent(dir, ["worktree", "drop", "abandoned"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, `worktree removed\n${r.output}`);
    assertEquals(
      await branchExists(dir, "agent/abandoned"),
      false,
      `branch deleted\n${r.output}`,
    );
    assertStringIncludes(r.output, "dropped");
  });
});

Deno.test("worktree drop <path>: resolves the target by path too", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "by-path");
    const r = await runAgent(dir, ["worktree", "drop", wt]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, r.output);
  });
});

Deno.test("worktree drop: a DISCERN_WORKTREE_ID in the environment cannot redirect the match", async () => {
  await withTempDir(async (dir) => {
    // Two worktrees; the caller's environment carries an id override naming the
    // SECOND. Matching resolves each row's OWN identity, so the override must
    // not make every row answer to 'foo-target' — the poisoned matcher deleted
    // whichever row it met first ('bar-bystander') with exit 0.
    const bystander = await mainWithWorktree(dir, "bar-bystander");
    const target = await addWorktree(dir, "foo-target");

    const r = await runAgent(dir, ["worktree", "drop", "foo-target"], {
      env: { DISCERN_WORKTREE_ID: "foo-target" },
    });
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(target),
      false,
      `the named worktree is dropped\n${r.output}`,
    );
    assert(
      await exists(bystander),
      `the bystander must survive an env-override drop\n${r.output}`,
    );
    assert(await branchExists(dir, "agent/bar-bystander"), r.output);
  });
});

Deno.test("worktree drop: refuses uncommitted changes without --force, discards with it", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "dirty-drop");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");

    const refused = await runAgent(dir, ["worktree", "drop", "dirty-drop"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "uncommitted change");
    assertStringIncludes(refused.output, "--force");
    assertEquals(await exists(wt), true, "a refusal must not remove anything");

    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "dirty-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await exists(wt), false, forced.output);
  });
});

Deno.test("worktree drop: refuses unmerged commits without --force, discards with it", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "unmerged-drop");
    await Deno.writeTextFile(join(wt, "real-work.txt"), "not landed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "unlanded work", "--no-gpg-sign");

    const refused = await runAgent(dir, ["worktree", "drop", "unmerged-drop"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "not on main");
    assertEquals(await exists(wt), true, "a refusal must not remove anything");
    assert(await branchExists(dir, "agent/unmerged-drop"));

    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "unmerged-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await exists(wt), false, forced.output);
    assertEquals(
      await branchExists(dir, "agent/unmerged-drop"),
      false,
      `the unmerged branch goes with the forced drop\n${forced.output}`,
    );
  });
});

Deno.test("worktree drop: tears down the worktree's recorded resources", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\nmain_branch = "main"\n\n' +
        "[worktree.resources.probe]\n" +
        'create = "true"\n' +
        `destroy = "touch ${dir}/destroyed.marker"\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "with-res");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    // Setup leaves generated scratch in the worktree; this test is about the
    // resource teardown, so consent to the discard explicitly.
    const r = await runAgent(dir, [
      "worktree",
      "drop",
      "with-res",
      "--force",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, "destroyed.marker")),
      `the resource destroy must run\n${r.output}`,
    );
    const result = JSON.parse(r.stdout) as {
      steps: { kind: string; label: string; outcome: string }[];
    };
    const destroy = result.steps.find((s) => s.kind === "resource-destroy");
    assertEquals(destroy?.outcome, "ok", r.stdout);
  });
});

Deno.test("worktree drop: refuses an unknown target, listing the known worktrees", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "the-only-one");
    const r = await runAgent(dir, ["worktree", "drop", "no-such-worktree"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "No worktree matches 'no-such-worktree'");
    assertStringIncludes(r.output, "the-only-one");
  });
});

Deno.test("worktree drop: refuses from inside a worktree (main-checkout-only)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "self-drop");
    const r = await runAgent(wt, ["worktree", "drop", "self-drop"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
    assertEquals(await exists(wt), true);
  });
});

Deno.test("worktree drop --dry-run: shows what a drop would discard and touches nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "preview-drop");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");

    const r = await runAgent(dir, [
      "worktree",
      "drop",
      "preview-drop",
      "--dry-run",
    ]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Drop plan");
    assertStringIncludes(r.output, "uncommitted change");
    assertEquals(await exists(wt), true, "a dry-run must not remove anything");
    assert(await branchExists(dir, "agent/preview-drop"));
  });
});
