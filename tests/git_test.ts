/**
 * Unit tests for {@link worktreeState} — the `git status --porcelain` reader that
 * decides whether an upgrade stays trivially revertible (ADR 0014).
 *
 * The three outcomes are pinned end to end:
 *   - `clean`      — a committed repo with no tracked changes.
 *   - `dirty`      — a tracked modification surfaces in `changes`; an *untracked*
 *                    file alone must NOT make it dirty (the `??` filter).
 *   - `not-a-repo` — both ways in: a directory that is not a repo (git exits
 *                    non-zero), and a `git` binary that cannot be spawned at all
 *                    (the catch), neither of which may throw.
 *
 * To keep the real repos hermetic, each call forwards `GIT_CONFIG_GLOBAL`/
 * `GIT_CONFIG_SYSTEM` (and disables signing via repo-local config) straight to
 * the git subprocess through worktreeState's `env` — so the developer's global
 * git settings can't leak in, and the test never mutates the process env (which
 * would race across files under `deno test --parallel`).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { type WorktreeState, worktreeState } from "../src/lib/git.ts";
import { withTempDir } from "./helpers.ts";

const DEVNULL = "/dev/null";

/** Git-isolation env, forwarded to every git spawn so the developer's global/
 * system git config can't leak in — set on the child, never on the process. */
const GIT_ISOLATION: Record<string, string> = {
  GIT_CONFIG_GLOBAL: DEVNULL,
  GIT_CONFIG_SYSTEM: DEVNULL,
  GIT_TERMINAL_PROMPT: "0",
};

/** Run a hermetic git command in `dir`; throw on failure. */
async function git(dir: string, ...args: string[]): Promise<void> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: GIT_ISOLATION,
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await c.output();
  if (!success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

/** Make `dir` a hermetic repo with one commit (a tracked `file.txt`). */
async function initRepo(dir: string): Promise<void> {
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(join(dir, "file.txt"), "original\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "init", "--no-gpg-sign");
  await git(dir, "branch", "-M", "main");
}

/**
 * Call `worktreeState(dir)` with the git-isolation env forwarded to its git
 * subprocess, so the inherited-env spawn stays hermetic without touching the
 * process env.
 */
async function isolatedState(dir: string): Promise<WorktreeState> {
  return await worktreeState(dir, { env: GIT_ISOLATION });
}

Deno.test("a freshly-committed repo reports clean", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    assertEquals(await isolatedState(dir), { kind: "clean" });
  });
});

Deno.test("a tracked modification reports dirty with the porcelain line", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await Deno.writeTextFile(join(dir, "file.txt"), "changed\n");
    const state = await isolatedState(dir);
    assertEquals(state.kind, "dirty");
    assert(state.kind === "dirty");
    assertEquals(state.changes.length, 1);
    const change = state.changes[0];
    assertExists(change);
    // Porcelain marks a tracked, unstaged content change as ` M <path>`.
    assert(
      change.includes("file.txt"),
      `expected the change to name file.txt, got: ${change}`,
    );
    assert(
      change.trimStart().startsWith("M"),
      `expected a modified marker, got: ${change}`,
    );
  });
});

Deno.test("a staged new file reports dirty", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await Deno.writeTextFile(join(dir, "added.txt"), "new\n");
    await git(dir, "add", "added.txt");
    const state = await isolatedState(dir);
    assertEquals(state.kind, "dirty");
    assert(state.kind === "dirty");
    assert(state.changes.some((c) => c.includes("added.txt")));
  });
});

Deno.test("an untracked file alone does NOT count as dirty (?? is filtered)", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    // Present but never `git add`-ed: porcelain reports it as "?? scratch.txt".
    await Deno.writeTextFile(join(dir, "scratch.txt"), "scratch\n");
    assertEquals(await isolatedState(dir), { kind: "clean" });
  });
});

Deno.test("a non-repository directory reports not-a-repo (git exits non-zero)", async () => {
  await withTempDir(async (dir) => {
    // No `git init` here, so `git status` fails with a non-zero code.
    assertEquals(await isolatedState(dir), { kind: "not-a-repo" });
  });
});

Deno.test("an unrunnable git binary reports not-a-repo, never throwing (catch branch)", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (emptyBin) => {
      // An empty PATH for the child makes spawning `git` raise NotFound, which
      // worktreeState must swallow into not-a-repo rather than rethrow. Injected
      // as the git spawn's env so the process PATH is never mutated (parallel-safe).
      assertEquals(
        await worktreeState(dir, { env: { PATH: emptyBin } }),
        { kind: "not-a-repo" },
      );
    });
  });
});
