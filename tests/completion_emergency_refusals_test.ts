/**
 * The emergency subject is observed read-only before any exchange: each
 * precondition — the repair's checkout, its containment of actual trunk, the
 * main checkout's state, policy limits, and the existence of anything to
 * except — refuses with its own recovery sentence, and nothing lands.
 */

import { join } from "@std/path";
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

/** A gate whose one check passes while `taboo.txt` is absent. */
const CONFIG_CHECK = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
].join("\n");

/** Run `accept emergency` and return the refusal message. */
async function refusal(cwd: string, ...args: string[]): Promise<string> {
  const run = await runAgent(cwd, ["accept", "emergency", ...args, "--json"]);
  assertEquals(run.code, 1, run.output);
  return decodeCliResult(run.stdout, "accept").message ?? "";
}

Deno.test("each emergency precondition refuses with its own recovery sentence and lands nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_CHECK);
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);

    // The exchange runs only from the repair's recorded worktree.
    assertStringIncludes(
      await refusal(dir, "--reason", "Restore service"),
      "Prepare this emergency in the repair's recorded worktree. Use --recover from a surviving checkout for an interrupted landing.",
    );

    const wt = await addWorktree(dir, "repair");
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "fix: repair", "--no-gpg-sign");

    // The owner needs a concrete reason before anything is observed.
    assertStringIncludes(
      await refusal(wt),
      "Give the owner a concrete emergency reason with --reason.",
    );

    // Uncommitted work in the repair is preserved, never integrated blind.
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "uncommitted edit\n");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "The repair has uncommitted changes. Preserve and commit the reviewed source before preparing the emergency.",
    );
    await git(wt, "checkout", "--", "hotfix.txt");

    // An interrupted sequencer (a crashed cherry-pick's marker, tree clean)
    // stops the review until the operation is resolved.
    const marker = join(
      await gitOut(wt, "rev-parse", "--absolute-git-dir"),
      "CHERRY_PICK_HEAD",
    );
    await Deno.writeTextFile(
      marker,
      `${await gitOut(wt, "rev-parse", "HEAD")}\n`,
    );
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "Resolve the repair checkout's active Git operation before preparing the emergency.",
    );
    await Deno.remove(marker);

    // A repair that lacks actual trunk must update first.
    await Deno.writeTextFile(join(dir, "hotfix.txt"), "trunk version\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "trunk change", "--no-gpg-sign");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "The repair must contain actual trunk. Run discern update in this worktree, review and commit its result, then prepare a new emergency plan.",
    );

    // A source with nothing beyond the trunk has nothing to except.
    const green = await addWorktree(dir, "green");
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "This source is already on trunk. Use discern done to validate its current obligations.",
    );

    // The main checkout must be restored before any review.
    await Deno.writeTextFile(join(green, "green.txt"), "safe change\n");
    await git(green, "add", "-A");
    await git(green, "commit", "-q", "-m", "safe change", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "hotfix.txt"), "dirtied main\n");
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "Restore the main checkout to its configured trunk with clean tracked files and no active Git operation before reviewing emergency integration. Preserve all local work.",
    );
    await git(dir, "checkout", "--", "hotfix.txt");

    // With every machine obligation green there is no exception to approve.
    const done = await runAgent(green, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "Every configured machine obligation has current passing evidence. Use discern done, then discern accept for ordinary landing.",
    );

    // Nothing landed anywhere along the way.
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      await gitOut(dir, "rev-parse", "HEAD"),
    );
  });
});

Deno.test("a repair that weakens a protected standard limit cannot use the emergency route", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        CONFIG_CHECK,
        "[standards.hotspots]",
        'direction = "down"',
        "limit = 5",
        'run = "echo 3"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "loosen");
    const config = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      config.replace("limit = 5", "limit = 50"),
    );
    await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "loosen the limit", "--no-gpg-sign");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "The repair changes protected policy or standard limits without valid approval. Emergency integration cannot weaken ordinary policy; resolve those changes before preparing its plan.",
    );
  });
});
