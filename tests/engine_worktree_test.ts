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
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

Deno.test("worktree setup: compiles guidelines and links skills inside the worktree", async () => {
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

Deno.test("worktree:exit graduates the branch into main and removes the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gamma");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["worktree:exit"]);
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

Deno.test("worktree:exit refuses (non-destructively) when the main checkout is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "delta");
    // Dirty a tracked file in main: exit must refuse rather than clobber it.
    const toml = join(dir, "icculus.toml");
    await Deno.writeTextFile(
      toml,
      `${await Deno.readTextFile(toml)}\n# dirty\n`,
    );

    const r = await runAgent(wt, ["worktree:exit"]);
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
