/**
 * The worktree-viability probe core (ADR 0090) — `probeWorktreeViability` mints a
 * THROWAWAY worktree from the main checkout's HEAD, runs a caller-supplied probe
 * inside it, and tears it down unconditionally (win or lose). This is the engine
 * primitive `setup done`'s completion proof leans on; the CLI-level coverage (a real
 * `setup done` creating and destroying a probe) lives in `engine_setup_test.ts`.
 *
 * These drive the core in-process with a FAKE probe callback, so the create → run →
 * teardown machinery and its outcome classification are proven without a real gate:
 * a viable probe, a probe whose callback fails, a worktree whose own setup step fails
 * (setup_failed), and an unborn branch that cannot be probed at all (uncreatable).
 */

import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  gitOut,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { basename, join, resolve } from "@std/path";
import { Logger } from "../src/lib/log.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import {
  type LifecycleContext,
  lifecycleContext,
  probeWorktreeViability,
} from "../src/engine/worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";
import { spawnJob } from "../src/engine/jobs/command.ts";
import { realDelay, waitUntil } from "./waiting.ts";

/** A quiet lifecycle context rooted at the main checkout `dir`. */
async function ctxAt(dir: string): Promise<LifecycleContext> {
  return await lifecycleContext(dir, new Logger({ json: true, noColor: true }));
}

/** The configured worktree root for `dir` (the sibling `<dir>.worktrees`). */
async function worktreeRootFor(dir: string): Promise<string> {
  return resolveWorktreeRoot(dir, await loadConfig(dir));
}

/** Assert a retired path is genuinely absent; only NotFound means absent. */
async function assertPathAbsent(path: string): Promise<void> {
  if (await lstatIfExists(path) === undefined) return;
  throw new Error(`a retired probe path still exists: ${path}`);
}

/** Assert every trace of the probe is gone: path, Git record, and branch. */
async function assertNoProbeRemains(
  dir: string,
  probeDir?: string,
): Promise<void> {
  if (probeDir !== undefined) await assertPathAbsent(probeDir);
  const worktrees = await gitOut(dir, "worktree", "list", "--porcelain");
  assert(
    !worktrees.includes(".worktrees"),
    `a probe worktree was left registered:\n${worktrees}`,
  );
  const branches = await gitOut(dir, "branch", "--list", "agent/*");
  assertEquals(
    branches.trim(),
    "",
    `a probe branch was left behind:\n${branches}`,
  );
}

Deno.test("probeWorktreeViability: a viable worktree is probed ok and torn down", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    let sawProbeDir = "";
    const outcome = await probeWorktreeViability(
      await ctxAt(dir),
      await worktreeRootFor(dir),
      (probeDir) => {
        sawProbeDir = probeDir;
        return Promise.resolve({ ok: true });
      },
    );

    assertEquals(outcome.kind, "probed");
    assert(outcome.kind === "probed" && outcome.ok === true);
    // The probe genuinely ran inside a real, readied worktree (not the main checkout).
    assert(
      sawProbeDir.includes(".worktrees"),
      `the probe ran in ${sawProbeDir}, not a linked worktree`,
    );
    await assertNoProbeRemains(dir, sawProbeDir);
  });
});

Deno.test({
  name:
    "probeWorktreeViability: a command-owned late writer cannot follow a successful teardown",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);

      let probeDir = "";
      const outcome = await probeWorktreeViability(
        await ctxAt(dir),
        await worktreeRootFor(dir),
        async (createdDir) => {
          probeDir = createdDir;
          const spawned = await spawnJob(
            {
              label: "late-writer",
              command:
                '(sleep 0.15; mkdir -p "$LATE_TARGET/observer-state/nested") >/dev/null 2>&1 &',
            },
            {
              cwd: createdDir,
              env: { LATE_TARGET: createdDir },
              stream: false,
              write: () => {},
            },
          );
          assertEquals(spawned.result.status, "ok");
          return { ok: true };
        },
      );

      assert(outcome.kind === "probed" && outcome.ok === true);
      // Give the escaped writer time to run after the probe's removal. A success
      // verdict is valid only if the command boundary first quiesced its group.
      await realDelay("worktree-probe-job-quiescence-window", 350);
      await assertNoProbeRemains(dir, probeDir);
    });
  },
});

Deno.test({
  name:
    "probeWorktreeViability: a backgrounded Git hook is quiesced before teardown",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const hook = join(dir, ".git", "hooks", "post-checkout");
      await Deno.writeTextFile(
        hook,
        [
          "#!/bin/sh",
          '(sleep 0.2; mkdir -p "$PWD/hook-late/nested") >/dev/null 2>&1 &',
          "",
        ].join("\n"),
      );
      await Deno.chmod(hook, 0o700);

      let probeDir = "";
      const outcome = await probeWorktreeViability(
        await ctxAt(dir),
        await worktreeRootFor(dir),
        (createdDir) => {
          probeDir = createdDir;
          return Promise.resolve({ ok: true });
        },
      );

      assert(outcome.kind === "probed" && outcome.ok === true);
      await realDelay("worktree-probe-hook-quiescence-window", 400);
      await assertNoProbeRemains(dir, probeDir);
    });
  },
});

Deno.test({
  name:
    "probeWorktreeViability: incomplete teardown is a red outcome with recoverable state",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
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

      let probeDir = "";
      let announceCreated: (() => void) | undefined;
      const created = new Promise<void>((resolveCreated) => {
        announceCreated = resolveCreated;
      });
      const probing = probeWorktreeViability(
        await ctxAt(dir),
        await worktreeRootFor(dir),
        (createdDir) => {
          probeDir = createdDir;
          announceCreated?.();
          return Promise.resolve({ ok: true });
        },
      );

      try {
        await created;
        await waitUntil(
          async () => {
            try {
              await Deno.lstat(probeDir);
              return false;
            } catch (error) {
              if (error instanceof Deno.errors.NotFound) return true;
              throw error;
            }
          },
          "probe teardown to reach its final verification",
        );
        await Deno.mkdir(join(probeDir, "replacement", "nested"), {
          recursive: true,
        });
      } finally {
        evidenceLock.close();
      }

      const outcome = await probing;
      assertEquals(outcome.kind, "setup_failed");
      assert(
        outcome.kind === "setup_failed" &&
          outcome.reason.includes("teardown did not complete"),
        JSON.stringify(outcome),
      );
      assert(
        await Deno.lstat(join(probeDir, "replacement", "nested")),
        "the replacement must be preserved for inspection",
      );
      const registrations = await gitOut(
        dir,
        "worktree",
        "list",
        "--porcelain",
      );
      assert(
        !registrations.includes(probeDir),
        "Git registration should report the independently completed half",
      );
      const probeBranch = `agent/${basename(probeDir)}`;
      assert(
        (await gitOut(dir, "branch", "--list", probeBranch)).includes(
          probeBranch,
        ),
        "a failed teardown must retain its branch",
      );

      await Deno.remove(probeDir, { recursive: true });
      await git(dir, "branch", "-D", probeBranch);
    });
  },
});

Deno.test("probeWorktreeViability: a failing probe callback is reported, and the worktree is still torn down", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const outcome = await probeWorktreeViability(
      await ctxAt(dir),
      await worktreeRootFor(dir),
      () =>
        Promise.resolve({ ok: false, detail: "the gate was red in the copy" }),
    );

    assert(outcome.kind === "probed" && outcome.ok === false);
    assertEquals(outcome.detail, "the gate was red in the copy");
    // A red probe must not strand its worktree.
    await assertNoProbeRemains(dir);
  });
});

Deno.test("probeWorktreeViability: a worktree setup step that fails yields setup_failed (and tears down)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A one-shot setup step that exits non-zero is fatal at fresh creation — the app
    // cannot ready itself in a copy, which is exactly what the probe exists to catch.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "probe-test"',
        "",
        "[worktree.setup]",
        'steps = ["exit 7"]',
      ].join("\n"),
    );
    await gitInit(dir);

    let probeRan = false;
    const outcome = await probeWorktreeViability(
      await ctxAt(dir),
      await worktreeRootFor(dir),
      () => {
        probeRan = true;
        return Promise.resolve({ ok: true });
      },
    );

    assertEquals(outcome.kind, "setup_failed");
    assert(!probeRan, "the probe callback must not run once setup has failed");
    await assertNoProbeRemains(dir);
  });
});

Deno.test("probeWorktreeViability: an unborn branch is uncreatable, not a red (a skip)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A git repo with NO commit yet — `git worktree add` cannot branch from an unborn
    // HEAD. That is a legitimate skip (nothing to fault the app for), never a red.
    await gitInit(dir);
    await gitOut(dir, "checkout", "--orphan", "unborn");
    await gitOut(dir, "reset");

    const outcome = await probeWorktreeViability(
      await ctxAt(dir),
      await worktreeRootFor(dir),
      () => Promise.resolve({ ok: true }),
    );

    assertEquals(outcome.kind, "uncreatable");
  });
});
