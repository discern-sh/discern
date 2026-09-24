/**
 * `status` tells the truth about the fleet — the abandoned-work visibility class:
 * a worktree whose creation crashed mid-checkout is flagged BROKEN and routed
 * to recovery, unlanded `agent/*` branches with no worktree are
 * surfaced, a stale worktree gets a resume-or-drop hint, a missing trunk yields
 * an honest null instead of a fabricated "0 ahead", the off-trunk-main hint
 * describes the state and the way back, and a pristine worktree beside a dirty
 * main checkout raises the silent-divergence warning (status AND finish).
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, dirname, join } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
import type {
  StatusFleetEntry,
  StatusWireData,
} from "../src/shared/result_schemas.ts";
import { buildDeskDecision } from "../src/engine/desk/model.ts";
import { gitSnapshot, readySentinelPath } from "../src/engine/worktree/git.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
} from "./engine_helpers.ts";

interface StatusJson {
  data: StatusWireData;
  hints?: string[];
}

/** Run status successfully and decode the fleet truth asserted by each broken-state case. */
async function statusJson(
  dir: string,
  env: Record<string, string> = {},
): Promise<StatusJson> {
  const r = await runAgent(dir, ["status", "--json"], { env });
  assertEquals(r.code, 0, r.output);
  const result = decodeCliResult(r.stdout, "status");
  const data = result.data;
  assert(
    data !== undefined && "location" in data,
    `status returned no situation data: ${r.stdout}`,
  );
  return result.hints === undefined ? { data } : { data, hints: result.hints };
}

/** Compare human facts independently of the dashboard's measured line breaks. */
function humanWords(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/** Mark a raw Git worktree as a completed discern checkout fixture. */
async function markReady(worktree: string): Promise<void> {
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined);
  await Deno.mkdir(dirname(marker), { recursive: true });
  await Deno.writeTextFile(marker, "");
}

/** Retain the recovery fields shared by status wire rows and Desk rows. */
function deskRecoveryEntry(
  row: NonNullable<StatusWireData["fleet"]>[number],
): StatusFleetEntry {
  return {
    path: row.path,
    branch: row.branch,
    is_main: row.is_main,
    is_current: row.is_current,
    ...(row.registration === undefined
      ? {}
      : { registration: row.registration }),
    ...(row.branch_reachable === undefined
      ? {}
      : { branch_reachable: row.branch_reachable }),
    ...(row.filesystem === undefined ? {} : { filesystem: row.filesystem }),
    ...(row.clean === undefined ? {} : { clean: row.clean }),
    ...(row.changed_files === undefined
      ? {}
      : { changed_files: row.changed_files }),
    ...(row.ahead === undefined ? {} : { ahead: row.ahead }),
    ...(row.behind === undefined ? {} : { behind: row.behind }),
    ...(row.last_activity === undefined
      ? {}
      : { last_activity: row.last_activity }),
    ...(row.last_action === undefined ? {} : { last_action: row.last_action }),
    ...(row.running === undefined ? {} : { running: row.running }),
    ...(row.contained_in === undefined
      ? {}
      : { contained_in: row.contained_in }),
    ...(row.git_unavailable === undefined
      ? {}
      : { git_unavailable: row.git_unavailable }),
    ...(row.git_failure === undefined ? {} : { git_failure: row.git_failure }),
    ...(row.id === undefined ? {} : { id: row.id }),
    ...(row.port === undefined ? {} : { port: row.port }),
    ...(row.resources === undefined ? {} : { resources: row.resources }),
    ...(row.setup === undefined ? {} : { setup: row.setup }),
    ...(row.task === undefined ? {} : { task: row.task }),
    ...(row.broken === undefined ? {} : { broken: row.broken }),
  };
}

Deno.test("status routes a configless broken worktree through recovery", async () => {
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
      total: 1,
      names: ["crashed"],
    });

    // The human row carries the derived broken state and its concrete action.
    const human = await runAgent(dir, ["status", "--verbose"]);
    assertTerminalTextIncludes(
      humanWords(human.output),
      "agent/crashed: Broken",
    );
    assertTerminalTextIncludes(
      humanWords(human.output),
      "Setup did not produce a readable project configuration. Choose Show recovery steps in `discern desk`.",
    );
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
    const result = await statusJson(dir, {
      DISCERN_WORKTREE_ID: "imposter",
    });
    const ids = (result.data.fleet ?? [])
      .map((row) => row.id)
      .filter((id) => id !== undefined);
    assert(
      ids.includes("otter-one") && ids.includes("heron-two"),
      JSON.stringify(result),
    );
    assert(
      !ids.includes("imposter"),
      `no row may take the caller's id\n${JSON.stringify(result)}`,
    );
  });
});

Deno.test("a failed worktree status read stays unreadable through status and the desk", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "damaged");
    await Deno.writeTextFile(join(wt, "work.txt"), "ready\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "ready work", "--no-gpg-sign");
    await markReady(wt);

    // `rev-parse --is-inside-work-tree` still succeeds, but `git status` cannot
    // read the index. This future-sibling fixture catches status-only failures,
    // not just a checkout whose whole gitlink is broken.
    const index = join(dir, ".git", "worktrees", basename(wt), "index");
    await Deno.chmod(index, 0o000);
    try {
      assertEquals(
        await gitSnapshot(wt, "main"),
        undefined,
        "the source snapshot must preserve an unreadable status as unknown",
      );
      const result = await statusJson(dir);
      const row = result.data.fleet?.find((e) => e.path.endsWith("damaged"));
      assert(row !== undefined, JSON.stringify(result.data.fleet));
      assertEquals(row.git_unavailable, true, JSON.stringify(row));
      assertEquals(row.clean, undefined, "unknown state must not claim clean");
      const deskDecision = buildDeskDecision({
        path: row.path,
        branch: row.branch,
        is_main: row.is_main,
        is_current: row.is_current,
        git_unavailable: true,
      }, {
        trunk: "main",
        nowMs: SYSTEM_CLOCK.wallNow(),
      });
      assertEquals(
        deskDecision.actions.flatMap((offer) =>
          offer.availability === "enabled" ? [offer.action] : []
        ),
        ["recovery", "drop"],
        "an unreadable branch must lead with diagnosis and never offer accept",
      );
      assertHasHint(result, HINTS["status-fleet-member-unreadable"], {
        total: 1,
        names: ["damaged"],
      });

      // Both fleet and local projections retain the derived unreadable state.
      const human = await runAgent(dir, ["status", "--verbose"]);
      assertTerminalTextIncludes(
        humanWords(human.output),
        "agent/damaged: Unreadable",
      );
      const local = await runAgent(wt, ["status"]);
      assertStringIncludes(humanWords(local.output), "Unreadable");
      assertTerminalTextIncludes(
        humanWords(local.output),
        "Git could not read this checkout. Choose Show recovery steps in `discern desk`.",
      );
    } finally {
      await Deno.chmod(index, 0o644);
    }
  });
});

Deno.test("one checkout that refuses its reads stays one unreadable row", async (t) => {
  if (Deno.build.os === "windows") {
    await t.step({
      name: "mode 0o000 cannot refuse a read on Windows",
      ignore: true,
      fn: () => {},
    });
    return;
  }
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const sealed = await addWorktree(dir, "sealed-checkout");
    await addWorktree(dir, "open-checkout");
    await Deno.chmod(sealed, 0o000);
    try {
      let refusal: unknown;
      try {
        await Deno.stat(join(sealed, "discern.toml"));
      } catch (error) {
        refusal = error;
      }
      if (refusal === undefined) {
        await t.step({
          name:
            "the current user traverses mode-0o000 directories, so the refusal cannot be simulated",
          ignore: true,
          fn: () => {},
        });
        return;
      }

      // The sealed row degrades to the facts the fleet listing observed plus
      // the failure; the sibling's survey completes untouched.
      const result = await statusJson(dir);
      const row = result.data.fleet?.find((e) =>
        e.path.endsWith("sealed-checkout")
      );
      assert(row !== undefined, JSON.stringify(result.data.fleet));
      assert(row.read_failure !== undefined, JSON.stringify(row));
      assertEquals(row.git_unavailable, true, JSON.stringify(row));
      const open = result.data.fleet?.find((e) =>
        e.path.endsWith("open-checkout")
      );
      assert(open !== undefined, JSON.stringify(result.data.fleet));
      assertEquals(open.read_failure, undefined);
      assertEquals(open.id, "open-checkout");
      assertHasHint(result, HINTS["status-fleet-member-unreadable"], {
        total: 1,
        names: ["sealed-checkout"],
      });
    } finally {
      await Deno.chmod(sealed, 0o755);
    }
  });
});

Deno.test("configured worktrees without a ready marker expose safe and manual setup recovery", async () => {
  const cases = [{
    name: "idempotent",
    configure: async (dir: string): Promise<void> => {
      await scaffoldEngine(dir);
    },
    repair: "retry",
    command: "discern worktree setup",
    retryAvailable: true,
  }, {
    name: "one-shot-without-journal",
    configure: async (dir: string): Promise<void> => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
          '[worktree.setup]\nsteps = ["echo one-shot"]\n',
      );
    },
    repair: "manual",
    command: "discern worktree setup --dry-run",
    retryAvailable: false,
  }] as const;

  for (const testCase of cases) {
    await withTempDir(async (dir) => {
      await testCase.configure(dir);
      await gitInit(dir);
      await addWorktree(dir, testCase.name);

      const result = await statusJson(dir);
      const row = result.data.fleet?.find((entry) =>
        entry.branch === `agent/${testCase.name}`
      );
      assert(row !== undefined, JSON.stringify(result.data.fleet));
      assertEquals(row.broken, undefined);
      assertEquals(row.setup?.state, "incomplete");
      assertEquals(row.setup?.repair?.kind, testCase.repair);
      assertEquals(row.setup?.repair?.command, testCase.command);

      const decision = buildDeskDecision(deskRecoveryEntry(row), {
        trunk: "main",
        nowMs: SYSTEM_CLOCK.wallNow(),
      });
      assertEquals(
        decision.actions.find((offer) => offer.action === "recovery")
          ?.availability,
        "enabled",
      );
      assertEquals(
        decision.actions.find((offer) => offer.action === "retry_setup")
          ?.availability,
        testCase.retryAvailable ? "enabled" : "disabled",
      );
      assertEquals(decision.recovery?.repairCommand, testCase.command);
      assertHasHint(result, HINTS["status-fleet-member-broken"], {
        total: 1,
        names: [testCase.name],
      });
    });
  }
});

Deno.test("a missing checkout directory stays registered and unavailable in recovery evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "missing-checkout");
    await Deno.remove(wt, { recursive: true });

    const result = await statusJson(dir);
    const row = result.data.fleet?.find((entry) =>
      entry.branch === "agent/missing-checkout"
    );
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.filesystem?.state, "missing");
    assertEquals(row.registration?.prunable, true);
    assertEquals(row.git_unavailable, true);
    assert(row.git_failure?.command.startsWith("git "));

    const decision = buildDeskDecision(deskRecoveryEntry(row), {
      trunk: "main",
      nowMs: SYSTEM_CLOCK.wallNow(),
    });
    assertEquals(
      decision.actions.find((offer) => offer.action === "recovery")
        ?.availability,
      "enabled",
    );
    assert(
      decision.recovery?.unavailable.some((fact) =>
        fact === "Filesystem: missing"
      ),
      JSON.stringify(decision.recovery),
    );
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
      result.data.git.ahead_trunk,
      null,
      "no trunk to count against — null, never a fabricated 0",
    );
    const human = await runAgent(dir, ["status"]);
    assertTerminalTextIncludes(
      humanWords(human.output),
      "The 'main' branch does not exist, and the main checkout is on 'master'.",
    );
    assert(
      !human.output.includes("0 ahead"),
      `the fabricated count must be gone\n${human.output}`,
    );
  });
});

Deno.test("failed or malformed Git count reads stay explicitly unknown", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "unknown-counts");
    await Deno.writeTextFile(join(wt, "work.txt"), "work\n");
    await git(wt, "add", "work.txt");
    await git(wt, "commit", "-q", "-m", "work", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "trunk.txt"), "trunk\n");
    await git(dir, "add", "trunk.txt");
    await git(dir, "commit", "-q", "-m", "trunk", "--no-gpg-sign");

    const gitWrapper = join(dir, "malformed-count-git");
    await Deno.writeTextFile(
      gitWrapper,
      [
        "#!/bin/sh",
        'saw_rev_list=""',
        'saw_count=""',
        'for arg in "$@"; do',
        '  if [ "$arg" = "rev-list" ]; then saw_rev_list=1; fi',
        '  if [ "$arg" = "--count" ]; then saw_count=1; fi',
        "done",
        'if [ "$saw_rev_list" = 1 ] && [ "$saw_count" = 1 ]; then',
        "  printf 'not-an-integer\\n'",
        "  exit 0",
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
      { mode: 0o700 },
    );

    const env = { GIT_BIN: gitWrapper };
    const result = await statusJson(wt, env);
    assert(result.data.git !== null);
    assertEquals(result.data.git.ahead_trunk, "unknown");
    assertEquals(result.data.git.behind_trunk, "unknown");

    const human = await runAgent(wt, ["status"], { env });
    assert(
      (human.output.includes("↑?") || human.output.includes("+?")) &&
        (human.output.includes("↓?") || human.output.includes("-?")),
      human.output,
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
    assertStringIncludes(humanWords(human.output), humanWords(expected));
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
    const tenDaysAgo = new Date(SYSTEM_CLOCK.wallNow() - 10 * 86_400_000);
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
      total: 1,
      names: ["dusty"],
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
    const status = await statusJson(wt);
    const params = {
      cwd: await Deno.realPath(wt),
      mainRepo: await Deno.realPath(dir),
      changedFiles: 1,
    };
    assertHasHint(status, HINTS["silent-worktree-divergence"], params);

    // …and finish carries the same warning in its hints.
    const fin = await runAgent(wt, ["done", "--json"]);
    const gate = decodeCliResult(fin.stdout, "done");
    assertHasHint(gate, HINTS["silent-worktree-divergence"], params);

    // Real work in the worktree clears the signature.
    await Deno.writeTextFile(join(wt, "real-work.txt"), "here\n");
    const cleared = await statusJson(wt);
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
      total: 1,
      names: [basename(wt)],
    });
  });
});
