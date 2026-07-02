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
  worktreePath,
  writeExecutable,
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

async function leaveTrackedAndUntrackedWip(wt: string): Promise<void> {
  await Deno.writeTextFile(join(wt, "tracked.txt"), "committed\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "add tracked file", "--no-gpg-sign");

  await Deno.writeTextFile(join(wt, "tracked.txt"), "tracked wip\n");
  await Deno.writeTextFile(join(wt, "untracked.txt"), "untracked wip\n");
}

async function assertWipLandedStaged(
  dir: string,
  wt: string,
  output: string,
): Promise<void> {
  assertEquals(
    await exists(wt),
    false,
    `worktree should be removed after preserving WIP\n${output}`,
  );
  assertEquals(
    await Deno.readTextFile(join(dir, "tracked.txt")),
    "tracked wip\n",
  );
  assertEquals(
    await Deno.readTextFile(join(dir, "untracked.txt")),
    "untracked wip\n",
  );
  const status = await gitOut(dir, "status", "--porcelain");
  assertStringIncludes(
    status,
    "M  tracked.txt",
    `tracked WIP must land staged\n${status}\n${output}`,
  );
  assertStringIncludes(
    status,
    "A  untracked.txt",
    `untracked WIP must land staged\n${status}\n${output}`,
  );
  assertEquals(
    status.includes("??"),
    false,
    `WIP must be staged, not left untracked\n${status}\n${output}`,
  );
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
      await exists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
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

for (const to of ["branch", "trunk"] as const) {
  Deno.test(`graduate --to ${to}: preserves tracked and untracked WIP as staged main changes`, async () => {
    await withTempDir(async (dir) => {
      const name = `dirty-${to}`;
      const wt = await mainWithWorktree(dir, name);
      await leaveTrackedAndUntrackedWip(wt);

      const r = await runAgent(wt, ["graduate", "--to", to]);
      assertEquals(r.code, 0, r.output);
      await assertWipLandedStaged(dir, wt, r.output);

      assertEquals(
        await gitOut(dir, "branch", "--show-current"),
        to === "trunk" ? "main" : `agent/${name}`,
        `main checkout should land on the requested destination\n${r.output}`,
      );
      if (to === "trunk") {
        assertEquals(
          await gitOut(dir, "branch", "--list", `agent/${name}`),
          "",
          `the merged branch should be deleted before the WIP soft reset\n${r.output}`,
        );
      }
    });
  });
}

Deno.test("graduate: reports a failed WIP soft reset and names where the WIP commit remains", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "reset-fail");
    await leaveTrackedAndUntrackedWip(wt);

    const tools = await Deno.makeTempDir({ prefix: "discern-reset-stub-" });
    try {
      const gitStub = join(tools, "git");
      await writeExecutable(
        gitStub,
        [
          "#!/usr/bin/env sh",
          'if [ "$1" = "reset" ] && [ "$2" = "--soft" ] && [ "$3" = "HEAD~1" ]; then',
          '  echo "simulated reset failure" >&2',
          "  exit 42",
          "fi",
          'exec git "$@"',
          "",
        ].join("\n"),
      );

      const r = await runAgent(wt, ["graduate", "--to", "branch"], {
        env: { GIT_BIN: gitStub },
      });
      assertEquals(r.code, 1, r.output);
      assertStringIncludes(r.output, "reset --soft HEAD~1 failed");
      assertStringIncludes(
        r.output,
        "WIP commit remains at HEAD of agent/reset-fail",
      );
      assertStringIncludes(r.output, dir);
      assertEquals(
        await gitOut(dir, "branch", "--show-current"),
        "agent/reset-fail",
        `main checkout should still be on the branch holding the WIP commit\n${r.output}`,
      );
      assertEquals(
        await gitOut(dir, "log", "-1", "--format=%s"),
        "WIP: graduate worktree (uncommitted changes)",
        `the WIP commit should remain recoverable at HEAD\n${r.output}`,
      );
      assertEquals(
        await exists(wt),
        false,
        "the reset failure happens after the worktree has been migrated",
      );
    } finally {
      await Deno.remove(tools, { recursive: true });
    }
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

Deno.test("graduate: refuses a branch behind main before WIP commit or removal", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "behind");
    await leaveTrackedAndUntrackedWip(wt);
    const branchHead = await gitOut(dir, "rev-parse", "agent/behind");

    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Branch is behind main");
    assertStringIncludes(r.output, "discern integrate");
    assert(
      await exists(wt),
      `behind-main refusal must leave the worktree intact\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "agent/behind"),
      branchHead,
      `behind-main refusal must not create a WIP commit or move the branch\n${r.output}`,
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "tracked.txt")),
      "tracked wip\n",
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "untracked.txt")),
      "untracked wip\n",
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

Deno.test("graduate: refuses from the main checkout (worktree-only, the CLI mirror of hiding)", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "iota2");
    // The CLI can't pre-hide per location (it runs at the user's cwd), so its
    // equivalent of the MCP hiding graduate from a main-rooted server is a clean
    // refusal: run from the main checkout, graduate has no current worktree to move.
    const r = await runAgent(dir, ["graduate"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "not a worktree");
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
      await exists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
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

Deno.test("integrate end-to-end: a behind finish points at integrate, which then unblocks a passing finish", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "omicron");
    // Advance main → the worktree branch is behind by one.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");

    // 1. finish fails fast on the merge check and names the remedy — the verb, not a
    //    bare `git merge` (the rest of the gate never runs).
    const behind = await runAgent(wt, ["finish"]);
    assertEquals(behind.code, 1, behind.output);
    assertStringIncludes(behind.output, "discern integrate");

    // 2. integrate brings main in AND re-materializes in one step.
    const integ = await runAgent(wt, ["integrate"]);
    assertEquals(integ.code, 0, integ.output);
    assert(
      await exists(join(wt, "upstream.txt")),
      `integrate did not merge main\n${integ.output}`,
    );

    // 3. finish now passes against the merged, re-materialized tree — with no
    //    intervening `discern refresh` (the bundled refresh already made it current).
    const after = await runAgent(wt, ["finish"]);
    assertEquals(after.code, 0, after.output);
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

Deno.test("worktree:prune --yes keeps a fully-merged worktree with uncommitted changes", async () => {
  await withTempDir(async (dir) => {
    const dirty = await mainWithWorktree(dir, "dirty-merged");
    await Deno.writeTextFile(join(dirty, "tracked.txt"), "merged\n");
    await git(dirty, "add", "-A");
    await git(dirty, "commit", "-q", "-m", "merged work", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge dirty",
      "agent/dirty-merged",
    );

    await Deno.writeTextFile(join(dirty, "tracked.txt"), "dirty tracked\n");
    await Deno.writeTextFile(join(dirty, "untracked.txt"), "dirty untracked\n");

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(dirty),
      `dirty merged worktree must not be pruned\n${r.output}`,
    );
    assertStringIncludes(r.output, "dirty 2 status entries");
    assertEquals(
      await Deno.readTextFile(join(dirty, "tracked.txt")),
      "dirty tracked\n",
    );
    assertEquals(
      await Deno.readTextFile(join(dirty, "untracked.txt")),
      "dirty untracked\n",
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/dirty-merged"),
      "agent/dirty-merged",
      `a kept worktree's checked-out branch must not be deleted\n${r.output}`,
    );
  });
});

Deno.test("worktree:prune --yes keeps a clean detached worktree whose HEAD is not merged", async () => {
  await withTempDir(async (dir) => {
    const detached = await mainWithWorktree(dir, "detached-unmerged");
    await git(detached, "checkout", "--detach");
    await Deno.writeTextFile(join(detached, "detached.txt"), "detached work\n");
    await git(detached, "add", "-A");
    await git(
      detached,
      "commit",
      "-q",
      "-m",
      "detached work",
      "--no-gpg-sign",
    );
    const detachedHead = await gitOut(detached, "rev-parse", "HEAD");

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(detached),
      `detached unmerged worktree must not be pruned\n${r.output}`,
    );
    assertStringIncludes(r.output, "detached HEAD has unmerged commits");
    assertEquals(await gitOut(detached, "rev-parse", "HEAD"), detachedHead);
    assertEquals(
      await Deno.readTextFile(join(detached, "detached.txt")),
      "detached work\n",
    );
  });
});

/** Parse a `discern start --json` apply result. */
interface StartResult {
  ok: boolean;
  verb: string;
  data: { id: string; branch: string; path: string };
  hints: string[];
}

Deno.test("start: from the main checkout creates a set-up sibling worktree and returns its path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StartResult;
    assertEquals(result.ok, true);
    assertEquals(result.verb, "start");

    const { id, branch, path } = result.data;
    // The branch is the fresh agent/<id> the worktree was created on.
    assertEquals(branch, `agent/${id}`);
    // It lands in the SIBLING placement (never nested inside the repo), exactly where
    // the production resolver puts it — so a minted id round-trips through worktreePath.
    // (The verb resolves its root via findRoot, which canonicalizes /var → /private/var
    // on macOS, so compare against the canonicalized repo dir.)
    const realDir = await Deno.realPath(dir);
    assert(
      !path.startsWith(`${realDir}/`),
      `must not nest inside the repo: ${path}`,
    );
    assertStringIncludes(path, `${basename(dir)}.worktrees`);
    assertEquals(path, worktreePath(realDir, id));
    // It is genuinely set up: setup materialized the agent files inside the worktree.
    assert(
      await exists(join(path, "CLAUDE.md")),
      `setup didn't run in ${path}`,
    );
    // …and it is checked out on its own branch.
    assertEquals(await gitOut(path, "branch", "--show-current"), `agent/${id}`);
    // The result carries the re-root instruction (the agent must move into the path).
    assert(
      result.hints.some((h) =>
        h.includes(path) && /session rooted|cd /.test(h)
      ),
      `expected a re-root hint naming ${path}: ${JSON.stringify(result.hints)}`,
    );
  });
});

Deno.test("start: refuses from inside a worktree (main-checkout-only)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "alpha");
    const r = await runAgent(wt, ["start", "--json"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.verb, "start");
    // Mapped to the same precondition slug graduate/integrate use from the main checkout.
    assertEquals(result.error, "precondition_failed");
    // It must NOT have created a nested worktree of its own.
    assertEquals(
      await exists(`${wt}.worktrees`),
      false,
      "refusal must touch nothing",
    );
  });
});

Deno.test("start: mints a fresh, unique id on each call (never re-mints a live worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const first = JSON.parse((await runAgent(dir, ["start", "--json"])).stdout)
      .data as StartResult["data"];
    const second = JSON.parse((await runAgent(dir, ["start", "--json"])).stdout)
      .data as StartResult["data"];

    assert(first.id !== second.id, `ids must differ across calls: ${first.id}`);
    assert(first.path !== second.path, "each start lands in its own directory");
    // Both worktrees exist, fully set up, on distinct branches.
    assert(
      await exists(join(first.path, "CLAUDE.md")),
      "first worktree set up",
    );
    assert(
      await exists(join(second.path, "CLAUDE.md")),
      "second worktree set up",
    );
    assertEquals(
      await gitOut(second.path, "branch", "--show-current"),
      second.branch,
    );
  });
});

Deno.test("start (human): announces the new worktree and how to cd into it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // Setup narrated, then the path + the "cd into it" deliverable.
    assertStringIncludes(r.output, "is ready at");
    assertStringIncludes(r.output, "cd ");
    assertStringIncludes(r.output, `${basename(dir)}.worktrees`);
  });
});

Deno.test("start --dry-run: previews creating a worktree and touches nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout);
    assertEquals(result.dry_run, true);
    assertEquals(result.plan.title, "Start plan");
    // A dry-run mints an id for the preview but creates no worktree at all.
    assertEquals(
      await exists(`${dir}.worktrees`),
      false,
      `dry-run must not create the sibling worktree root\n${r.output}`,
    );
  });
});

// ── [worktree.setup]: one-shot `steps` vs convergent `ensure` (ADR 0059) ───────

/** Scaffold a main repo whose `[worktree.setup]` carries `steps`/`ensure`, commit
 * it, and add a linked worktree that inherits it on a CLEAN tree (so integrate,
 * which refuses a dirty tree, still applies). The commands are baked into the
 * committed config — the worktree carries them like a real checkout. */
async function mainWithSetup(
  dir: string,
  name: string,
  setup: { steps?: string[]; ensure?: string[] },
): Promise<string> {
  await scaffoldEngine(dir);
  const cfgPath = join(dir, "discern.toml");
  let cfg = await Deno.readTextFile(cfgPath);
  const toToml = (xs: string[]) =>
    `[${xs.map((s) => JSON.stringify(s)).join(", ")}]`;
  if (setup.steps !== undefined) {
    cfg = cfg.replace("steps = []", `steps = ${toToml(setup.steps)}`);
  }
  if (setup.ensure !== undefined) {
    cfg = cfg.replace("ensure = []", `ensure = ${toToml(setup.ensure)}`);
  }
  await Deno.writeTextFile(cfgPath, cfg);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Run `fn` with a fresh marker directory OUTSIDE any repo (so a `git add -A` in
 * the main checkout never stages it). A setup command appends a line here per run;
 * the line count proves how many times that bucket ran. Cleaned up after. */
async function withMarkers(
  fn: (markers: string) => Promise<void>,
): Promise<void> {
  const markers = await Deno.makeTempDir({ prefix: "discern-markers-" });
  try {
    await fn(markers);
  } finally {
    await Deno.remove(markers, { recursive: true });
  }
}

/** How many times a marker command ran (non-empty lines appended); 0 when the file
 * was never created (the command never ran). */
async function markerCount(path: string): Promise<number> {
  try {
    return (await Deno.readTextFile(path)).split("\n").filter((l) => l !== "")
      .length;
  } catch {
    return 0;
  }
}

Deno.test("worktree setup: runs the one-shot steps then the convergent ensure", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const steps = join(markers, "steps");
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "setup-both", {
        steps: [`echo x >> ${steps}`],
        ensure: [`echo x >> ${ensure}`],
      });
      const r = await runAgent(wt, ["worktree"]);
      assertEquals(r.code, 0, r.output);
      assertEquals(await markerCount(steps), 1, `steps ran once\n${r.output}`);
      assertEquals(await markerCount(ensure), 1, `ensure ran\n${r.output}`);
    });
  });
});

Deno.test("worktree setup re-entry: skips the one-shot steps, re-runs ensure", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const steps = join(markers, "steps");
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "reentry", {
        steps: [`echo x >> ${steps}`],
        ensure: [`echo x >> ${ensure}`],
      });
      await runAgent(wt, ["worktree"]); // creation: steps 1, ensure 1
      const again = await runAgent(wt, ["worktree"]); // re-entry
      assertEquals(again.code, 0, again.output);
      assertStringIncludes(again.output, "skipping setup steps");
      assertEquals(
        await markerCount(steps),
        1,
        "the one-shot steps must not re-run on re-entry",
      );
      assertEquals(
        await markerCount(ensure),
        2,
        "the convergent ensure must re-run on re-entry",
      );
    });
  });
});

Deno.test("worktree:ensure converges via [worktree.setup].ensure on every session start", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "wt-ensure", {
        ensure: [`echo x >> ${ensure}`],
      });
      await runAgent(wt, ["worktree:ensure"]); // first: fresh setup → ensure 1
      await runAgent(wt, ["worktree:ensure"]); // already configured → ensure 2
      assertEquals(
        await markerCount(ensure),
        2,
        "session-start ensure must converge the worktree each time",
      );
    });
  });
});

Deno.test("worktree:ensure: a successful ensure command's output never leaks into session-start stdout", async () => {
  await withTempDir(async (dir) => {
    // The SessionStart hook runs `worktree:ensure` and Claude Code injects its STDOUT
    // as agent context, so a chatty ensure command (a `vale sync` progress bar) must
    // not surface there. The command prints `OUT42END` only when it RUNS — the marker
    // is absent from the command text, so the "Ensure step: …" narration can't
    // false-match; it appears in the captured output alone.
    const wt = await mainWithSetup(dir, "quiet-ensure", {
      ensure: ["echo OUT$((6*7))END"],
    });
    const r = await runAgent(wt, ["worktree:ensure"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      r.output.includes("OUT42END"),
      false,
      `a successful ensure command must be captured, not leaked to the session\n${r.output}`,
    );
  });
});

Deno.test("worktree --dry-run: lists the ensure commands it would run", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "dry", {
      steps: ["echo once-only"],
      ensure: ["echo converge-me"],
    });
    const r = await runAgent(wt, ["worktree", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "echo once-only");
    assertStringIncludes(r.output, "echo converge-me");
  });
});

Deno.test("worktree setup: a failing ensure at creation is fatal (aborts setup)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "fatal-ensure", { ensure: ["exit 7"] });
    const r = await runAgent(wt, ["worktree"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Ensure step failed");
    // Aborted before the agent-file refresh + sentinel — setup never completed.
    assertEquals(
      r.output.includes("Worktree setup complete"),
      false,
      `a fatal ensure must abort setup\n${r.output}`,
    );
    assertEquals(
      await exists(join(wt, "CLAUDE.md")),
      false,
      "the agent-file refresh must not run after a fatal ensure",
    );
  });
});

Deno.test("integrate: re-runs [worktree.setup].ensure after the merge", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "integ-ensure", {
        ensure: [`echo x >> ${ensure}`],
      });
      // Advance main so the branch is behind by one. (No prior `worktree` setup —
      // that would record the port into an untracked .env and dirty the tree, which
      // integrate refuses; the ensure here runs purely as part of integrate.)
      await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

      const r = await runAgent(wt, ["integrate"]);
      assertEquals(r.code, 0, r.output);
      assertStringIncludes(r.output, "Integration complete");
      assert(
        await exists(join(wt, "upstream.txt")),
        `merge landed\n${r.output}`,
      );
      assertEquals(
        await markerCount(ensure),
        1,
        `integrate must run ensure after the merge\n${r.output}`,
      );
    });
  });
});

Deno.test("integrate: a failing ensure is recorded but never undoes the merge", async () => {
  await withTempDir(async (dir) => {
    // The ensure fails once the merge brings upstream.txt in. (No prior `worktree`
    // setup — it would dirty the tree via .env and integrate would refuse; the
    // ensure here runs only as integrate's post-merge convergence step.)
    const wt = await mainWithSetup(dir, "integ-fail", {
      ensure: ["test ! -f upstream.txt"],
    });
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const r = await runAgent(wt, ["integrate", "--json"]);
    // Non-fatal: the failed ensure does not abort or undo the landed merge.
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(wt, "upstream.txt")), "the merge must be kept");
    const result = JSON.parse(r.stdout) as {
      ok: boolean;
      steps: Array<{ kind: string; label: string; outcome: string }>;
    };
    const mergeStep = result.steps.find((s) =>
      s.kind === "git" && s.label === "merge"
    );
    assert(mergeStep?.outcome === "ok", `merge recorded ok\n${r.stdout}`);
    const ensureStep = result.steps.find((s) => s.kind === "setup-ensure");
    assertEquals(
      ensureStep?.outcome,
      "failed",
      `the failing ensure is recorded as a failed step\n${r.stdout}`,
    );
    // A failed sub-step makes the result not-ok, mirroring a failed refresh.
    assertEquals(
      result.ok,
      false,
      `result.ok reflects the failed ensure\n${r.stdout}`,
    );
  });
});
