/**
 * `discern setup land` coverage — the deterministic way to land a finished setup onto
 * the integration branch (A11), the main-checkout counterpart to `discern graduate`.
 *
 * A fresh `discern setup` isolates its commits on a `discern-setup` branch, so without
 * a landing path the work sits off `main` and a novice can appear to "lose" discern by
 * switching branches. These tests drive the real CLI through every landing outcome —
 * fast-forward, merge, the refusals (dirty tree, conflict, missing target), and the
 * no-ops (already landed, no repo) — asserting both the result envelope and the git
 * state it leaves behind.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Scaffold a bootstrapped project in a hermetic git repo, then branch to
 * `discern-setup` with one commit — the post-`setup done` shape `land` acts on. */
async function setupBranchRepo(dir: string): Promise<void> {
  await scaffoldEngine(dir); // bootstrapped by default
  await gitInit(dir); // commits the scaffold on `main`
  await git(dir, "checkout", "-b", "discern-setup");
  await Deno.writeTextFile(join(dir, "setup-work.txt"), "harness\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
}

/** True when `branch` no longer exists in the repo. */
async function branchGone(dir: string, branch: string): Promise<boolean> {
  const branches = (await gitOut(dir, "branch", "--format=%(refname:short)"))
    .split("\n").map((b) => b.trim());
  return !branches.includes(branch);
}

Deno.test("setup land fast-forwards the setup branch onto main and deletes it", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 0, res.output);
    const data = JSON.parse(res.stdout).data;
    assertEquals(data.landed, true);
    assertEquals(data.fast_forward, true);
    assertEquals(data.branch, "discern-setup");
    assertEquals(data.target, "main");
    assertEquals(data.branch_deleted, true);

    // Now on main, the merged branch is gone, and the setup work landed.
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(await branchGone(dir, "discern-setup"));
    assertEquals(
      await Deno.readTextFile(join(dir, "setup-work.txt")),
      "harness\n",
    );
  });
});

Deno.test("setup land merges when the integration branch has advanced", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    // main moves on after the branch point → no fast-forward is possible.
    await git(dir, "checkout", "main");
    await Deno.writeTextFile(join(dir, "main-work.txt"), "trunk\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main advanced", "--no-gpg-sign");
    await git(dir, "checkout", "discern-setup");

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 0, res.output);
    const data = JSON.parse(res.stdout).data;
    assertEquals(data.landed, true);
    assertEquals(data.fast_forward, false);
    assertEquals(data.branch_deleted, true);

    // Both lines of work are on main now.
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(await branchGone(dir, "discern-setup"));
    assert(await fileExists(join(dir, "setup-work.txt")));
    assert(await fileExists(join(dir, "main-work.txt")));
  });
});

Deno.test("setup land --dry-run previews the fast-forward and changes nothing", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "land", "--dry-run"]);
    assertEquals(res.code, 0, res.output);
    assert(res.stdout.includes("fast-forward main to discern-setup"));
    // Still on the setup branch; nothing landed, nothing deleted.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup land refuses a tree with uncommitted tracked changes", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "setup-work.txt"), "edited\n"); // tracked, dirty

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "dirty_worktree");
    // Untouched: still on the branch, nothing landed.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup land ignores untracked scratch files (lands anyway)", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "scratch.tmp"), "noise\n"); // untracked

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 0, res.output);
    assertEquals(JSON.parse(res.stdout).data.landed, true);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
  });
});

Deno.test("setup land is a clean no-op when already on the integration branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir); // stays on `main`

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 0, res.output);
    const obj = JSON.parse(res.stdout);
    assertEquals(obj.ok, true);
    assert(obj.data === undefined, "a no-op carries no landing data");
  });
});

Deno.test("setup land refuses when the integration branch does not exist", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Init on a non-default branch so `main` is absent.
    await git(dir, "init", "-q", "-b", "trunk");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    await git(dir, "config", "commit.gpgsign", "false");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "init", "--no-gpg-sign");
    await git(dir, "checkout", "-b", "discern-setup");

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "no_target");
  });
});

Deno.test("setup land conflicting changes are refused and stepped aside, leaving the branch intact", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir); // discern-setup edits setup-work.txt's successor below
    // Make BOTH branches change the same file divergently → a merge conflict.
    await git(dir, "checkout", "discern-setup");
    await Deno.writeTextFile(join(dir, "contested.txt"), "from setup\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "setup edits contested",
      "--no-gpg-sign",
    );
    await git(dir, "checkout", "main");
    await Deno.writeTextFile(join(dir, "contested.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "main edits contested",
      "--no-gpg-sign",
    );
    await git(dir, "checkout", "discern-setup");

    const res = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "conflict");
    // The conflict was aborted: back on the setup branch, branch intact, tree clean.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
  });
});

/** True when `path` exists. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
