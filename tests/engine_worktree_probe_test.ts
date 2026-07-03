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
  gitInit,
  gitOut,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { Logger } from "../src/lib/log.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  type LifecycleContext,
  lifecycleContext,
  probeWorktreeViability,
} from "../src/engine/worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";

/** A quiet lifecycle context rooted at the main checkout `dir`. */
async function ctxAt(dir: string): Promise<LifecycleContext> {
  return await lifecycleContext(dir, new Logger({ json: true, noColor: true }));
}

/** The configured worktree root for `dir` (the sibling `<dir>.worktrees`). */
async function worktreeRootFor(dir: string): Promise<string> {
  return resolveWorktreeRoot(dir, await loadConfig(dir));
}

/** Assert every trace of the probe is gone: no linked worktree, no `agent/` branch. */
async function assertNoProbeRemains(dir: string): Promise<void> {
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
    await assertNoProbeRemains(dir);
  });
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
