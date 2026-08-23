/**
 * `discern setup accept` coverage — the deterministic way to land a finished setup onto
 * the integration branch (A11), the main-checkout counterpart to `discern accept`.
 *
 * A fresh `discern setup` isolates its commits on a `discern-setup` branch, so without
 * a landing path the work sits off `main` and a novice can appear to "lose" discern by
 * switching branches. These tests drive the real CLI through every landing outcome —
 * fast-forward, merge, the refusals (dirty tree, conflict, missing target), and the
 * no-ops (already landed, no repo) — asserting both the result envelope and the git
 * state it leaves behind.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { ACCEPT_COMMAND_REF } from "../src/commands/setup_accept.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";

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

Deno.test("setup accept fast-forwards the setup branch onto main and deletes it", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    const result = JSON.parse(res.stdout);
    assertEquals(result.message, "Setup landed onto main.");
    const data = result.data;
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

Deno.test("setup accept merges when the integration branch has advanced", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    // main moves on after the branch point → no fast-forward is possible.
    await git(dir, "checkout", "main");
    await Deno.writeTextFile(join(dir, "main-work.txt"), "trunk\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main advanced", "--no-gpg-sign");
    await git(dir, "checkout", "discern-setup");
    await git(dir, "config", "merge.ff", "only");
    await git(dir, "config", "branch.main.mergeOptions", "--ff-only");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
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

Deno.test("setup accept --dry-run previews the fast-forward and changes nothing", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "accept", "--dry-run"]);
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

Deno.test("setup accept refuses a tree with uncommitted tracked changes", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "setup-work.txt"), "edited\n"); // tracked, dirty

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
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

Deno.test("setup accept refuses every tracked mutation made after Proof", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    const proved = await runAgent(dir, ["done", "--json"]);
    assertEquals(proved.code, 0, proved.output);
    const provedHead = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(JSON.parse(proved.stdout).data.proof.head, provedHead.slice(0, 12));

    // An unrelated future sibling of the observed marker mutation: the
    // acceptance invariant is about every post-Proof tree change, regardless
    // of the file or feature that produced it.
    await Deno.writeTextFile(join(dir, "unrelated-after-proof.txt"), "later\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "mutate after proof",
      "--no-gpg-sign",
    );
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const accepted = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    assertStringIncludes(
      JSON.parse(accepted.stdout).message,
      "run `discern setup done`, then retry",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup accept ignores untracked scratch files (lands anyway)", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "scratch.tmp"), "noise\n"); // untracked

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    assertEquals(JSON.parse(res.stdout).data.landed, true);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
  });
});

Deno.test("setup accept is a clean no-op when already on the integration branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir); // stays on `main`

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    const obj = JSON.parse(res.stdout);
    assertEquals(obj.ok, true);
    assert(obj.data === undefined, "a no-op carries no landing data");
  });
});

Deno.test("setup accept refuses to land a branch that is not the setup branch", async () => {
  // `setup accept` fast-forwards (or merges) the CURRENT branch onto the
  // integration branch — run from an ordinary feature branch it would sweep
  // that branch's own commits onto `main` with no review. It must only land
  // the `discern-setup` branch; any other branch is merged by hand.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir); // commits the scaffold on `main`
    await git(dir, "checkout", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "not_setup_branch");

    // main untouched, still on the feature branch, its commits intact.
    assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "feature-x");
  });
});

Deno.test("setup done steers a non-setup branch to a manual merge, never `setup accept`", async () => {
  // An --allow-dirty setup lives in place on the user's own branch. `setup
  // done` must not recommend `discern setup accept` there — the command lands
  // whatever branch it is run from, and this one carries the user's own
  // commits. Every recommendation surface (the JSON hints, the relay
  // instructions, the landing data) derives from the one landingSummary field,
  // so this drives the full envelope.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits on `main`
    // A remote default branch so detection stamps `main` even from feature-x.
    const sha = await gitOut(dir, "rev-parse", "main");
    await git(dir, "update-ref", "refs/remotes/origin/main", sha);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    await git(dir, "checkout", "-q", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");

    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--allow-dirty",
      "--agents",
      "claude_code",
      "--json",
    ]);
    assertEquals(begin.code, 0, begin.output);

    const done = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(done.code, 0, done.output);
    const obj = JSON.parse(done.stdout);
    assertEquals(obj.data.landing.branch, "feature-x");
    assertEquals(obj.data.landing.on_setup_branch, false);
    assertLacksHint(obj, HINTS["setup-done-land-dedicated"], {
      branch: "feature-x",
      target: "main",
      acceptCommand: ACCEPT_COMMAND_REF,
    });
    assertHasHint(obj, HINTS["setup-done-land-manually"], {
      branch: "feature-x",
      target: "main",
      acceptCommand: ACCEPT_COMMAND_REF,
      setupBranch: "discern-setup",
    });
    assertStringIncludes(
      obj.data.instructions,
      "usual way",
      "the relay message steers to a manual merge for a non-setup branch",
    );
    assert(
      !obj.data.instructions.includes(
        "landing it now with `discern setup accept`",
      ),
      `the relay message must not recommend setup accept here:\n${obj.data.instructions}`,
    );
  });
});

Deno.test("setup accept refuses when the integration branch does not exist", async () => {
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

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "no_target");
  });
});

Deno.test("setup accept conflicting changes are refused and stepped aside, leaving the branch intact", async () => {
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

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
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
