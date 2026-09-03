/**
 * CLI tests for `upgrade`'s clean-tree guard (ADR 0014). An upgrade must stay
 * revertible with `git checkout`, so it refuses a tree with uncommitted
 * *tracked* changes unless `--allow-dirty`. Untracked files are ignored, and a
 * non-repo proceeds (no net to offer). These need a real git repo, so they live
 * apart from the other upgrade tests.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** Run a git command in `dir`, throwing on failure. */
async function git(dir: string, ...args: string[]): Promise<void> {
  const r = await new Deno.Command("git", {
    args,
    cwd: dir,
    stdout: "null",
    stderr: "null",
  }).output();
  if (!r.success) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
}

/** A fresh install committed into a new git repo — a clean starting tree. */
async function initCommittedRepo(dir: string): Promise<void> {
  assertEquals(
    (await runCli(
      ["setup", "begin", "--confirmed", "--slug", "demo"],
      dir,
    ))
      .code,
    0,
  );
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "initial");
}

Deno.test("upgrade proceeds on a clean tree", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(decodeCliResult(r.stdout, "upgrade").ok, true);
  });
});

Deno.test("upgrade refuses a tree with uncommitted tracked changes", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    // Dirty a tracked file.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(
        join(dir, "discern.toml"),
      )}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "dirty_worktree");
    assertResultDataKey(res, "changes");
    assertExists(res.data.changes);
    assert(
      res.data.changes.some((c: string) => c.includes("discern.toml")),
      "the dirty file should be listed",
    );
  });
});

Deno.test("upgrade --allow-dirty overrides the guard", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(
        join(dir, "discern.toml"),
      )}\n# local edit\n`,
    );
    const r = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(decodeCliResult(r.stdout, "upgrade").ok, true);
  });
});

Deno.test("upgrade ignores untracked files (they don't block recovery)", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    // An untracked scratch file is not a tracked-change → tree counts as clean.
    await Deno.writeTextFile(join(dir, "scratch.txt"), "notes\n");
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(decodeCliResult(r.stdout, "upgrade").ok, true);
  });
});

Deno.test("upgrade --check is never blocked by a dirty tree", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(
        join(dir, "discern.toml"),
      )}\n# local edit\n`,
    );
    // --check writes nothing, so the guard does not apply: it reports sync state.
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(decodeCliResult(r.stdout, "upgrade").ok, true);
  });
});
