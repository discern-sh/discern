/**
 * Engine coverage for the plan/apply surface (ADR 0027): `--dry-run` and the
 * serialized `--json` on every effectful verb. The pure planners are unit-tested
 * fast in `gate_plan_test.ts` / `worktree_plan_test.ts` / `standard_plan_test.ts`;
 * this drives the verbs end-to-end through the CLI so the dry-run renders, the
 * apply path narrates, and the JSON is a real serialization — the regression
 * guard for the new flags.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

// ── finish ──────────────────────────────────────────────────────────────────

Deno.test("done --dry-run lists the gate plan and runs nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        // A command that would fail IF it ran — dry-run must not run it.
        'lint = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--dry-run"]);
    assertEquals(r.code, 0, r.output); // dry-run never fails on a job
    assertTerminalTextIncludes(r.stdout, "GATE PLAN");
    assertStringIncludes(r.stdout, "lint");
  });
});

Deno.test("done --dry-run --json emits the plan, not a run report", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        'test = "true"',
        "",
      ]
        .join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    // A preview is a DiscernResult carrying only `plan` (no executed `steps`).
    assertEquals(obj.verb, "done");
    assertEquals(obj.steps, undefined);
    assert(obj.plan !== undefined);
    assertEquals(obj.plan.title, "Gate plan");
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "test"),
      r.stdout,
    );
  });
});

Deno.test("done classifies scopes AFTER the fix stage (a fixer's new file fires its scope gate)", async () => {
  // Regression guard for the scope-classification TIMING (ADR 0027): scopes are
  // classified from the working tree AFTER the fix stage runs, so a fix-stage
  // codemod that creates a file inside a scope makes that scope's gate fire. If
  // classification moved before the fix stage, the gate would be (wrongly) skipped
  // — running FEWER gates than the post-fix tree warrants, against fail-open.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        // The fixer creates an untracked file inside the `gen` scope.
        'format = "mkdir -p generated && touch generated/new.txt"',
        "",
        "[scopes.gen]",
        'paths = ["generated/**"]',
        'gate = "echo gen-gate-ran"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    assertResultDataKey(obj, "scopes_changed");
    assert(obj.steps !== undefined);
    assert(
      obj.data.scopes_changed.includes("gen"),
      `the fixer's new file should make 'gen' a changed scope\n${r.stdout}`,
    );
    const gen = obj.steps.find((s: { label: string }) =>
      s.label === "scope:gen"
    );
    assert(gen !== undefined);
    assertEquals(
      gen.outcome,
      "ok",
      "the gen scope gate must have fired and passed",
    );
  });
});

// ── standards ──────────────────────────────────────────────────────────────────

Deno.test("standards --dry-run lists the standard without measuring it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[standards.coverage]",
        'direction = "up"',
        "limit = 80",
        // Would emit a FAILING metric if it ran — dry-run must not run it.
        'run = "echo DISCERN_METRIC coverage 10"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["standards", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "Standards plan");
    assertStringIncludes(r.stdout, "coverage");

    const j = await runAgent(dir, ["standards", "--dry-run", "--json"]);
    assertEquals(j.code, 0, j.output);
    const obj = decodeCliResult(j.stdout, "standards");
    // A preview envelope: verb + plan, no executed steps.
    assertEquals(obj.verb, "standards");
    assertEquals(obj.steps, undefined);
    assert(obj.plan !== undefined);
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "coverage"),
    );
  });
});

Deno.test("standards --json serializes the held/failed results", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[standards.coverage]",
        'direction = "up"',
        "limit = 80",
        'run = "echo DISCERN_METRIC coverage 90"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["standards", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "standards");
    assertEquals(obj.ok, true);
    assert(obj.steps !== undefined);
    const cov = obj.steps.find((s: { label: string }) =>
      s.label === "coverage"
    );
    assert(cov !== undefined);
    assertEquals(cov.outcome, "ok");
    assertEquals(cov.kind, "standard");
  });
});

// ── worktree setup ─────────────────────────────────────────────────────────────

Deno.test("worktree setup --dry-run shows the setup plan; --json reports the steps", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "setup");

    const dry = await runAgent(wt, ["worktree", "setup", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.stdout, "Worktree setup plan");
    assertStringIncludes(dry.stdout, "ensure-branch");
    assertStringIncludes(dry.stdout, BUILT_IN_STEP_LABELS.completeRefresh);

    const json = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = decodeCliResult(json.stdout, "worktree setup"); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assert(obj.steps !== undefined);
    assert(
      obj.steps.some((s: { label: string }) =>
        s.label === BUILT_IN_STEP_LABELS.completeRefresh
      ),
      json.stdout,
    );
  });
});

// ── worktree teardown ───────────────────────────────────────────────────────

Deno.test("worktree teardown --dry-run and --json reflect the ledger", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "tear");
    const markers = join(dir, "markers");
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live"\n`,
    );
    // Setup writes the ledger entry teardown plans from.
    assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);

    // Dry-run lists the resource and destroys nothing.
    const dry = await runAgent(wt, ["worktree", "teardown", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.stdout, "Teardown plan");
    assertStringIncludes(dry.stdout, "thing");

    // Real teardown with --json reports the destroyed resource.
    const json = await runAgent(wt, ["worktree", "teardown", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = decodeCliResult(json.stdout, "worktree teardown");
    assertEquals(obj.ok, true);
    assert(obj.steps !== undefined);
    const thing = obj.steps.find((s: { label: string }) => s.label === "thing");
    assert(thing !== undefined);
    assertEquals(thing.outcome, "ok");
    assertEquals(thing.kind, "resource-destroy");
  });
});

// ── worktree prune ──────────────────────────────────────────────────────────

Deno.test("worktree prune --json on a clean pool reports ok with no steps", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["worktree", "prune", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "worktree prune");
    assertEquals(obj.ok, true);
    assertEquals(obj.steps, []);
  });
});

// ── accept ──────────────────────────────────────────────────────────────────

Deno.test("accept --dry-run shows the plan after the preconditions pass", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gradry");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "Acceptance plan");
    assertStringIncludes(r.stdout, "remove-worktree");
    // The worktree must still exist — dry-run mutates nothing.
    assertEquals(
      (await runAgent(wt, ["identity", "--branch"])).code,
      0,
      "dry-run must leave the worktree intact",
    );
  });
});

Deno.test("accept --json performs the acceptance and serializes the steps", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gradj");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "accept"); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assert(obj.steps !== undefined);
    assert(
      obj.steps.some(
        (s: { label: string }) => s.label === "fast-forward-trunk",
      ),
      r.stdout,
    );
    // The landing precedes resource teardown, so an acceptance that loses a
    // concurrent-landing race at the fast-forward leaves its worktree fully
    // intact — resources included — for the update → finish → accept
    // recovery the refusal prescribes.
    const labels = obj.steps.map((s: { label: string }) => s.label);
    assert(
      labels.indexOf("fast-forward-trunk") <
        labels.indexOf(BUILT_IN_STEP_LABELS.teardownResources),
      `the trunk must land before resources are torn down\n${r.stdout}`,
    );
    // The work landed on the trunk in main.
    assert(
      await import("../src/shared/fs_presence.ts").then((m) =>
        m.targetExists(join(dir, "feature.txt"))
      ),
      "work not landed on the trunk in main",
    );
  });
});

Deno.test("accept --json reports a precondition failure as a JSON error", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "graderr");
    // Dirty a tracked file in main so acceptance refuses.
    const toml = join(dir, "discern.toml");
    await Deno.writeTextFile(
      toml,
      `${await Deno.readTextFile(toml)}\n# dirty\n`,
    );

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "accept"); // the error is a JSON object, not a human line
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "accept");
    // error is a machine-stable slug; the human sentence rides in `message`.
    assertEquals(obj.error, "precondition_failed");
    assert(obj.message !== undefined);
    assertStringIncludes(obj.message, "uncommitted tracked changes");
  });
});
