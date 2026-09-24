/**
 * Engine coverage for the worktree teardown/prune family — the housekeeping side
 * of the isolated-worktree lifecycle.
 *
 * `engine_worktree_test.ts` drives the happy-path lifecycle (setup → exit →
 * prune). This file pins down the surfaces it leaves uncovered: the safety
 * boundary of `removeWorktreeSafely` (refuse the main checkout / a non-worktree
 * path), the positive-ownership boundary of `worktree prune` (an identified,
 * merged fleet worktree is reclaimed; merged foreign refs are kept), teardown destroying a
 * worktree's declared resources (not just the no-op path),
 * and `inheritMainEnvVars` copying a whitelisted secret into a worktree's `.env`.
 *
 * Like the sibling engine tests these shell out to the installed `agent` in a
 * hermetic git repo, so the bytes under test are the bytes an install runs. They
 * are correspondingly slower than the pure-`src/` suite.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "@std/path";
import { z } from "@zod/zod";
import { lstatIfExists, targetExists } from "../src/shared/fs_presence.ts";
import { parse as parseToml } from "@std/toml";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  runWorktreeCore,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { wireProviderWorktreeApp } from "../src/lib/providers.ts";
import {
  type GitWorktreePruneScan,
  type OrphanWorktreeSweepScan,
  pruneGitWorktrees,
  readySentinelPath,
  sweepOrphanWorktrees,
} from "../src/engine/worktree/git.ts";
import { Logger } from "../src/lib/log.ts";
import { waitForPendingCondition } from "./waiting.ts";
import {
  clearRetiredWorktreeBranch,
  inspectRetiredWorktreePathRecord,
  pruneReappearedWorktreePaths,
  readRetiredWorktreeBranchRecords,
  readRetiredWorktreePathRecords,
  recordRetiredWorktreeBranch,
  recordRetiredWorktreePath,
  scanReappearedWorktreePaths,
} from "../src/engine/worktree/retired_paths.ts";
import { decodeCliResult, decodeWith } from "./decode_cli_result.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const RetiredPathFixtureSchema = z.object({
  schema_version: z.number(),
}).passthrough();

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Mark a raw Git fixture as a worktree discern successfully readied. */
async function markDiscernOwned(worktree: string): Promise<void> {
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined, "fixture worktree must have Git-admin state");
  await Deno.mkdir(dirname(marker), { recursive: true });
  await Deno.writeTextFile(marker, "");
}

/** Create the positively-owned fleet shape automatic prune requires. */
async function ownedWorktree(dir: string, name: string): Promise<string> {
  const worktree = await mainWithWorktree(dir, name);
  await markDiscernOwned(worktree);
  return worktree;
}

/**
 * A minimal valid config. The default scaffolded `discern.toml` already carries
 * the `[worktree]` seams (all empty), but tests that need specific adapter
 * commands or an `inherit_env` list overwrite it via `writeConfig` with this
 * shape plus their own additions.
 */
function baseConfig(extra = ""): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[scopes.map]",
    'paths = ["docs/"]',
    "neutral = true",
    extra,
    "",
  ].join("\n");
}

/** Only a strict `lstat` NotFound result proves a retired path is absent. */
async function assertLstatAbsent(path: string): Promise<void> {
  if (await lstatIfExists(path) === undefined) return;
  throw new Error(`expected retired path to be absent: ${path}`);
}

// ── removeWorktreeSafely: the rm -rf safety boundary ──────────────────────
//
// This helper is the rm -rf primitive every prune/sweep path funnels through, so
// its refusal conditions are the load-bearing guard against deleting the wrong
// directory. Nothing else exercises them.

Deno.test("removeWorktreeSafely refuses to delete the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Point it at the main repo itself: it must refuse, and main must survive.
    const r = await runWorktreeCore(dir, ["remove", dir]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "main checkout");
    assert(
      await targetExists(join(dir, "discern.toml")),
      `main checkout must be left intact\n${r.output}`,
    );
  });
});

Deno.test("removeWorktreeSafely refuses a path that is not a worktree of this repo", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // An ordinary directory inside the repo that git does not track as a
    // worktree: deleting it would be the stray-argument footgun the gate guards.
    const bystander = join(dir, "not-a-worktree");
    await Deno.mkdir(bystander);
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");

    const r = await runWorktreeCore(dir, ["remove", bystander]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "not a worktree of this repository");
    assert(
      await targetExists(join(bystander, "keep.txt")),
      `a non-worktree directory must NOT be removed\n${r.output}`,
    );
  });
});

Deno.test("removeWorktreeSafely refuses a target inside the repository's Git metadata", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "metadata-overlap");
    const adminDir = await gitOut(wt, "rev-parse", "--absolute-git-dir");

    const result = await runWorktreeCore(dir, [
      "remove",
      adminDir,
    ]);

    assertEquals(result.code, 1, result.output);
    assertTerminalTextIncludes(result.output, "overlaps");
    assertTerminalTextIncludes(result.output, "Git metadata");
    assert(await targetExists(adminDir), "the Git-admin entry must remain");
    assert(await targetExists(wt), "the linked checkout must remain");
  });
});

Deno.test("removeWorktreeSafely removes a real linked worktree and reconciles git", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "removable");

    const r = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(r.code, 0, r.output);
    await assertLstatAbsent(wt);
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(wt),
      `git metadata should be reconciled (worktree deregistered)\n${r.output}`,
    );
  });
});

Deno.test("removeWorktreeSafely is idempotent on an already-removed path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "twice");

    const first = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(first.code, 0, first.output);
    // Re-running against the now-absent path must be a clean success no-op.
    const second = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(second.code, 0, second.output);
  });
});

Deno.test("removeWorktreeSafely detects a path recreated while retirement evidence is written", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "late-writer");
    const commonRaw = await gitOut(dir, "rev-parse", "--git-common-dir");
    const common = commonRaw.startsWith("/")
      ? commonRaw
      : resolve(dir, commonRaw);
    const evidenceDir = join(
      common,
      "discern",
      "retired-worktree-paths",
    );
    await Deno.mkdir(evidenceDir, { recursive: true });
    const evidenceLock = await Deno.open(join(evidenceDir, ".lock"), {
      create: true,
      read: true,
      write: true,
    });
    await evidenceLock.lock(true);
    const removal = runWorktreeCore(dir, ["remove", wt]);
    try {
      await waitForPendingCondition(
        removal,
        async () => {
          try {
            await Deno.lstat(wt);
            return false;
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) return true;
            throw error;
          }
        },
        "the removal to reach its evidence-write boundary",
      );
      await Deno.mkdir(join(wt, "observer-state", "nested"), {
        recursive: true,
      });
    } finally {
      evidenceLock.close();
    }

    const result = await removal;
    assertEquals(result.code, 1, result.output);
    assertTerminalTextIncludes(result.output, "retired path exists again");
    assert(
      await targetExists(join(wt, "observer-state", "nested")),
      `a replacement path must be preserved for inspection\n${result.output}`,
    );
  });
});

Deno.test("removeWorktreeSafely refuses a symlink substituted for the registered path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "symlink-target");
    const parked = `${wt}.parked`;
    const bystander = join(dir, "bystander-target");
    await Deno.mkdir(bystander);
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");
    await Deno.rename(wt, parked);
    await Deno.symlink(bystander, wt);
    try {
      const result = await runWorktreeCore(dir, ["remove", wt]);
      assertEquals(result.code, 1, result.output);
      assertTerminalTextIncludes(result.output, "symlink");
      assertEquals(
        await Deno.readTextFile(join(bystander, "keep.txt")),
        "keep\n",
      );
      assertStringIncludes(
        await gitOut(dir, "worktree", "list", "--porcelain"),
        wt,
      );
    } finally {
      await Deno.remove(wt);
      await Deno.rename(parked, wt);
      const cleanup = await runWorktreeCore(dir, ["remove", wt]);
      assertEquals(cleanup.code, 0, cleanup.output);
    }
  });
});

Deno.test("removeWorktreeSafely detects a symlink swap at the final absence boundary", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "symlink-swap");
    const bystander = join(dir, "symlink-swap-bystander");
    await Deno.mkdir(bystander);
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");
    const commonRaw = await gitOut(dir, "rev-parse", "--git-common-dir");
    const common = commonRaw.startsWith("/")
      ? commonRaw
      : resolve(dir, commonRaw);
    const evidenceDir = join(common, "discern", "retired-worktree-paths");
    await Deno.mkdir(evidenceDir, { recursive: true });
    const evidenceLock = await Deno.open(join(evidenceDir, ".lock"), {
      create: true,
      read: true,
      write: true,
    });
    await evidenceLock.lock(true);
    const removal = runWorktreeCore(dir, ["remove", wt]);
    try {
      await waitForPendingCondition(
        removal,
        async () => {
          try {
            await Deno.lstat(wt);
            return false;
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) return true;
            throw error;
          }
        },
        "the removal to reach its final evidence boundary",
      );
      await Deno.symlink(bystander, wt);
    } finally {
      evidenceLock.close();
    }

    const result = await removal;
    assertEquals(result.code, 1, result.output);
    assertTerminalTextIncludes(result.output, "retired path exists again");
    assert((await Deno.lstat(wt)).isSymlink, "the replacement link is kept");
    assertEquals(
      await Deno.readTextFile(join(bystander, "keep.txt")),
      "keep\n",
    );
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(wt),
      "the failed result reports the exact retained Git state",
    );
    await Deno.remove(wt);
  });
});

Deno.test({
  name:
    "removeWorktreeSafely reports an unreadable target as unknown, not absent",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const wt = await mainWithWorktree(dir, "unreadable-target");
      const root = dirname(wt);
      await Deno.chmod(root, 0o600);
      try {
        const result = await runWorktreeCore(dir, ["remove", wt]);
        assertEquals(result.code, 1, result.output);
        assertTerminalTextIncludes(result.output, "could not inspect");
        assertStringIncludes(
          await gitOut(dir, "worktree", "list", "--porcelain"),
          wt,
        );
      } finally {
        await Deno.chmod(root, 0o700);
        const cleanup = await runWorktreeCore(dir, ["remove", wt]);
        assertEquals(cleanup.code, 0, cleanup.output);
      }
    });
  },
});

Deno.test("removeWorktreeSafely cannot report success while Git still registers the retired path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "registry-stays");
    const canonicalWt = await Deno.realPath(wt);
    const gitShim = join(dir, "git-success-without-removal.sh");
    await Deno.writeTextFile(
      gitShim,
      [
        "#!/bin/sh",
        'case " $* " in',
        '  *" worktree remove "*|*" worktree prune "*) exit 0 ;;',
        "esac",
        'exec git "$@"',
        "",
      ].join("\n"),
      { mode: 0o700 },
    );

    const removed = await runWorktreeCore(
      dir,
      ["remove", canonicalWt],
      { env: { GIT_BIN: gitShim } },
    );
    assertEquals(removed.code, 1, removed.output);
    assertTerminalTextIncludes(removed.output, "still registered");

    const registry = await gitOut(dir, "worktree", "list", "--porcelain");
    assertStringIncludes(
      registry,
      canonicalWt,
      "the injected Git refusal keeps the exact registration for a safe rerun",
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/registry-stays"),
      "agent/registry-stays",
      "a teardown failure must retain the branch",
    );

    const retried = await runWorktreeCore(dir, [
      "remove",
      canonicalWt,
    ]);
    assertEquals(retried.code, 0, retried.output);
    assertEquals(await targetExists(canonicalWt), false, retried.output);
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(
        canonicalWt,
      ),
      "the named recovery rerun must converge registration and path",
    );
  });
});

Deno.test("removed worktree paths stay observable and reclaimable when unrelated tools recreate them", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "reappearing");
    const canonicalWt = await Deno.realPath(wt);
    const bystander = join(dirname(wt), "bystander");
    await Deno.mkdir(bystander, { recursive: true });
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");

    const removed = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(removed.code, 0, removed.output);
    assertEquals(await targetExists(wt), false, removed.output);

    const writers = [
      "observer-state/checkpoint.bin",
      "extension-cache/session.lock",
    ];
    for (const relativePath of writers) {
      await Deno.mkdir(dirname(join(wt, relativePath)), { recursive: true });
      await Deno.writeTextFile(join(wt, relativePath), "external state\n");

      const status = await runAgent(dir, ["status", "--json"]);
      assertEquals(status.code, 0, status.output);
      const statusResult = decodeCliResult(status.stdout, "status");
      assert(
        statusResult.data !== undefined && "location" in statusResult.data,
        status.stdout,
      );
      const residue = statusResult.data.reappeared_worktree_paths?.find(
        (entry) => entry.path === canonicalWt,
      );
      assert(residue !== undefined, status.output);
      assertEquals(residue.contents, [relativePath]);

      const dry = await runAgent(dir, [
        "worktree",
        "prune",
        "--dry-run",
        "--json",
      ]);
      assertEquals(dry.code, 0, dry.output);
      const plan = decodeCliResult(dry.stdout, "worktree prune");
      assert(plan.plan !== undefined, dry.stdout);
      const candidate = plan.plan.steps.find((step) =>
        step.label === canonicalWt &&
        step.group === "Reappeared worktree paths"
      );
      assert(candidate !== undefined, dry.output);
      assertStringIncludes(candidate.note ?? "", relativePath);
      assert(
        !plan.plan.steps.some((step) => step.label === bystander),
        `an unrecorded neighboring directory must stay outside prune's deletion boundary\n${dry.output}`,
      );

      const prune = await runAgent(dir, ["worktree", "prune", "--yes"]);
      assertEquals(prune.code, 0, prune.output);
      assertEquals(await targetExists(wt), false, prune.output);
      assert(
        await targetExists(join(bystander, "keep.txt")),
        `an unrecorded neighboring directory must survive\n${prune.output}`,
      );
    }
  });
});

Deno.test("retired worktree path evidence remains bounded and expires from observation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    const paths = ["apollo", "gemini", "voyager"].map((name) =>
      join(dirname(dir), `${name}-retired`)
    );
    for (const [index, path] of paths.entries()) {
      assertEquals(
        await recordRetiredWorktreePath(dir, path, {
          now: now + index,
          ttlMs: 10_000,
          maxEntries: 2,
        }),
        true,
      );
    }
    assertEquals(
      (await readRetiredWorktreePathRecords(dir, {
        now: now + paths.length,
        ttlMs: 10_000,
        maxEntries: 10,
      })).map((record) => record.path),
      [paths[2], paths[1]],
    );
    assertEquals(
      await readRetiredWorktreePathRecords(dir, {
        now: now + 20_000,
        ttlMs: 10_000,
      }),
      [],
    );
  });
});

Deno.test("worktree prune finishes recorded landed-branch deletions and clears superseded records", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const landedTip = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "branch", "agent/landed", landedTip);
    assertEquals(
      await recordRetiredWorktreeBranch(dir, {
        branch: "agent/landed",
        expectedCommit: landedTip,
        mergedInto: "main",
      }),
      true,
    );
    // A branch that moved after its landing was recorded stays untouched and
    // its record retires: the evidence no longer describes the ref.
    await git(dir, "commit", "--allow-empty", "-m", "advance", "--no-gpg-sign");
    const movedTip = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "branch", "agent/moved", movedTip);
    assertEquals(
      await recordRetiredWorktreeBranch(dir, {
        branch: "agent/moved",
        expectedCommit: landedTip,
        mergedInto: "main",
      }),
      true,
    );

    const dry = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const plan = decodeCliResult(dry.stdout, "worktree prune");
    assert(plan.plan !== undefined, dry.stdout);
    assertEquals(
      plan.plan.steps
        .filter((step) => step.group === "Branches")
        .map((step) => `${step.label}:${step.disposition}`)
        .sort(),
      ["agent/landed:run", "agent/moved:skip"],
      dry.output,
    );
    // Dry-run acts on nothing: both branches and both records remain.
    assertEquals(await gitOut(dir, "rev-parse", "agent/landed"), landedTip);
    assertEquals((await readRetiredWorktreeBranchRecords(dir)).length, 2);

    const prune = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(prune.code, 0, prune.output);
    const result = decodeCliResult(prune.stdout, "worktree prune");
    assert(result.steps !== undefined, prune.stdout);
    const branchSteps = result.steps.filter((step) =>
      step.group === "Branches"
    );
    const finished = branchSteps.find((step) => step.label === "agent/landed");
    assert(finished !== undefined, prune.output);
    assertEquals(
      finished.note,
      "finished the recorded landed-branch deletion",
      prune.output,
    );
    const cleared = branchSteps.find((step) => step.label === "agent/moved");
    assert(cleared !== undefined, prune.output);
    assertStringIncludes(
      cleared.note ?? "",
      "cleared the landed-branch record",
      prune.output,
    );
    assertEquals(await gitOut(dir, "branch", "--list", "agent/landed"), "");
    assertEquals(await gitOut(dir, "rev-parse", "agent/moved"), movedTip);
    assertEquals(await readRetiredWorktreeBranchRecords(dir), []);
  });
});

Deno.test("landed-branch evidence remains bounded, expires, and clears on demand", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const now = Date.parse("2026-09-09T12:00:00.000Z");
    const commit = "a".repeat(40);
    for (const [index, branch] of ["agent/a", "agent/b", "agent/c"].entries()) {
      assertEquals(
        await recordRetiredWorktreeBranch(dir, {
          branch,
          expectedCommit: commit,
          mergedInto: "main",
        }, { now: now + index, ttlMs: 10_000, maxEntries: 2 }),
        true,
      );
    }
    assertEquals(
      (await readRetiredWorktreeBranchRecords(dir, {
        now: now + 3,
        ttlMs: 10_000,
      })).map((record) => record.branch),
      ["agent/c", "agent/b"],
    );
    assertEquals(
      await readRetiredWorktreeBranchRecords(dir, {
        now: now + 20_000,
        ttlMs: 10_000,
      }),
      [],
    );
    assertEquals(await clearRetiredWorktreeBranch(dir, "agent/c"), true);
    assertEquals(await clearRetiredWorktreeBranch(dir, "agent/c"), false);
    assertEquals(
      (await readRetiredWorktreeBranchRecords(dir, {
        now: now + 3,
        ttlMs: 10_000,
      })).map((record) => record.branch),
      ["agent/b"],
    );
    // The two evidence families share the store without cross-pruning: a path
    // write sweeps only path records, and branch records survive it.
    const retired = join(dirname(dir), "retired-neighbor");
    assertEquals(await recordRetiredWorktreePath(dir, retired), true);
    assertEquals(
      (await readRetiredWorktreePathRecords(dir)).map((record) => record.path),
      [retired],
    );
    assertEquals(
      (await readRetiredWorktreeBranchRecords(dir, {
        now: now + 3,
        ttlMs: 10_000,
      })).map((record) => record.branch),
      ["agent/b"],
    );
  });
});

Deno.test("newer retired-path evidence is observed and survives replacement and pruning", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const retired = join(dirname(dir), "newer-retired-path");
    assertEquals(await recordRetiredWorktreePath(dir, retired), true);
    const store = await gitAdminStatePath(dir, "retiredWorktreePaths");
    assert(store !== undefined);
    const records = [];
    for await (const entry of Deno.readDir(store)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        records.push(join(store, entry.name));
      }
    }
    assertEquals(records.length, 1);
    const path = records[0];
    assert(path !== undefined);
    const current = decodeWith(
      RetiredPathFixtureSchema,
      await Deno.readTextFile(path),
    );
    const future = `${
      JSON.stringify({
        ...current,
        schema_version: ON_DISK_FORMATS.retiredWorktreePath.version + 1,
      })
    }\n`;
    await Deno.writeTextFile(path, future);

    const inspected = await inspectRetiredWorktreePathRecord(path);
    assert(inspected.status === "newer");
    assertStringIncludes(inspected.reason, "written by a newer discern");
    assertEquals(await recordRetiredWorktreePath(dir, retired), false);
    assertEquals(await Deno.readTextFile(path), future);

    await recordRetiredWorktreePath(
      dir,
      join(dirname(dir), "another-retired-path"),
      { maxEntries: 0 },
    );
    assertEquals(await Deno.readTextFile(path), future);
  });
});

const REAPPEARED_PATH_APPLY_RACES: Record<
  string,
  (dir: string, path: string) => Promise<void>
> = {
  "new files written after the scan survive": async (_dir, path) => {
    await Deno.writeTextFile(join(path, "late-checkpoint.bin"), "late\n");
  },
  "a worktree registered again after the scan survives": async (dir, path) => {
    await Deno.remove(path, { recursive: true });
    await git(dir, "worktree", "add", path, "agent/reappeared-race");
  },
};

for (const [caseName, mutate] of Object.entries(REAPPEARED_PATH_APPLY_RACES)) {
  Deno.test(`reappeared-path prune revalidates its plan: ${caseName}`, async () => {
    await withTempDir(async (dir) => {
      const wt = await mainWithWorktree(dir, "reappeared-race");
      const canonicalWt = await Deno.realPath(wt);
      const removed = await runWorktreeCore(dir, ["remove", wt]);
      assertEquals(removed.code, 0, removed.output);
      await Deno.mkdir(wt, { recursive: true });
      await Deno.writeTextFile(join(wt, "initial.cache"), "initial\n");

      const scan = await scanReappearedWorktreePaths(dir);
      assertEquals(scan.removable.map((entry) => entry.path), [canonicalWt]);
      await mutate(dir, wt);

      const result = await pruneReappearedWorktreePaths(scan, quietLog());
      assertEquals(result.removed, []);
      assertEquals(result.failed, false);
      assertEquals(result.skipped.length, 1);
      assert(
        await targetExists(wt),
        "state created after the plan must survive",
      );
    });
  });
}

Deno.test("reappeared-path prune treats a path removed after the plan as a completed no-op", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "reappeared-gone");
    const removed = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(removed.code, 0, removed.output);
    await Deno.mkdir(wt, { recursive: true });
    await Deno.writeTextFile(join(wt, "initial.cache"), "initial\n");
    const scan = await scanReappearedWorktreePaths(dir);
    assertEquals(scan.removable.length, 1);

    await Deno.remove(wt, { recursive: true });
    const result = await pruneReappearedWorktreePaths(scan, quietLog());
    assertEquals(result, { removed: [], skipped: [], failed: false });
  });
});

Deno.test("worktree prune keeps a removed path repurposed as a Git checkout", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "repurposed");
    const canonicalWt = await Deno.realPath(wt);
    const removed = await runWorktreeCore(dir, ["remove", wt]);
    assertEquals(removed.code, 0, removed.output);
    await Deno.mkdir(join(wt, ".git"), { recursive: true });
    await Deno.writeTextFile(join(wt, ".git", "config"), "valuable\n");

    const scan = await scanReappearedWorktreePaths(dir);
    assertEquals(scan.removable, []);
    assertEquals(scan.kept.map((entry) => entry.path), [canonicalWt]);
    assertEquals(
      scan.kept[0]?.cleanup_blocked_reason,
      "the path contains Git metadata",
    );

    const prune = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(prune.code, 0, prune.output);
    assert(
      await targetExists(join(wt, ".git", "config")),
      `a path repurposed as a Git checkout must survive\n${prune.output}`,
    );
  });
});

// ── worktree prune — branch sweeping (the merged/unmerged distinction) ───────
//
// The existing suite asserts a merged worktree DIRECTORY is reclaimed and a live
// one is kept. This pins the branch boundary: only the exact branch carried by
// a registered fleet identity is deleted; merged foreign and unproven refs are
// context only, while unmerged work remains protected independently.

Deno.test("worktree prune offers only positively identified discern work, never foreign merged refs", async () => {
  await withTempDir(async (dir) => {
    const mergedWt = await ownedWorktree(dir, "owned-merged");
    const keepWt = await addWorktree(dir, "kept");
    const unmarkedWt = await addWorktree(dir, "manual-exact");

    // The ready marker plus exact agent/<git-admin-id> branch carries positive
    // fleet identity. Once merged, it is a routine prune candidate.
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge owned",
      "agent/owned-merged",
    );

    // agent/kept: a commit that is NEVER merged → unmerged work to preserve.
    await Deno.writeTextFile(join(keepWt, "k.txt"), "k\n");
    await git(keepWt, "add", "-A");
    await git(keepWt, "commit", "-q", "-m", "k", "--no-gpg-sign");

    // Fully merged names are not ownership evidence. Cover an ordinary foreign
    // backup, a partial-prefix look-alike, an exact-prefix branch with no fleet
    // identity, and the dedicated setup branch (owned by setup's lifecycle only).
    for (
      const branch of [
        "main-pre-discern",
        "agentish/partial-prefix",
        "agent/manual-prefix-only",
        "discern-setup",
      ]
    ) {
      await git(dir, "branch", branch);
    }
    const foreignWt = join(`${dir}.worktrees`, "foreign-live");
    await git(
      dir,
      "worktree",
      "add",
      foreignWt,
      "agent/manual-prefix-only",
    );
    await Deno.writeTextFile(
      join(foreignWt, ".env.local"),
      "DISCERN_WORKTREE_ID=manual-prefix-only\n",
    );

    // Leave the unmerged branch dangling to prove its existing safety rule.
    await git(dir, "worktree", "remove", "--force", keepWt);

    const dry = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const dryPlan = decodeCliResult(dry.stdout, "worktree prune");
    assert(dryPlan.plan !== undefined, dry.stdout);
    const destructiveText = dryPlan.plan.steps
      .map((step) => `${step.label} ${step.note ?? ""}`)
      .join("\n");
    assertStringIncludes(destructiveText, mergedWt);
    for (
      const foreign of [
        "main-pre-discern",
        "agentish/partial-prefix",
        "agent/manual-prefix-only",
        "agent/manual-exact",
        "discern-setup",
      ]
    ) {
      assert(
        !destructiveText.includes(foreign),
        `${foreign} has no positive prune ownership and must stay outside the destructive plan\n${dry.output}`,
      );
    }

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);

    assertEquals(
      await targetExists(mergedWt),
      false,
      `the positively identified merged worktree should be removed\n${r.output}`,
    );
    const after = await branchList(dir);
    assertEquals(
      after.includes("agent/owned-merged"),
      false,
      `the removed owned worktree's merged branch should be deleted\n${r.output}\n${after}`,
    );
    assert(
      await targetExists(foreignWt),
      `a self-asserted id cannot turn mismatched Git metadata into ownership\n${r.output}`,
    );
    assert(
      await targetExists(unmarkedWt),
      `an exact branch/admin-name match without discern's ready marker must stay\n${r.output}`,
    );
    assert(
      after.includes("agent/kept"),
      `an unmerged branch must be preserved\n${r.output}\n${after}`,
    );
    for (
      const foreign of [
        "main-pre-discern",
        "agentish/partial-prefix",
        "agent/manual-prefix-only",
        "agent/manual-exact",
        "discern-setup",
      ]
    ) {
      assert(
        after.includes(foreign),
        `${foreign} must remain untouched\n${r.output}\n${after}`,
      );
    }
    // main is always protected.
    assert(after.includes("main"), `main must survive\n${after}`);
  });
});

// ── worktree prune — the dry-run plan must AGREE with the real run ───────────
//
// Regression guard (ADR 0027): `--dry-run` builds a plan from what prune WOULD
// remove and reclaim. A dry-run that reports "nothing to do" while the real run
// then removes worktrees and deletes branches is the exact plan/apply divergence
// the model forbids — and was a real bug (pruneGitWorktrees/sweepOrphanWorktrees
// narrated their candidates but returned EMPTY lists in dryRun mode, so the plan
// read nothing). This pins the two paths to agree.

Deno.test("worktree prune --dry-run lists what the real run removes, and acts on nothing", async () => {
  await withTempDir(async (dir) => {
    // A live, clean, fully-merged worktree — a genuine removal candidate.
    const mergedWt = await ownedWorktree(dir, "victim");
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge victim", "agent/victim");

    // Dry-run must NAME the candidate (not claim "nothing to do") and touch nothing.
    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.stdout, "victim");
    assert(
      !dry.stdout.includes("nothing to do"),
      `dry-run wrongly reported an empty plan\n${dry.stdout}`,
    );
    assert(
      await targetExists(mergedWt),
      `dry-run must not remove the worktree\n${dry.output}`,
    );

    // --dry-run --json: the plan carries the worktree and its branch.
    const dryJson = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    const plan = decodeCliResult(dryJson.stdout, "worktree prune");
    assert(plan.plan !== undefined, dryJson.stdout);
    const labels: string[] = plan.plan.steps.map((s: { label: string }) =>
      s.label
    );
    assert(
      labels.some((l) => l.includes("victim")),
      `the dry-run plan should include the victim worktree\n${dryJson.stdout}`,
    );

    // The real run removes exactly what the dry-run promised.
    const real = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(real.code, 0, real.output);
    assertEquals(
      await targetExists(mergedWt),
      false,
      `the real run should remove the worktree the dry-run named\n${real.output}`,
    );
    assert(
      !(await branchList(dir)).includes("agent/victim"),
      "the merged branch should be deleted by the real run",
    );
  });
});

Deno.test("worktree prune keeps an owned merged worktree while its recorded acceptance is unsettled", async () => {
  await withTempDir(async (dir) => {
    const worktree = await ownedWorktree(dir, "owed");
    await Deno.writeTextFile(join(worktree, "o.txt"), "o\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-q", "-m", "o", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge owed", "agent/owed");
    // The acceptance journal is the only retry vehicle for what a landing
    // still owes, and it lives in this checkout's Git administration.
    const journal = await gitAdminStatePath(worktree, "acceptanceTransaction");
    assert(journal !== undefined);
    await Deno.mkdir(dirname(journal), { recursive: true });
    await Deno.writeTextFile(journal, "{}\n");

    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assert(!dry.stdout.includes("owed"), dry.output);
    const kept = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(kept.code, 0, kept.output);
    assertStringIncludes(
      kept.output,
      "its recorded acceptance is unsettled; run discern accept from it",
    );
    assert(await targetExists(worktree), kept.output);
    assert((await branchList(dir)).includes("agent/owed"));

    // Once the acceptance settles, the same checkout is an ordinary
    // candidate again.
    await Deno.remove(journal);
    const removed = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(removed.code, 0, removed.output);
    assertEquals(await targetExists(worktree), false, removed.output);
  });
});

Deno.test("worktree prune --dry-run reports stale metadata and apply prunes that entry", async () => {
  await withTempDir(async (dir) => {
    const wt = await ownedWorktree(dir, "stale-meta");
    const canonicalWt = await Deno.realPath(wt);

    // Simulate an out-of-band deletion that leaves git's worktree admin metadata
    // behind. This is the stale bookkeeping `git worktree prune` would reclaim.
    await Deno.remove(wt, { recursive: true });

    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.stdout, "Stale metadata: 1 entry");
    assertStringIncludes(dry.stdout, wt);

    const dryJson = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dryJson.code, 0, dryJson.output);
    const plan = decodeCliResult(dryJson.stdout, "worktree prune");
    assert(plan.plan !== undefined, dryJson.stdout);
    const stalePlanSteps = plan.plan.steps.filter((s) =>
      s.group === "Stale metadata"
    );
    assertEquals(
      stalePlanSteps.map((s: { label: string }) => s.label),
      [canonicalWt],
      dryJson.stdout,
    );

    const real = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(real.code, 0, real.output);
    const result = decodeCliResult(real.stdout, "worktree prune");
    assert(result.steps !== undefined, real.stdout);
    const staleResultSteps = result.steps.filter((s) =>
      s.group === "Stale metadata"
    );
    assertEquals(
      staleResultSteps.map((s: { label: string }) => s.label),
      [canonicalWt],
      real.stdout,
    );
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(
        canonicalWt,
      ),
      "apply should prune the stale metadata git listed in the plan",
    );
  });
});

Deno.test("worktree prune refuses off-TTY without --yes and shows the candidates", async () => {
  await withTempDir(async (dir) => {
    const mergedWt = await ownedWorktree(dir, "confirm");
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge confirm", "agent/confirm");

    const r = await runAgent(dir, ["worktree", "prune"]);

    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "Confirmation required");
    assertTerminalTextIncludes(r.output, "re-run with `--yes`");
    assertStringIncludes(r.output, "confirm");
    assert(
      await targetExists(mergedWt),
      `refusing for missing --yes must not remove the candidate\n${r.output}`,
    );
  });
});

// ── worktree prune — orphan-directory sweep at the configured root ───────────
//
// A worktree dir whose git metadata was lost (a hard kill, a failed remove hook)
// is reclaimed by the orphan sweep. The sweep discovers locations from git's
// registry — the parents of registered worktrees — so when NO registered
// worktree remains to derive the worktree root from, it would miss that root
// entirely. The dispatch layer therefore passes the resolved [worktree].root as
// extraDirs (ADR 0052). This pins that wiring: a FULLY-orphaned dir at the
// (sibling) default root is still reclaimed.

Deno.test("worktree prune keeps a dirty orphaned dir at the configured worktree root", async () => {
  await withTempDir(async (dir) => {
    const wt = await ownedWorktree(dir, "orphan"); // <dir>.worktrees/orphan
    const root = dirname(wt); // the sibling worktree root
    const orphan = join(root, "orphan-moved");
    await Deno.writeTextFile(join(wt, "uncommitted.txt"), "save me\n");

    // Sever git's registration while leaving the checkout on disk: move it so the
    // registered path goes missing (prune drops the stale admin entry), while the
    // moved dir keeps its `.git` gitlink into this repo's worktrees admin area —
    // exactly the orphan a hard kill leaves behind.
    await Deno.rename(wt, orphan);

    // No registered linked worktree now points anywhere under `root`, so the
    // git-derived parent scan cannot reach it; only the extraDirs the dispatch
    // layer passes (the resolved [worktree].root) does.
    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(orphan),
      `the dirty orphaned dir at the worktree root must be kept\n${r.output}`,
    );
    assertEquals(
      await Deno.readTextFile(join(orphan, "uncommitted.txt")),
      "save me\n",
    );
    assertTerminalTextIncludes(r.output, "dirty 1 status entries");
  });
});

Deno.test("worktree prune reclaims a clean fully-orphaned dir at the configured worktree root", async () => {
  await withTempDir(async (dir) => {
    const wt = await ownedWorktree(dir, "clean-orphan");
    const root = dirname(wt);
    const orphan = join(root, "clean-orphan-moved");
    await Deno.writeTextFile(join(wt, "merged.txt"), "merged\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "merged orphan", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge clean orphan",
      "agent/clean-orphan",
    );
    await Deno.rename(wt, orphan);

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await targetExists(orphan),
      false,
      `a clean orphaned dir at the worktree root should be reclaimed\n${r.output}`,
    );
  });
});

Deno.test("worktree prune does not let an orphan env file assert destructive ownership", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "foreign-key");
    const orphan = join(dirname(wt), "foreign-key-moved");
    await git(wt, "checkout", "-q", "-b", "agent/claimed-id");
    await Deno.writeTextFile(
      join(wt, ".env.local"),
      "DISCERN_WORKTREE_ID=claimed-id\n",
    );
    await Deno.writeTextFile(join(wt, "merged.txt"), "merged\n");
    await git(wt, "add", "-f", ".env.local", "merged.txt");
    await git(wt, "commit", "-q", "-m", "foreign orphan", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge foreign orphan",
      "agent/claimed-id",
    );
    await Deno.rename(wt, orphan);

    const dry = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
    ]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.stdout, "outside discern ownership");

    const applied = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(applied.code, 0, applied.output);
    assert(
      await targetExists(orphan),
      `checkout-local identity must not authorize orphan removal\n${applied.output}`,
    );
    assert(
      (await branchList(dir)).includes("agent/claimed-id"),
      `the foreign branch must remain\n${applied.output}`,
    );
  });
});

Deno.test("worktree prune refuses to run from inside a linked worktree", async () => {
  await withTempDir(async (dir) => {
    // Pool housekeeping is a main-checkout operation (guarded by
    // assert-not-in-worktree). Driving it from inside a linked worktree must
    // refuse — you would be pruning siblings from within one — and touch nothing.
    const wt = await mainWithWorktree(dir, "from-inside");
    const r = await runAgent(wt, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "main checkout");
    assert(
      await targetExists(wt),
      `the worktree must be left intact\n${r.output}`,
    );
  });
});

// ── prune apply — stale-scan revalidation (the confirmation-window race) ────
//
// The prune plan is built BEFORE the interactive confirmation, so by the time
// apply runs, a candidate that scanned clean and fully merged may have gained
// uncommitted work, new commits, or a different branch — discern's own product
// model is many agents working in parallel worktrees. The apply path's own
// discipline (deleteBranchSafe re-checks merged-ness; the stale-metadata prune
// re-reads the gitdir pointer) must hold for the worktree removal too: each
// candidate is re-validated against LIVE state just before removal and skipped
// when it changed since the plan was built. These tests drive the apply
// function directly with the scan a waiting interaction would have held.

/** A logger with all output suppressed (json mode) — these direct-call tests
 * assert on returned results and disk state, not narration. */
function quietLog(): Logger {
  return new Logger({ json: true, noColor: true });
}

/**
 * A clean, fully-merged linked worktree plus the prune scan that classified it
 * REMOVE — the plan `worktree prune` holds while its confirmation interaction
 * waits. The candidate carries the path exactly as the production scan records
 * it: git's own worktree listing.
 */
async function staleRemovalScan(
  dir: string,
  name: string,
): Promise<{ wt: string; scan: GitWorktreePruneScan }> {
  const wt = await ownedWorktree(dir, name);
  await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
  await git(dir, "merge", "--no-ff", "-m", `merge ${name}`, `agent/${name}`);
  const listed = (await gitOut(dir, "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .find((p) => p.endsWith(`/${name}`));
  assert(listed !== undefined, "fixture worktree must be listed by git");
  return {
    wt,
    scan: {
      repoRoot: await gitOut(dir, "rev-parse", "--show-toplevel"),
      mainBranch: "main",
      identitySettings: {
        slug: "engine-test",
        branchPrefix: "agent/",
      },
      worktreesToRemove: [{
        path: listed,
        branch: `agent/${name}`,
        id: name,
        head: await gitOut(wt, "rev-parse", "HEAD"),
      }],
      staleMetadata: [],
      orphanedLandedBranches: [],
      worktreeLines: [],
      branchLines: [],
    },
  };
}

/**
 * Post-scan mutations — the work an agent could do in a worktree while the
 * already-built plan waits at the confirmation interaction. Each must disqualify
 * the candidate at apply time. The `undefined` control row pins the other
 * direction: an unchanged candidate is still removed, so the re-check can
 * never dead-end an honest prune.
 */
const PRUNE_APPLY_RACES: Record<
  string,
  ((wt: string) => Promise<void>) | undefined
> = {
  "an unchanged candidate is still removed": undefined,
  "uncommitted work written after the scan survives": async (wt) => {
    await Deno.writeTextFile(join(wt, "in-flight.txt"), "unsaved work\n");
  },
  "a commit made after the scan keeps the worktree": async (wt) => {
    await Deno.writeTextFile(join(wt, "post-scan.txt"), "new\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "post-scan", "--no-gpg-sign");
  },
  "a branch switched after the scan keeps the worktree": async (wt) => {
    await git(wt, "checkout", "-q", "-b", "agent/elsewhere");
  },
  "ownership evidence removed after the scan keeps the worktree": async (
    wt,
  ) => {
    const marker = await readySentinelPath(wt);
    assert(marker !== undefined, "fixture marker must resolve");
    await Deno.remove(marker);
  },
};

for (const [caseName, mutate] of Object.entries(PRUNE_APPLY_RACES)) {
  Deno.test(`worktree prune apply re-validates its scan: ${caseName}`, async () => {
    await withTempDir(async (dir) => {
      const { wt, scan } = await staleRemovalScan(dir, "raced");
      if (mutate !== undefined) {
        await mutate(wt);
      }

      const result = await pruneGitWorktrees(scan, quietLog());

      if (mutate === undefined) {
        assertEquals(result.failed, false);
        assertEquals(
          await targetExists(wt),
          false,
          "an unchanged candidate must still be removed",
        );
        assertEquals((await branchList(dir)).includes("agent/raced"), false);
      } else {
        assertEquals(result.removed, [], "a changed candidate must be skipped");
        assertEquals(result.branchesDeleted, []);
        assertEquals(
          result.failed,
          false,
          "a kept candidate is a skip, not a failure",
        );
        assert(
          await targetExists(wt),
          "work created during the confirmation window must survive",
        );
        assert(
          (await branchList(dir)).includes("agent/raced"),
          "the planned branch must survive with its worktree",
        );
      }
    });
  });
}

Deno.test("orphan sweep apply keeps a dir that gained work after the scan", async () => {
  await withTempDir(async (dir) => {
    // A clean, fully-merged worktree severed from git's registry by moving it —
    // the orphan shape the sweep scan classifies as removable.
    const wt = await ownedWorktree(dir, "sweepraced");
    await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge", "agent/sweepraced");
    const orphan = join(dirname(wt), "sweepraced-moved");
    await Deno.rename(wt, orphan);

    const scan: OrphanWorktreeSweepScan = {
      mainRepo: await Deno.realPath(dir),
      mainBranch: "main",
      identitySettings: {
        slug: "engine-test",
        branchPrefix: "agent/",
      },
      removable: [{
        path: orphan,
        reason: "clean branch agent/sweepraced, fully merged",
      }],
      kept: [],
    };

    // The race: unsaved work lands in the orphan while the plan awaits consent.
    await Deno.writeTextFile(join(orphan, "in-flight.txt"), "unsaved work\n");

    const result = await sweepOrphanWorktrees(scan, quietLog());
    assertEquals(result.removed, [], "a changed candidate must be skipped");
    assertEquals(result.failed, false, "a kept candidate is not a failure");
    assertEquals(
      await Deno.readTextFile(join(orphan, "in-flight.txt")),
      "unsaved work\n",
      "work created during the confirmation window must survive",
    );
  });
});

/** The repo's local branch names, newline-joined, via a hermetic git call. */
async function branchList(dir: string): Promise<string> {
  const c = new Deno.Command("git", {
    args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    cwd: dir,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await c.output();
  return new TextDecoder().decode(stdout);
}

// ── worktree teardown — resources actually destroyed ────────────────────────
//
// The sibling test proves teardown is a clean no-op when nothing is declared.
// This proves the other half: a resource created at setup is destroyed at
// teardown (via the ledger's frozen command), with its handle expanded. The
// markers live OUTSIDE the worktree so the destroy can be checked afterwards.

Deno.test("worktree teardown destroys the worktree's resources", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "tear");
    const markers = join(dir, "markers");
    // Append a resource to the scaffolded config (keeping [instructions] etc. so the
    // setup step's instruction refresh still runs).
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live && touch ${markers}/@resource@.gone"\n`,
    );

    // Setup creates the resource (and the ledger entry teardown acts on).
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
      .stdout
      .trim();
    assert(
      await targetExists(join(markers, `${handle}.live`)),
      `setup did not create the resource\n${setup.output}`,
    );

    const r = await runAgent(wt, ["worktree", "teardown"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(join(markers, `${handle}.gone`)),
      `teardown did not destroy the resource\n${r.output}`,
    );
    assert(
      !(await targetExists(join(markers, `${handle}.live`))),
      "teardown left the live marker",
    );
  });
});

Deno.test("worktree teardown refuses to run from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // From main, teardown must refuse — it is a worktree-only, destructive op.
    const r = await runAgent(dir, ["worktree", "teardown"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "worktree");
  });
});

// ── Codex [cleanup] contract: the written cleanup.script is the cwd-based teardown ──
//
// Codex's environment.toml `[cleanup].script` runs as a BARE command in the worktree
// cwd with no stdin (unlike Claude's `worktree remove`, which reads a {worktree_path}
// payload). This binds the two halves of that contract: the exact script string
// discern writes into the app's environment.toml IS a dispatchable verb that tears the
// worktree down by cwd — so a rename of the verb (or the written script) that broke
// Codex teardown would red-light here rather than silently ship.

Deno.test("worktree teardown by cwd is the verb discern writes as Codex's environment.toml [cleanup].script", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "codexcleanup");
    const markers = join(dir, "markers");
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live && touch ${markers}/@resource@.gone"\n`,
    );
    // Setup creates the resource + the ledger entry teardown acts on.
    await runAgent(wt, ["worktree", "setup"]);
    const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
      .stdout
      .trim();

    // discern writes the cleanup script into the app's environment.toml…
    await wireProviderWorktreeApp(wt, ["codex"]);
    const env = parseToml(
      await Deno.readTextFile(join(wt, ".codex/environments/environment.toml")),
    ) as { cleanup: { script: string } };

    // …and running THAT script verbatim as a bare command in the worktree cwd (no
    // stdin — the Codex [cleanup] invocation shape) tears the worktree down by cwd.
    const [bin, ...verbArgs] = env.cleanup.script.split(" ");
    assertEquals(bin, "discern"); // the local-dev shim invokes the engine for us
    const r = await runAgent(wt, verbArgs);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(join(markers, `${handle}.gone`)),
      `the [cleanup].script did not tear the worktree down by cwd\n${r.output}`,
    );
  });
});

// ── inheritMainEnvVars — whitelisted secret propagation ──────────────────
//
// A fresh worktree's .env carries only what is in version control. This command
// copies the [worktree].inherit_env whitelist from the MAIN checkout's .env into
// the worktree's .env so the worktree's app can boot with the same secrets.

Deno.test("inheritMainEnvVars copies a whitelisted var from main's .env into the worktree's .env", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "envwt");
    // The inherit list is read from the current root = the worktree's own
    // discern.toml; the secret is read from the MAIN checkout's .env.
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig('\n[worktree]\ninherit_env = ["FOO"]'),
    );

    // FOO is a secret kept out of git: it lives only in main's .env.
    await Deno.writeTextFile(join(dir, ".env"), "FOO=bar\n");
    // Seed an empty file to prove inheritance updates an existing target.
    await Deno.writeTextFile(join(wt, ".env"), "");

    const r = await runWorktreeCore(wt, ["inherit"]);
    assertEquals(r.code, 0, r.output);

    const wtEnv = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(wtEnv, "FOO=bar");
  });
});

Deno.test("inheritMainEnvVars creates the worktree env file when absent", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "noenv");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig('\n[worktree]\ninherit_env = ["FOO"]'),
    );
    await Deno.writeTextFile(join(dir, ".env"), "FOO=bar\n");
    // A fresh worktree has no env file — the declared value must still arrive.

    const r = await runWorktreeCore(wt, ["inherit"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "FOO=bar",
      `the declared value must arrive in a created env file\n${r.output}`,
    );
    assertEquals(
      ((await Deno.stat(join(wt, ".env"))).mode ?? 0) & 0o777,
      0o600,
    );
  });
});

Deno.test("inheritMainEnvVars derives the placeholder from the first configured env file", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "customenv");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig(
        '\n[worktree]\ninherit_env = ["FOO"]\nenv_files = ["config/app.env", ".env.local"]',
      ),
    );
    await Deno.mkdir(join(dir, "config"), { recursive: true });
    await Deno.mkdir(join(wt, "config"), { recursive: true });
    await Deno.writeTextFile(join(dir, "config/app.env"), "FOO=secret\n");
    await Deno.writeTextFile(
      join(dir, "config/app.env.example"),
      "FOO=placeholder\n",
    );
    await Deno.writeTextFile(
      join(wt, "config/app.env"),
      "FOO=placeholder\n",
    );

    const r = await runWorktreeCore(wt, ["inherit"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, "config/app.env")),
      "FOO=secret",
    );
  });
});
