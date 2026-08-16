/**
 * Engine coverage for the worktree teardown/prune family — the housekeeping side
 * of the isolated-worktree lifecycle.
 *
 * `engine_worktree_test.ts` drives the happy-path lifecycle (setup → exit →
 * prune). This file pins down the surfaces it leaves uncovered: the safety
 * boundary of `remove-worktree-safely` (refuse the main checkout / a non-worktree
 * path), the BRANCH-pruning behaviour of `worktree prune` (a merged branch with
 * no worktree is deleted; an unmerged one is kept), teardown destroying a
 * worktree's declared resources (not just the no-op path),
 * `inherit-main-env-vars` copying a whitelisted secret into a worktree's `.env`,
 * and `with-gotchas` printing its failure pointer while propagating the exit code.
 *
 * Like the sibling engine tests these shell out to the installed `agent` in a
 * hermetic git repo, so the bytes under test are the bytes an install runs. They
 * are correspondingly slower than the pure-`src/` suite.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { exists } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { wireProviderWorktreeApp } from "../src/lib/providers.ts";
import {
  type GitWorktreePruneScan,
  type OrphanWorktreeSweepScan,
  pruneGitWorktrees,
  sweepOrphanWorktrees,
} from "../src/engine/worktree/git.ts";
import { Logger } from "../src/lib/log.ts";
import {
  pruneReappearedWorktreePaths,
  readRetiredWorktreePathRecords,
  recordRetiredWorktreePath,
  scanReappearedWorktreePaths,
} from "../src/engine/worktree/retired_paths.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
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

// ── remove-worktree-safely: the rm -rf safety boundary ──────────────────────
//
// This helper is the rm -rf primitive every prune/sweep path funnels through, so
// its refusal conditions are the load-bearing guard against deleting the wrong
// directory. Nothing else exercises them.

Deno.test("remove-worktree-safely refuses to delete the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Point it at the main repo itself: it must refuse, and main must survive.
    const r = await runAgent(dir, ["remove-worktree-safely", dir]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "main checkout");
    assert(
      await exists(join(dir, "discern.toml")),
      `main checkout must be left intact\n${r.output}`,
    );
  });
});

Deno.test("remove-worktree-safely refuses a path that is not a worktree of this repo", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // An ordinary directory inside the repo that git does not track as a
    // worktree: deleting it would be the stray-argument footgun the gate guards.
    const bystander = join(dir, "not-a-worktree");
    await Deno.mkdir(bystander);
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");

    const r = await runAgent(dir, ["remove-worktree-safely", bystander]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "not a worktree of this repository");
    assert(
      await exists(join(bystander, "keep.txt")),
      `a non-worktree directory must NOT be removed\n${r.output}`,
    );
  });
});

Deno.test("remove-worktree-safely removes a real linked worktree and reconciles git", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "removable");

    const r = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `the worktree directory should be gone\n${r.output}`,
    );
    // git should no longer list it as a registered worktree.
    const list = await runAgent(dir, ["identity", "--id"], { cwd: dir });
    assertEquals(
      list.output.includes("removable"),
      false,
      `git metadata should be reconciled (worktree deregistered)\n${list.output}`,
    );
  });
});

Deno.test("remove-worktree-safely is idempotent on an already-removed path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "twice");

    const first = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(first.code, 0, first.output);
    // Re-running against the now-absent path must be a clean success no-op.
    const second = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(second.code, 0, second.output);
  });
});

Deno.test("removed worktree paths stay observable and reclaimable when unrelated tools recreate them", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "reappearing");
    const canonicalWt = await Deno.realPath(wt);
    const bystander = join(dirname(wt), "bystander");
    await Deno.mkdir(bystander, { recursive: true });
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");

    const removed = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(removed.code, 0, removed.output);
    assertEquals(await exists(wt), false, removed.output);

    const writers = [
      "observer-state/checkpoint.bin",
      "extension-cache/session.lock",
    ];
    for (const relativePath of writers) {
      await Deno.mkdir(dirname(join(wt, relativePath)), { recursive: true });
      await Deno.writeTextFile(join(wt, relativePath), "external state\n");

      const status = await runAgent(dir, ["status", "--json"]);
      assertEquals(status.code, 0, status.output);
      const statusResult = JSON.parse(status.stdout) as {
        data?: {
          reappeared_worktree_paths?: Array<{
            path: string;
            contents: string[];
          }>;
        };
      };
      const residue = statusResult.data?.reappeared_worktree_paths?.find(
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
      const plan = JSON.parse(dry.stdout) as {
        plan: {
          steps: Array<{ label: string; group?: string; note?: string }>;
        };
      };
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
      assertEquals(await exists(wt), false, prune.output);
      assert(
        await exists(join(bystander, "keep.txt")),
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
      const removed = await runAgent(dir, ["remove-worktree-safely", wt]);
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
      assert(await exists(wt), "state created after the plan must survive");
    });
  });
}

Deno.test("reappeared-path prune treats a path removed after the plan as a completed no-op", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "reappeared-gone");
    const removed = await runAgent(dir, ["remove-worktree-safely", wt]);
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
    const removed = await runAgent(dir, ["remove-worktree-safely", wt]);
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
      await exists(join(wt, ".git", "config")),
      `a path repurposed as a Git checkout must survive\n${prune.output}`,
    );
  });
});

// ── worktree prune — branch sweeping (the merged/unmerged distinction) ───────
//
// The existing suite asserts a merged worktree DIRECTORY is reclaimed and a live
// one is kept. This pins the parallel BRANCH behaviour: a fully-merged branch
// whose worktree is already gone is deleted, while an unmerged dangling branch is
// preserved (its commits are still worth reviewing).

Deno.test("worktree prune deletes a dangling fully-merged branch but keeps an unmerged one", async () => {
  await withTempDir(async (dir) => {
    // Two extra worktrees so we can produce two branches, then remove the
    // worktrees to leave the branches dangling (no checkout) for the branch
    // sweep to consider.
    const mergedWt = await mainWithWorktree(dir, "merged");
    const keepWt = await addWorktree(dir, "kept");

    // agent/merged: a commit that we merge into main → fully merged.
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge merged", "agent/merged");

    // agent/kept: a commit that is NEVER merged → unmerged work to preserve.
    await Deno.writeTextFile(join(keepWt, "k.txt"), "k\n");
    await git(keepWt, "add", "-A");
    await git(keepWt, "commit", "-q", "-m", "k", "--no-gpg-sign");

    // Remove both worktrees (but keep their branches) so the branch sweep — not
    // the worktree sweep — is what decides each branch's fate.
    await git(dir, "worktree", "remove", "--force", mergedWt);
    await git(dir, "worktree", "remove", "--force", keepWt);

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);

    // Inspect the surviving local branches directly via git.
    const after = await branchList(dir);
    assertEquals(
      after.includes("agent/merged"),
      false,
      `a dangling fully-merged branch should be deleted\n${r.output}\n${after}`,
    );
    assert(
      after.includes("agent/kept"),
      `an unmerged branch must be preserved\n${r.output}\n${after}`,
    );
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
    const mergedWt = await mainWithWorktree(dir, "victim");
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
      await exists(mergedWt),
      `dry-run must not remove the worktree\n${dry.output}`,
    );

    // --dry-run --json: the plan carries the worktree and its branch.
    const dryJson = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    const plan = JSON.parse(dryJson.stdout.trim());
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
      await exists(mergedWt),
      false,
      `the real run should remove the worktree the dry-run named\n${real.output}`,
    );
    assert(
      !(await branchList(dir)).includes("agent/victim"),
      "the merged branch should be deleted by the real run",
    );
  });
});

Deno.test("worktree prune --dry-run reports stale metadata and apply prunes that entry", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "stale-meta");
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
    const plan = JSON.parse(dryJson.stdout.trim());
    const stalePlanSteps = plan.plan.steps.filter((
      s: { group?: string },
    ) => s.group === "Stale metadata");
    assertEquals(
      stalePlanSteps.map((s: { label: string }) => s.label),
      [canonicalWt],
      dryJson.stdout,
    );

    const real = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(real.code, 0, real.output);
    const result = JSON.parse(real.stdout.trim());
    const staleResultSteps = result.steps.filter((
      s: { group?: string },
    ) => s.group === "Stale metadata");
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
    const mergedWt = await mainWithWorktree(dir, "confirm");
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
      await exists(mergedWt),
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
    const wt = await mainWithWorktree(dir, "orphan"); // <dir>.worktrees/orphan
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
      await exists(orphan),
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
    const wt = await mainWithWorktree(dir, "clean-orphan");
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
      await exists(orphan),
      false,
      `a clean orphaned dir at the worktree root should be reclaimed\n${r.output}`,
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
    assert(await exists(wt), `the worktree must be left intact\n${r.output}`);
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
  const wt = await mainWithWorktree(dir, name);
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
      worktreesToRemove: [{ path: listed, branch: `agent/${name}` }],
      branchesToDelete: [],
      staleMetadata: [],
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
          await exists(wt),
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
          await exists(wt),
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
    const wt = await mainWithWorktree(dir, "sweepraced");
    await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge", "agent/sweepraced");
    const orphan = join(dirname(wt), "sweepraced-moved");
    await Deno.rename(wt, orphan);

    const scan: OrphanWorktreeSweepScan = {
      mainRepo: await Deno.realPath(dir),
      mainBranch: "main",
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
      await exists(join(markers, `${handle}.live`)),
      `setup did not create the resource\n${setup.output}`,
    );

    const r = await runAgent(wt, ["worktree", "teardown"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      `teardown did not destroy the resource\n${r.output}`,
    );
    assert(
      !(await exists(join(markers, `${handle}.live`))),
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
      await exists(join(markers, `${handle}.gone`)),
      `the [cleanup].script did not tear the worktree down by cwd\n${r.output}`,
    );
  });
});

// ── inherit-main-env-vars — whitelisted secret propagation ──────────────────
//
// A fresh worktree's .env carries only what is in version control. This command
// copies the [worktree].inherit_env whitelist from the MAIN checkout's .env into
// the worktree's .env so the worktree's app can boot with the same secrets.

Deno.test("inherit-main-env-vars copies a whitelisted var from main's .env into the worktree's .env", async () => {
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
    // The command is a no-op unless the worktree already has an .env to patch
    // (it never creates one). Seed an empty .env so it has a target.
    await Deno.writeTextFile(join(wt, ".env"), "");

    const r = await runAgent(wt, ["inherit-main-env-vars"]);
    assertEquals(r.code, 0, r.output);

    const wtEnv = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(wtEnv, "FOO=bar");
  });
});

Deno.test("inherit-main-env-vars creates the worktree env file when absent", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "noenv");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig('\n[worktree]\ninherit_env = ["FOO"]'),
    );
    await Deno.writeTextFile(join(dir, ".env"), "FOO=bar\n");
    // A fresh worktree has no env file — the declared value must still arrive.

    const r = await runAgent(wt, ["inherit-main-env-vars"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "FOO=bar",
      `the declared value must arrive in a created env file\n${r.output}`,
    );
  });
});

// ── with-gotchas — the failure pointer + exit-code passthrough ──────────────
//
// `done` and `with-gotchas` both print the same "a gate step failed" pointer.
// Here we drive the wrapper directly: a failing command must surface the pointer
// AND propagate the command's own exit code (the wrapper deliberately omits
// `set -e` so it observes the failure rather than dying on it).

Deno.test("with-gotchas prints the failure pointer and propagates the command's exit code", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // gotchas_doc unset → the pointer takes its "record the fix" wording.
    await writeConfig(
      dir,
      ["[project]", 'slug = "engine-test"', 'gotchas_doc = ""', ""].join("\n"),
    );

    // Wrap a command that exits 3: the wrapper must re-exit 3 and print the
    // banner that names a failed gate step.
    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 3"]);
    assertEquals(r.code, 3, r.output);
    assertTerminalTextIncludes(r.output, "a gate step failed");
    assertStringIncludes(r.output, "gotchas_doc");
  });
});

Deno.test("with-gotchas stays silent and returns 0 when the wrapped command succeeds", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 0"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      r.output.includes("a gate step failed"),
      false,
      `the pointer must not appear on success\n${r.output}`,
    );
  });
});

Deno.test("with-gotchas keeps the configured path when the gotchas doc is outside the map", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A configured doc switches the pointer to the "it's written down here" path,
    // resolving the doc against the project root.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "docs/GOTCHAS.md"',
        "",
      ]
        .join("\n"),
    );

    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 1"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "a gate step failed");
    assertStringIncludes(r.output, "docs/GOTCHAS.md");
    assert(
      !r.output.includes("discern map"),
      `an out-of-map doc must keep the path fallback\n${r.output}`,
    );
  });
});

Deno.test("with-gotchas prints the canonical map fetch for an in-map doc", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "knowledge/80-development/gate-notes.md"',
        "",
        "[map]",
        'dir = "knowledge/"',
        "",
      ].join("\n"),
    );

    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 1"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "a gate step failed");
    assertTerminalTextIncludes(
      r.output,
      "`discern map 80-development/gate-notes --json`",
    );
  });
});
