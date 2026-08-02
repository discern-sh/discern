/**
 * The unchanged-tree rerun precondition on `done`. A completed gate run
 * records what it judged (the last-run marker); asking `done` to re-run on
 * that exact tree without `--confirmed` refuses read-only, with a
 * verdict-specific recovery: a red tree deserves a fix (or a deliberate,
 * recorded flake probe), a green tree already stands and `status` shows the
 * receipt. Any change to the tree — a commit, an edit — runs the gate
 * normally, and so does `--dry-run`; the precondition guards only the
 * literal-rerun case where the verdict is already known.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
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
import { UNCHANGED_TREE_RERUN_SLUG } from "../src/engine/gate/receipt.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** Parse the JSON text. */
// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

const GREEN_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "echo rerun-gate-ok"',
  "",
].join("\n");

const CHECKED_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "sh check.sh"',
  "",
].join("\n");

const CHECK_FAILS = ["#!/usr/bin/env sh", "exit 1", ""].join("\n");

/** Scaffold main + a worktree carrying one committed change, gate per `config`. */
async function worktreeWithWork(
  dir: string,
  config: string,
  check?: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  if (check !== undefined) {
    await writeExecutable(join(dir, "check.sh"), check);
  }
  await gitInit(dir);
  const wt = await addWorktree(dir, "rerun");
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
  return wt;
}

Deno.test("done: an unchanged tree the gate judged RED refuses a bare rerun, and --confirmed re-runs it", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, CHECKED_CONFIG, CHECK_FAILS);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 1, first.output);
    const firstEnv = parseJson(first.stdout);
    assertEquals(firstEnv.data.failed_stage, "check/test");

    // The bare rerun refuses: same exit code, but a refusal envelope — no
    // steps ran, the slug names the class, and the red-verdict hint carries
    // the recovery (fix it, or probe deliberately).
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 1, rerun.output);
    const env = parseJson(rerun.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.error, UNCHANGED_TREE_RERUN_SLUG);
    assertEquals(env.steps, undefined, "a refusal must run nothing");
    assertStringIncludes(env.message, "--confirmed");
    assertHasHint(env, HINTS["done-unchanged-tree-red"]);

    // The attestation re-runs the real gate: the verdict is red again with the
    // job's own diagnostics, not a refusal.
    const probed = await runAgent(wt, ["done", "--confirmed", "--json"]);
    assertEquals(probed.code, 1, probed.output);
    const probedEnv = parseJson(probed.stdout);
    assertEquals(probedEnv.error, undefined);
    assertEquals(probedEnv.data.failed_stage, "check/test");
  });
});

Deno.test("done: an unchanged tree the gate judged GREEN refuses a bare rerun toward status", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);

    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 1, rerun.output);
    const env = parseJson(rerun.stdout);
    assertEquals(env.error, UNCHANGED_TREE_RERUN_SLUG);
    assertHasHint(env, HINTS["done-unchanged-tree-green"]);

    // The confirmed rerun is green exactly as before, receipt included.
    const again = await runAgent(wt, ["done", "--confirmed", "--json"]);
    assertEquals(again.code, 0, again.output);
    assertEquals(parseJson(again.stdout).data.gate_receipt.status, "recorded");
  });
});

Deno.test("done: any change to the tree runs the gate normally — commit, edit, or a dirty-tree edit", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // An uncommitted edit is a different tree: no refusal.
    await Deno.writeTextFile(join(wt, "feature.txt"), "revised work\n");
    const dirty = await runAgent(wt, ["done", "--json"]);
    assertEquals(dirty.code, 0, dirty.output);
    assertEquals(parseJson(dirty.stdout).error, undefined);

    // The same dirty tree unchanged IS a rerun: dirty identity counts too.
    const dirtyRerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(parseJson(dirtyRerun.stdout).error, UNCHANGED_TREE_RERUN_SLUG);

    // Committing moves the identity again: no refusal.
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feat: revise", "--no-gpg-sign");
    const committed = await runAgent(wt, ["done", "--json"]);
    assertEquals(committed.code, 0, committed.output);
    assertEquals(parseJson(committed.stdout).error, undefined);
  });
});

Deno.test("done: --dry-run never refuses, and never counts as the previous run", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // Previewing the plan on the judged tree is read-only and always allowed…
    const preview = await runAgent(wt, ["done", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(parseJson(preview.stdout).error, undefined);

    // …and does not overwrite what the last REAL run judged: the bare rerun
    // still refuses afterward.
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(parseJson(rerun.stdout).error, UNCHANGED_TREE_RERUN_SLUG);
  });
});

Deno.test("done: the refusal reaches the in-process entry point the MCP server calls", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    const refused = await finishResult(wt);
    assertEquals(refused.ok, false);
    assertEquals(refused.error, UNCHANGED_TREE_RERUN_SLUG);

    const confirmed = await finishResult(wt, { confirmed: true });
    assertEquals(confirmed.ok, true, JSON.stringify(confirmed));
  });
});

Deno.test("done: the last-run marker lives in the worktree's git admin dir and a broken marker fails open", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    const markerPath = await gitAdminStatePath(wt, "lastGateRun");
    assert(markerPath !== undefined, "the marker path must resolve");
    const marker = JSON.parse(await Deno.readTextFile(markerPath));
    assertEquals(marker.passed, true);
    assertEquals(marker.head, (await gitOut(wt, "rev-parse", "HEAD")).trim());

    // A corrupt marker must never block the gate: the rerun runs normally.
    await Deno.writeTextFile(markerPath, "not json\n");
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    assertEquals(parseJson(rerun.stdout).error, undefined);
  });
});
