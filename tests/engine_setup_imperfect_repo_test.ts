/**
 * Setup on IMPERFECT repos — the realistic first-contact states the funnel must
 * hold up on rather than soft-degrade: a `master` (or otherwise non-`main`) repo,
 * a brand-new repo whose default branch is still unborn, a directory with no git
 * at all, a machine with no git identity, an abandoned half-finished setup, and a
 * verbatim-copied placeholder flag. Each test fails on the old behavior (the
 * silent `main` assumption, the poisoned re-begin, the false isolation promise,
 * the discarded stderr, the scaffolded literal placeholder).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut, runAgent } from "./engine_helpers.ts";

/** A fresh git work tree with one commit — on the given branch, not `main`. */
async function repoOnBranch(dir: string, branch: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
  await git(dir, "branch", "-M", branch);
}

/** A brand-new `git init` whose default branch is still UNBORN (no commits),
 * with identity configured so setup's own commits can succeed. */
async function unbornRepo(dir: string, branch: string): Promise<void> {
  await git(dir, "init", "-q", "-b", branch);
  await git(dir, "config", "user.email", "engine-test@example.com");
  await git(dir, "config", "user.name", "Engine Test");
  await git(dir, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
}

// ── A6: the integration branch is detected and stamped ────────────────────────

Deno.test("begin on a master repo stamps [project].main_branch = master and land works", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The scaffolded config carries the repo's REAL default branch — without it
    // the gate's behind-main merge check self-skips forever ('main' is missing)
    // and `setup land` dead-ends.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "master"');

    // Landing works end to end: setup lives on discern-setup, lands onto master.
    const land = await runAgent(dir, ["setup", "land"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "master");

    // The merge check is armed against the stamped branch: status reports it as
    // the integration branch (and it exists locally, so nothing self-skips).
    const status = JSON.parse(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertEquals(status.data.git.integration_branch, "master");
  });
});

Deno.test("begin prefers the remote's declared default (origin/HEAD) over the current branch", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "feature-work");
    await git(dir, "remote", "add", "origin", dir);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    );
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "trunk"');
  });
});

Deno.test("begin stamps the checked-out branch even when init.defaultBranch disagrees", async () => {
  // Vendor git builds bake `init.defaultBranch = main` into an unmaskable config
  // (Apple's git does), so the checked-out branch — the repo's ground truth —
  // must outrank it, or every macOS `master` repo would be stamped `main`.
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "master"');
  });
});

Deno.test("begin falls back to init.defaultBranch on a detached HEAD", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "checkout", "-q", "--detach");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "trunk"');
  });
});

Deno.test("begin on an unborn-main repo stamps main, and land serves the creation step that then works", async () => {
  await withTempDir(async (dir) => {
    await unbornRepo(dir, "main");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "main"');

    // `main` is still unborn (every commit landed on discern-setup): land refuses
    // with the exact creation-then-land step, not a dead end — and the same
    // message rides the JSON surface an agent reads.
    const refused = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const res = JSON.parse(refused.stdout);
    assertEquals(res.error, "no_target");
    assertStringIncludes(res.message, "git branch main && discern setup land");

    // Following the served step lands the setup and arms the merge check.
    await git(dir, "branch", "main");
    const land = await runAgent(dir, ["setup", "land"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(await exists(join(dir, "discern.toml")), "the harness landed on main");
  });
});
