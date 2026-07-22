/**
 * `status` tells the truth about the fleet — the abandoned-work visibility class:
 * a worktree whose creation crashed mid-checkout is flagged BROKEN (not listed as
 * a healthy clean member), unlanded `agent/*` branches with no worktree are
 * surfaced, a stale worktree gets a resume-or-drop hint, a missing trunk yields
 * an honest null instead of a fabricated "0 ahead", the off-trunk-main hint
 * describes the state and the way back, and a pristine worktree beside a dirty
 * main checkout raises the silent-divergence warning (status AND finish).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  worktreePath,
} from "./engine_helpers.ts";

interface StatusJson {
  data: {
    git: { ahead_integration: number | null } | null;
    fleet?: Array<{
      path: string;
      id?: string;
      broken?: boolean;
      clean?: boolean;
      git_unavailable?: boolean;
    }>;
    unlanded_branches?: string[];
  };
  hints?: string[];
}

async function statusJson(dir: string): Promise<StatusJson> {
  const r = await runAgent(dir, ["status", "--json"]);
  assertEquals(r.code, 0, r.output);
  return JSON.parse(r.stdout) as StatusJson;
}

Deno.test("status flags a configless worktree as broken, with the drop hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "crashed");
    // Simulate creation debris: the checkout exists and is registered, but the
    // project config never arrived (the pre-fix crash signature).
    await Deno.remove(join(wt, "discern.toml"));

    const result = await statusJson(dir);
    const row = result.data.fleet?.find((e) => e.path.endsWith("crashed"));
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.broken, true, "a configless checkout is broken");
    assertHasHint(result, HINTS["status-fleet-member-broken"], {
      name: "crashed",
    });

    // The human table says "broken", not "clean"/"changed".
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.output, "broken");
  });
});

Deno.test("status fleet ids are per-row truths — an env id override cannot repaint the fleet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "otter-one");
    await addWorktree(dir, "heron-two");

    // A caller with DISCERN_WORKTREE_ID exported (a resource command's child,
    // a dotenv-loading shell) walks the fleet: every row must keep its OWN id —
    // the override poisoning painted them all 'imposter', which then misfed the
    // drop hints and the port-collision check.
    const r = await runAgent(dir, ["status", "--json"], {
      env: { DISCERN_WORKTREE_ID: "imposter" },
    });
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StatusJson;
    const ids = (result.data.fleet ?? [])
      .map((row) => row.id)
      .filter((id) => id !== undefined);
    assert(ids.includes("otter-one") && ids.includes("heron-two"), r.stdout);
    assert(
      !ids.includes("imposter"),
      `no row may take the caller's id\n${r.stdout}`,
    );
  });
});

Deno.test("status reports an unreadable worktree honestly — never as clean/0-ahead", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "damaged");
    // git cannot run inside the checkout (a corrupted gitlink here; dubious
    // ownership or permission refusals are the same shape). Its state is
    // UNKNOWN — fabricating "clean, 0 ahead" hid destroyable work.
    await Deno.writeTextFile(join(wt, ".git"), "gitdir: /nonexistent/gone\n");

    const result = await statusJson(dir);
    const row = result.data.fleet?.find((e) => e.path.endsWith("damaged"));
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.git_unavailable, true, JSON.stringify(row));
    assertEquals(row.clean, undefined, "unknown state must not claim clean");
    assertHasHint(result, HINTS["status-fleet-member-unreadable"], {
      name: "gone",
    });

    // The human table says "unreadable", not "clean".
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.output, "unreadable");
  });
});

Deno.test("status lists unlanded agent/* branches that have no worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A live worktree, so the fleet view fires…
    await addWorktree(dir, "alive");
    // …and an unlanded branch whose worktree is long gone.
    await git(dir, "branch", "agent/ghost-work");
    await git(dir, "switch", "-q", "agent/ghost-work");
    await Deno.writeTextFile(join(dir, "ghost.txt"), "unlanded\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "ghost work", "--no-gpg-sign");
    await git(dir, "switch", "-q", "main");

    const result = await statusJson(dir);
    assertEquals(result.data.unlanded_branches, ["agent/ghost-work"]);
    assertHasHint(result, HINTS["status-unlanded-branches"], {
      branches: ["agent/ghost-work"],
    });

    // A branch checked out in a live worktree is NOT "abandoned".
    assert(
      !(result.data.unlanded_branches ?? []).includes("agent/alive"),
      "a branch with a worktree is not unlanded-abandoned",
    );
  });
});

Deno.test("status reports ahead as null (not 0) when the trunk branch is missing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The project is configured for `main`, but the local repo calls it `master`.
    await git(dir, "branch", "-M", "master");

    const result = await statusJson(dir);
    assert(result.data.git !== null);
    assertEquals(
      result.data.git.ahead_integration,
      null,
      "no trunk to count against — null, never a fabricated 0",
    );
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.output, "no main branch to compare against");
    assert(
      !human.output.includes("0 ahead"),
      `the fabricated count must be gone\n${human.output}`,
    );
  });
});

Deno.test("status names a MISSING trunk instead of prescribing a switch onto it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The project is configured for `main`, but the local repo calls it
    // `master` — 'run `git switch main`' would fail with 'invalid reference',
    // and 'new worktrees still fork from the trunk' would be false.
    await git(dir, "branch", "-M", "master");
    await addWorktree(dir, "somework");

    const result = await statusJson(dir);
    const expected = assertHasHint(result, HINTS["status-missing-trunk"], {
      branch: "master",
      trunk: "main",
    });
    assertLacksHint(result, HINTS["status-start-off-trunk"], {
      branch: "master",
      trunk: "main",
    });
    // A real misconfiguration, so the human rendering carries it too.
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.output, expected);
  });
});

Deno.test("status's off-trunk-main hint describes the state and the way back", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "somework");
    await git(dir, "switch", "-q", "-c", "reviewing-something");

    const result = await statusJson(dir);
    assertHasHint(result, HINTS["status-start-off-trunk"], {
      branch: "reviewing-something",
      trunk: "main",
    });
  });
});

Deno.test("status hints that a stale worktree with work should be resumed or dropped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Create the worktree with a back-dated reflog entry, then back-date the wip
    // file's mtime too (last-activity is the max of the two).
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const wt = worktreePath(dir, "dusty");
    const add = await new Deno.Command("git", {
      args: ["worktree", "add", wt, "-b", "agent/dusty"],
      cwd: dir,
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_COMMITTER_DATE: tenDaysAgo.toISOString(),
        GIT_COMMITTER_NAME: "Engine Test",
        GIT_COMMITTER_EMAIL: "engine-test@example.com",
      },
      stdout: "null",
      stderr: "piped",
    }).output();
    assert(add.success, new TextDecoder().decode(add.stderr));
    await Deno.writeTextFile(join(wt, "wip.txt"), "abandoned\n");
    await Deno.utime(join(wt, "wip.txt"), tenDaysAgo, tenDaysAgo);

    const result = await statusJson(dir);
    assertHasHint(result, HINTS["status-fleet-member-stale"], {
      name: "dusty",
      idleDays: 10,
      clean: false,
      ahead: 0,
      changedFiles: 1,
    });
  });
});

Deno.test("a pristine worktree beside a dirty main checkout raises the divergence warning", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "aimed-here");
    // The worktree stays untouched; the "work" lands in the main checkout.
    await Deno.writeTextFile(join(dir, "misplaced-edit.txt"), "oops\n");

    // status (from the worktree) warns…
    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const status = JSON.parse(r.stdout) as { hints?: string[] };
    const params = {
      cwd: await Deno.realPath(wt),
      mainRepo: await Deno.realPath(dir),
      changedFiles: 1,
    };
    assertHasHint(status, HINTS["silent-worktree-divergence"], params);

    // …and finish carries the same warning in its hints.
    const fin = await runAgent(wt, ["done", "--json"]);
    const gate = JSON.parse(fin.stdout) as { hints?: string[] };
    assertHasHint(gate, HINTS["silent-worktree-divergence"], params);

    // Real work in the worktree clears the signature.
    await Deno.writeTextFile(join(wt, "real-work.txt"), "here\n");
    const after = await runAgent(wt, ["status", "--json"]);
    const cleared = JSON.parse(after.stdout) as { hints?: string[] };
    assertLacksHint(cleared, HINTS["silent-worktree-divergence"], params);
  });
});

Deno.test("basename fallback: a broken worktree with no .env still gets a usable drop target", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "no-env");
    await Deno.remove(join(wt, "discern.toml"));
    const result = await statusJson(dir);
    // The drop target is the directory basename — exactly what drop resolves.
    assertHasHint(result, HINTS["status-fleet-member-broken"], {
      name: basename(wt),
    });
  });
});
