/**
 * Tests for the commit an upgrade makes of its own changes. A tree the
 * clean-tree guard accepted holds only the upgrade's diff afterwards, so
 * discern commits exactly that. `--allow-dirty`, a directory outside Git, and
 * a commit Git refuses each leave the upgraded files for the owner, and none
 * of them undoes the upgrade.
 *
 * Every case starts from the same state: a committed install whose adoption
 * is still pending. One scaffold seeds them all, and each case consumes that
 * pending adoption in its own copy.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { captureUpgrade } from "./fixtures/upgrade_capture.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { HINTS } from "../src/shared/hints.ts";
import { type CliResult, runCli } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  type PooledInstallCase,
  withPristineInstalls,
} from "./engine_surface_fixture.ts";

/** A fresh install committed into a new git repo, with adoption still pending. */
async function initCommittedRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Upgrade fixture\n");
  await gitInit(dir);
  assertEquals(
    (await runCli(["setup", "begin", "--confirmed", "--slug", "demo"], dir))
      .code,
    0,
  );
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "install discern");
}

/** Decode an applied upgrade and return the commit outcome it reported. */
function commitOutcome(run: CliResult): {
  state?: string;
  head?: string | undefined;
  paths?: string[] | undefined;
  reason?: string | undefined;
} {
  const result = decodeCliResult(run, "upgrade");
  assertEquals(result.ok, true, run.stdout);
  assertResultDataKey(result, "commit");
  return result.data.commit ?? {};
}

/** The paths one commit changed, sorted as the result reports them. */
async function committedPaths(dir: string, rev: string): Promise<string[]> {
  const out = await gitOut(
    dir,
    "show",
    "--name-only",
    "--no-renames",
    "--format=",
    rev,
  );
  return out.split("\n").filter((line) => line !== "").sort();
}

/** Make every commit in this repository fail with one recognizable line. */
async function refuseCommits(dir: string): Promise<void> {
  const hook = join(dir, ".git", "hooks", "pre-commit");
  await Deno.mkdir(join(dir, ".git", "hooks"), { recursive: true });
  await Deno.writeTextFile(
    hook,
    '#!/bin/sh\necho "error: policy says no" >&2\nexit 1\n',
  );
  await Deno.chmod(hook, 0o755);
}

const CASES: readonly PooledInstallCase[] = [
  [
    "a clean tree gets exactly the upgrade's changes, and a current one gets no commit",
    async (dir) => {
      // An untracked file that predates the upgrade stays the owner's.
      await Deno.writeTextFile(join(dir, "scratch.txt"), "notes\n");
      const before = await gitOut(dir, "rev-parse", "HEAD");

      const run = await runCli(["upgrade", "--json"], dir);
      assertEquals(run.code, 0, run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "committed");
      assert(commit.paths?.includes("discern.toml"), run.stdout);

      const head = await gitOut(dir, "rev-parse", "HEAD");
      assertEquals(commit.head, head);
      assertEquals(await gitOut(dir, "rev-parse", "HEAD~1"), before);
      assertEquals(await committedPaths(dir, head), commit.paths);
      assertEquals(
        await gitOut(dir, "status", "--porcelain"),
        "?? scratch.txt",
      );

      const message = await gitOut(dir, "log", "-1", "--format=%B");
      assert(
        message.startsWith("Upgrade discern's managed files to "),
        message,
      );
      assert(message.endsWith(DISCERN_MACHINE.trailer), message);
      assertLacksHint(
        decodeCliResult(run, "upgrade"),
        HINTS["upgrade-commit-pending"],
      );

      // The install is now current: a second upgrade has nothing to commit.
      const again = await runCli(["upgrade", "--json"], dir);
      assertEquals(again.code, 0, again.stderr);
      assertEquals(commitOutcome(again), { state: "unchanged" });
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), head);
    },
  ],
  [
    "--allow-dirty leaves the changes for the owner to commit",
    async (dir) => {
      const before = await gitOut(dir, "rev-parse", "HEAD");

      const run = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
      assertEquals(run.code, 0, run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "uncommitted");
      assertStringIncludes(commit.reason ?? "", "--allow-dirty");
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
      assertStringIncludes(
        await gitOut(dir, "status", "--porcelain"),
        "discern.toml",
      );
    },
  ],
  [
    "a commit Git refuses keeps the upgrade and names what is left",
    async (dir) => {
      await refuseCommits(dir);
      const before = await gitOut(dir, "rev-parse", "HEAD");

      const run = await runCli(["upgrade", "--json"], dir);
      assertEquals(run.code, 0, run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "failed");
      assertEquals(commit.reason, "error: policy says no");
      assert(commit.paths?.includes("discern.toml"), run.stdout);
      assertHasHint(
        decodeCliResult(run, "upgrade"),
        HINTS["upgrade-commit-pending"],
      );

      // The upgrade stands: nothing was committed and nothing was rolled back.
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
      assertStringIncludes(
        await Deno.readTextFile(join(dir, "discern.toml")),
        "managed_version",
      );
    },
  ],
  [
    "a detached HEAD has no branch to commit to",
    async (dir) => {
      await git(dir, "checkout", "--detach");
      const before = await gitOut(dir, "rev-parse", "HEAD");

      const run = await runCli(["upgrade", "--json"], dir);
      assertEquals(run.code, 0, run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "failed");
      assertStringIncludes(commit.reason ?? "", "detached");
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
    },
  ],
  [
    "a directory outside Git has nowhere to commit",
    async (dir) => {
      await Deno.remove(join(dir, ".git"), { recursive: true });

      const run = await runCli(["upgrade", "--json"], dir);
      assertEquals(run.code, 0, run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "uncommitted");
      assertStringIncludes(commit.reason ?? "", "not a Git repository");
    },
  ],
  [
    "files a migration creates, rewrites, and removes are carried",
    async (dir) => {
      await Deno.writeTextFile(join(dir, "retired.txt"), "old\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-m", "add a file the migration retires");
      await Deno.writeTextFile(join(dir, "scratch.txt"), "notes\n");
      const registry: Migration[] = [{
        from: SCHEMA_VERSION,
        describe: "reshape the fixture",
        apply: async (ctx) => {
          await ctx.writeText("migrated/created.txt", "new\n");
          await ctx.rewrite("README.md", (text) => `${text}\nmigrated\n`);
          await ctx.remove("retired.txt");
        },
      }];

      const run = await captureUpgrade(dir, { registry, allowDirty: false });
      assertEquals(run.code, 0, run.stdout + run.stderr);
      const commit = commitOutcome(run);
      assertEquals(commit.state, "committed");
      for (
        const path of [
          "README.md",
          "discern.toml",
          "migrated/created.txt",
          "retired.txt",
        ]
      ) {
        assert(commit.paths?.includes(path), `${path} missing: ${run.stdout}`);
      }
      assertEquals(await committedPaths(dir, "HEAD"), commit.paths);
      assertEquals(
        await gitOut(dir, "status", "--porcelain"),
        "?? scratch.txt",
      );
      assertStringIncludes(
        await gitOut(dir, "log", "-1", "--format=%B"),
        `Config migrations applied:\n- ${SCHEMA_VERSION}→${
          SCHEMA_VERSION + 1
        }: reshape the fixture`,
      );
    },
  ],
];

Deno.test("upgrade commits its own changes on a tree it found clean", async (t) => {
  await withPristineInstalls(t, initCommittedRepo, CASES);
});
