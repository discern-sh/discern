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
import { basename, join } from "@std/path";
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
      await exists(join(wt, ".claude/skills/write-adr/SKILL.md")),
      `bundled skills not linked in the worktree\n${r.output}`,
    );
    assertStringIncludes(r.output, "Worktree setup complete");
  });
});

Deno.test("worktree lands in a sibling dir (never nested), and status + worktree-name work there", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "theta");

    // The checkout is a SIBLING of the repo — adjacent to it, never nested under
    // it (the nested-worktree anti-pattern this placement exists to avoid: a
    // recursive glob would otherwise double-count it, and a walk-up to the repo
    // root would mis-resolve the worktree's .git file).
    assert(
      !wt.startsWith(`${dir}/`),
      `worktree must not be nested inside the repo: ${wt}`,
    );
    assertStringIncludes(wt, `${basename(dir)}.worktrees`);

    // worktree-name resolves identity from the sibling checkout…
    const name = await runAgent(wt, ["worktree-name", "--id"]);
    assertEquals(name.code, 0, name.output);
    assertStringIncludes(name.stdout, "theta");

    // …and status from the main checkout surveys the sibling as a line of work.
    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const fleet = JSON.parse(status.stdout).data.fleet as Array<
      { branch: string }
    >;
    assert(
      fleet.some((row) => row.branch === "agent/theta"),
      `the sibling worktree should appear in the fleet: ${status.stdout}`,
    );
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

Deno.test("graduate --to trunk: fast-forwards the trunk, lands on it, and deletes the merged branch", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "epsilon");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--to", "trunk"]);
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

Deno.test("graduate honours [worktree].graduate_to = trunk as the default destination", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "zeta");
    // Flip the project default to land on the trunk; the call passes no --to. Edit
    // the worktree's own checked-out config (graduate loads config from its root).
    const toml = join(wt, "discern.toml");
    await Deno.writeTextFile(
      toml,
      (await Deno.readTextFile(toml)).replace(
        'graduate_to = "branch"',
        'graduate_to = "trunk"',
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

Deno.test("integrate: refuses from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "iota");
    // Run from the main checkout, not the worktree — integrate is worktree-only.
    const r = await runAgent(dir, ["integrate"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
  });
});

Deno.test("integrate: no-op when the branch already contains main", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "kappa");
    // main has not moved, so the branch is up to date — integrate touches nothing.
    const r = await runAgent(wt, ["integrate"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "up to date");
  });
});

Deno.test("integrate: behind main fast-forwards and re-materializes the agent files", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "lambda");
    // Advance main after the worktree branched off it → the branch is behind by one.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream work", "--no-gpg-sign");
    // Stale a generated agent file (gitignored, so the tree stays clean to merge into).
    await Deno.writeTextFile(
      join(wt, "CLAUDE.md"),
      "STALE — integrate must regenerate this\n",
    );

    const r = await runAgent(wt, ["integrate"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Fast-forwarded to main");
    assertStringIncludes(r.output, "Integration complete");
    // The merge brought main's commit in…
    assert(
      await exists(join(wt, "upstream.txt")),
      `main was not merged into the worktree\n${r.output}`,
    );
    // …and the stale generated file was re-materialized — the core value of bundling
    // the refresh into integrate (a bare `git merge` would leave it stale).
    const claude = await Deno.readTextFile(join(wt, "CLAUDE.md"));
    assertEquals(
      claude.includes("STALE"),
      false,
      `CLAUDE.md was not re-materialized\n${claude}`,
    );
    // Skills are (re)materialized into the worktree by the same refresh.
    assert(
      await exists(join(wt, ".claude/skills/write-adr/SKILL.md")),
      `skills not materialized by integrate\n${r.output}`,
    );
  });
});

Deno.test("integrate: refuses (non-destructively) when the worktree is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "mu");
    // Advance main so integrate would otherwise merge.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");
    // Leave an uncommitted change in the worktree.
    await Deno.writeTextFile(join(wt, "wip.txt"), "uncommitted\n");

    const r = await runAgent(wt, ["integrate"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Commit or stash");
    // The tree is untouched: the dirty file stays, and main was NOT merged in.
    assert(
      await exists(join(wt, "wip.txt")),
      "the dirty file must be left intact",
    );
    assertEquals(
      await exists(join(wt, "upstream.txt")),
      false,
      `main must not be merged into a dirty worktree\n${r.output}`,
    );
  });
});

Deno.test("integrate: a conflicting change is reported, and the merge is left aborted (clean tree)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "nu");
    // The worktree branch and main both add the same file with different content,
    // so merging main conflicts.
    await Deno.writeTextFile(join(wt, "shared.txt"), "worktree side\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "worktree edit", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "shared.txt"), "main side\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main edit", "--no-gpg-sign");

    const r = await runAgent(wt, ["integrate"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "conflicts");
    assertStringIncludes(r.output, "shared.txt");
    // The merge stepped aside cleanly — no half-merge stranded in the worktree.
    assertEquals(
      await gitOut(wt, "status", "--porcelain"),
      "",
      `integrate must abort the conflicting merge, leaving a clean tree\n${r.output}`,
    );
    // The worktree keeps its own commit (its side of shared.txt).
    assertEquals(
      await Deno.readTextFile(join(wt, "shared.txt")),
      "worktree side\n",
    );
  });
});

Deno.test("integrate --dry-run: previews the merge + refresh and touches nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "xi");
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const r = await runAgent(wt, ["integrate", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Integration plan");
    assertStringIncludes(r.output, "Behind by: 1");
    // The preview merged nothing — main's commit is still absent in the worktree.
    assertEquals(
      await exists(join(wt, "upstream.txt")),
      false,
      `--dry-run must not merge\n${r.output}`,
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
