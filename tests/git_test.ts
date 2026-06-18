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
 * `worktreeState` inherits the process environment, so to keep the real repos
 * hermetic we set `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` (and disable signing via
 * repo-local config) for the duration of each call and restore them after — the
 * developer's global git settings can neither leak in nor be mutated.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { worktreeState } from "../src/lib/git.ts";
import { withTempDir } from "./helpers.ts";

const DEVNULL = "/dev/null";

/** Run a hermetic git command in `dir`; throw on failure. */
async function git(dir: string, ...args: string[]): Promise<void> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: {
      GIT_CONFIG_GLOBAL: DEVNULL,
      GIT_CONFIG_SYSTEM: DEVNULL,
      GIT_TERMINAL_PROMPT: "0",
    },
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
 * Call `worktreeState(dir)` with the git-isolation env vars temporarily set in
 * the process environment (so the inherited-env subprocess stays hermetic),
 * restoring the prior values afterwards.
 */
async function isolatedState(dir: string) {
  const keys = [
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_TERMINAL_PROMPT",
  ];
  const saved = new Map(keys.map((k) => [k, Deno.env.get(k)]));
  Deno.env.set("GIT_CONFIG_GLOBAL", DEVNULL);
  Deno.env.set("GIT_CONFIG_SYSTEM", DEVNULL);
  Deno.env.set("GIT_TERMINAL_PROMPT", "0");
  try {
    return await worktreeState(dir);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
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
    // Porcelain marks a tracked, unstaged content change as ` M <path>`.
    assert(
      state.changes[0].includes("file.txt"),
      `expected the change to name file.txt, got: ${state.changes[0]}`,
    );
    assert(
      state.changes[0].trimStart().startsWith("M"),
      `expected a modified marker, got: ${state.changes[0]}`,
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
      // Point PATH at an empty directory so spawning `git` raises NotFound,
      // which worktreeState must swallow into not-a-repo rather than rethrow.
      const savedPath = Deno.env.get("PATH");
      Deno.env.set("PATH", emptyBin);
      try {
        assertEquals(await worktreeState(dir), { kind: "not-a-repo" });
      } finally {
        if (savedPath === undefined) Deno.env.delete("PATH");
        else Deno.env.set("PATH", savedPath);
      }
    });
  });
});
