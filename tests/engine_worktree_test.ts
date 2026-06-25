/**
 * Engine coverage for the isolated-worktree lifecycle — the repo's flagship
 * workflow, and (until now) its largest untested surface.
 *
 * These recipes run from git hooks, not `agent finish`, so the gate is otherwise
 * blind to them: a regression here would ship green. (The noglob break in
 * `guidelines` hid on exactly this path — the worktree-create hook runs it.)
 * Each test drives a REAL linked worktree in a hermetic git repo and shells out
 * to the dispatcher, so the bytes under test are what an install runs.
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
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

Deno.test("worktree setup: refreshes agent files and links skills inside the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "alpha");
    const r = await runAgent(wt, ["worktree"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );
    assert(
      await exists(join(wt, ".claude/skills/handoff-worktree/SKILL.md")),
      `bundled skills not linked in the worktree\n${r.output}`,
    );
    assertStringIncludes(r.output, "Worktree setup complete");
  });
});

Deno.test("worktree:ensure sets up once, then is a no-op", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "beta");
    const first = await runAgent(wt, ["worktree:ensure"]);
    assertEquals(first.code, 0, first.output);
    assertStringIncludes(first.output, "not configured yet");
    const second = await runAgent(wt, ["worktree:ensure"]);
    assertEquals(second.code, 0, second.output);
    assertEquals(
      second.output.includes("not configured yet"),
      false,
      `second ensure must be a silent no-op\n${second.output}`,
    );
  });
});

Deno.test("graduate: moves the branch into main and removes the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gamma");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `worktree should be removed\n${r.output}`,
    );
    // The branch is now checked out in main, so its commit's file is present there.
    assert(
      await exists(join(dir, "feature.txt")),
      `branch not graduated into main\n${r.output}`,
    );
    assertStringIncludes(r.output, "Graduation complete");
  });
});

Deno.test("graduate --to main: fast-forwards the trunk, lands on it, and deletes the merged branch", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "epsilon");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--to", "main"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `worktree should be removed\n${r.output}`,
    );
    // The work landed on the trunk itself, which is now checked out in main…
    assert(
      await exists(join(dir, "feature.txt")),
      `work not fast-forwarded onto the trunk\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `main checkout should be on the trunk, not the worktree branch\n${r.output}`,
    );
    // …and the now-merged worktree branch is gone.
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/epsilon"),
      "",
      `the merged branch should be deleted\n${r.output}`,
    );
    assertStringIncludes(r.output, "Graduation complete");
  });
});

Deno.test("graduate honours [worktree].graduate_to = main as the default destination", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "zeta");
    // Flip the project default to land on the trunk; the call passes no --to. Edit
    // the worktree's own checked-out config (graduate loads config from its root).
    const toml = join(wt, "discern.toml");
    await Deno.writeTextFile(
      toml,
      (await Deno.readTextFile(toml)).replace(
        'graduate_to = "branch"',
        'graduate_to = "main"',
      ),
    );
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `the configured default should land on the trunk\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/zeta"),
      "",
      `the configured default should delete the merged branch\n${r.output}`,
    );
  });
});

Deno.test("graduate refuses (non-destructively) when the main checkout is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "delta");
    // Dirty a tracked file in main: exit must refuse rather than clobber it.
    const toml = join(dir, "discern.toml");
    await Deno.writeTextFile(
      toml,
      `${await Deno.readTextFile(toml)}\n# dirty\n`,
    );

    const r = await runAgent(wt, ["graduate"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "uncommitted changes");
    assertEquals(
      await exists(wt),
      true,
      "worktree must be left intact on refusal",
    );
  });
});

Deno.test("worktree-name resolves the worktree identity (id + branch)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "epsilon");
    const id = await runAgent(wt, ["worktree-name", "--id"]);
    assertEquals(id.code, 0, id.output);
    assertStringIncludes(id.stdout, "epsilon");
    const branch = await runAgent(wt, ["worktree-name", "--branch"]);
    assertEquals(branch.code, 0, branch.output);
    assertStringIncludes(branch.stdout, "epsilon");
  });
});

Deno.test("worktree:teardown runs the (no-op) adapter seams cleanly", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "eta");
    const r = await runAgent(wt, ["worktree:teardown"]);
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("worktree:prune --yes reclaims a fully-merged worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "zeta");
    await Deno.writeTextFile(join(wt, "z.txt"), "z\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "z", "--no-gpg-sign");
    // Merge the branch into main so it is fully merged → prune may reclaim it.
    await git(dir, "merge", "--no-ff", "-m", "merge zeta", "agent/zeta");

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `fully-merged worktree should be pruned\n${r.output}`,
    );
  });
});

Deno.test("worktree:prune keeps a sibling worktree that still has unmerged work", async () => {
  await withTempDir(async (dir) => {
    const live = await mainWithWorktree(dir, "live");
    // The sibling carries an unmerged commit — pruning must preserve it and
    // never clobber live work in a child worktree.
    await Deno.writeTextFile(join(live, "wip.txt"), "wip\n");
    await git(live, "add", "-A");
    await git(live, "commit", "-q", "-m", "wip", "--no-gpg-sign");

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(live),
      true,
      `a live, unmerged worktree must NOT be pruned\n${r.output}`,
    );
  });
});
