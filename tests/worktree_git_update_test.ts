/**
 * updateMain's generated-conflict auto-resolution and removeWorktreeSafely's
 * narrow-target guards. A conflict confined to caller-declared generator-owned
 * paths resolves mechanically to the incoming side (a deletion included) and
 * completes the merge; any authored conflict aborts and restores the tree.
 * Worktree removal refuses broad or wrong targets before touching anything.
 */

import { join } from "@std/path";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  removeWorktreeSafely,
  updateMain,
  WorktreeGitError,
} from "../src/engine/worktree/git.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { addWorktree, git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** A repo whose trunk and a linked worktree both revise the same files. */
async function divergedFixture(
  dir: string,
  files: Record<string, { base: string; trunk?: string; local: string }>,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, name), content.base);
  }
  await gitInit(dir);
  const wt = await addWorktree(dir, "update");
  for (const [name, content] of Object.entries(files)) {
    if (content.trunk === undefined) {
      await git(dir, "rm", "-q", name);
    } else {
      await Deno.writeTextFile(join(dir, name), content.trunk);
    }
    await Deno.writeTextFile(join(wt, name), content.local);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "trunk revision", "--no-gpg-sign");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "local revision", "--no-gpg-sign");
  return wt;
}

/** The home directory exactly as the removal guard's default reads it. */
function homePath(
  home: string | undefined = Deno.env.get("HOME"),
): string | undefined {
  return home === undefined || home === "" ? undefined : home;
}

/** Whether the worktree still has a merge parked mid-flight. */
async function midMerge(wt: string): Promise<boolean> {
  try {
    await git(wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

Deno.test("a conflict confined to generator-owned paths resolves to the incoming side and completes the merge", async () => {
  await withTempDir(async (dir) => {
    const wt = await divergedFixture(dir, {
      "gen.txt": {
        base: "base\n",
        trunk: "trunk regeneration\n",
        local: "local regeneration\n",
      },
    });
    const outcome = await updateMain(wt, "main", {
      autoResolvable: (path) => path === "gen.txt",
    });
    assert(outcome.kind === "updated", JSON.stringify(outcome));
    assertEquals(outcome.autoResolved, ["gen.txt"]);
    assertEquals(outcome.behind, 1);
    assertEquals(
      await Deno.readTextFile(join(wt, "gen.txt")),
      "trunk regeneration\n",
    );
    assertEquals(await midMerge(wt), false, "the merge completed");
    // The completed integration is a true merge commit of both sides.
    assertEquals(
      await gitOut(wt, "rev-parse", "HEAD^2"),
      await gitOut(dir, "rev-parse", "main"),
    );
  });
});

Deno.test("an incoming deletion of a generator-owned path resolves by removing it", async () => {
  await withTempDir(async (dir) => {
    const wt = await divergedFixture(dir, {
      "gen.txt": { base: "base\n", local: "local regeneration\n" },
      "keep.txt": { base: "kept\n", trunk: "kept\n", local: "kept\n" },
    });
    const outcome = await updateMain(wt, "main", {
      autoResolvable: (path) => path === "gen.txt",
    });
    assert(outcome.kind === "updated", JSON.stringify(outcome));
    assertEquals(outcome.autoResolved, ["gen.txt"]);
    assertEquals(await targetExists(join(wt, "gen.txt")), false);
    assertEquals(await midMerge(wt), false);
  });
});

Deno.test("an authored conflict aborts the merge and restores the tree, naming the resolvable subset", async () => {
  await withTempDir(async (dir) => {
    const wt = await divergedFixture(dir, {
      "gen.txt": {
        base: "base\n",
        trunk: "trunk regeneration\n",
        local: "local regeneration\n",
      },
      "notes.txt": {
        base: "base notes\n",
        trunk: "trunk notes\n",
        local: "local notes\n",
      },
    });
    const before = await gitOut(wt, "rev-parse", "HEAD");
    const outcome = await updateMain(wt, "main", {
      autoResolvable: (path) => path === "gen.txt",
    });
    assert(outcome.kind === "conflict", JSON.stringify(outcome));
    assertEquals(outcome.files.toSorted(), ["gen.txt", "notes.txt"]);
    assertEquals(outcome.resolvable, ["gen.txt"]);
    assertEquals(outcome.aborted, true);
    assertEquals(await gitOut(wt, "rev-parse", "HEAD"), before);
    assertEquals(
      await Deno.readTextFile(join(wt, "notes.txt")),
      "local notes\n",
    );
    assertEquals(await midMerge(wt), false, "the abort restored the tree");
  });
});

Deno.test("a merge git refuses outright reports git's own reason, and a missing source branch is a no-op", async () => {
  await withTempDir(async (dir) => {
    const wt = await divergedFixture(dir, {
      "gen.txt": { base: "base\n", trunk: "trunk\n", local: "local\n" },
    });
    // An unrelated history: a rootless commit over the empty tree.
    const tree = await gitOut(dir, "hash-object", "-t", "tree", "/dev/null");
    const stray = await gitOut(dir, "commit-tree", tree, "-m", "stray");
    await git(dir, "branch", "stray", stray);
    const refused = await updateMain(wt, "main", { from: "stray" });
    assert(refused.kind === "merge_failed", JSON.stringify(refused));
    assert(refused.reason.length > 0);
    assertEquals(await midMerge(wt), false);

    // No local branch by the fallback name: nothing to update into.
    assertEquals((await updateMain(wt, "nosuchmain")).kind, "skipped");
    // The main checkout itself is never updated this way.
    assertEquals((await updateMain(dir, "main")).kind, "skipped");
  });
});

Deno.test("worktree removal refuses broad or wrong targets before touching anything", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const wt = await addWorktree(dir, "victim");

    await assertRejects(
      () => removeWorktreeSafely("/", dir),
      WorktreeGitError,
      "Worktree removal refused the filesystem root '/'.",
    );
    const home = homePath();
    if (home !== undefined) {
      const realHome = await Deno.realPath(home);
      await assertRejects(
        () => removeWorktreeSafely(realHome, dir),
        WorktreeGitError,
        "Worktree removal refused the home directory",
      );
    }
    const realDir = await Deno.realPath(dir);
    await assertRejects(
      () => removeWorktreeSafely(join(realDir, ".."), dir),
      WorktreeGitError,
      "because it contains the main checkout",
    );
    await assertRejects(
      () => removeWorktreeSafely(join(realDir, ".git"), dir),
      WorktreeGitError,
      "because it overlaps this repository's Git metadata.",
    );
    await assertRejects(
      () => removeWorktreeSafely(realDir, dir),
      WorktreeGitError,
      "because it contains the main checkout",
    );
    const link = join(dir, "link-to-worktree");
    await Deno.symlink(wt, link);
    await assertRejects(
      () => removeWorktreeSafely(link, dir),
      WorktreeGitError,
      "is a symlink, so discern left it",
    );
    // Every refusal above left the real worktree untouched.
    assert(await targetExists(join(wt, "seed.txt")));

    await withTempDir(async (outside) => {
      await assertRejects(
        () => removeWorktreeSafely(join(outside, "x"), outside),
        WorktreeGitError,
        "Worktree removal needs a Git repository, but this directory is outside one.",
      );
    });
  });
});
