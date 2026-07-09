/**
 * Engine coverage for the plan/apply surface (ADR 0027): `--dry-run` and the
 * serialized `--json` on every effectful verb. The pure planners are unit-tested
 * fast in `gate_plan_test.ts` / `worktree_plan_test.ts` / `ratchet_plan_test.ts`;
 * this drives the verbs end-to-end through the CLI so the dry-run renders, the
 * apply path narrates, and the JSON is a real serialization — the regression
 * guard for the new flags.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

// ── finish ──────────────────────────────────────────────────────────────────

Deno.test("finish --dry-run lists the gate plan and runs nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        // A command that would fail IF it ran — dry-run must not run it.
        'lint = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["finish", "--dry-run"]);
    assertEquals(r.code, 0, r.output); // dry-run never fails on a job
    assertStringIncludes(r.stdout, "Gate plan");
    assertStringIncludes(r.stdout, "lint");
  });
});

Deno.test("finish --dry-run --json emits the plan, not a run report", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'test = "true"',
        "",
      ]
        .join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["finish", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    // A preview is a DiscernResult carrying only `plan` (no executed `steps`).
    assertEquals(obj.verb, "finish");
    assertEquals(obj.steps, undefined);
    assertEquals(obj.plan.title, "Gate plan");
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "test"),
      r.stdout,
    );
  });
});

Deno.test("finish classifies scopes AFTER the fix stage (a fixer's new file fires its scope gate)", async () => {
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
        "[capabilities]",
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

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assert(
      obj.data.scopes_changed.includes("gen"),
      `the fixer's new file should make 'gen' a changed scope\n${r.stdout}`,
    );
    const gen = obj.steps.find((s: { label: string }) =>
      s.label === "scope:gen"
    );
    assertEquals(
      gen.outcome,
      "ok",
      "the gen scope gate must have fired and passed",
    );
  });
});

// ── ratchets ──────────────────────────────────────────────────────────────────

Deno.test("ratchets --dry-run lists the ratchet without measuring it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[ratchets.coverage]",
        'direction = "up"',
        "limit = 80",
        // Would emit a FAILING metric if it ran — dry-run must not run it.
        'run = "echo DISCERN_METRIC coverage 10"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["ratchets", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Ratchets plan");
    assertStringIncludes(r.stdout, "coverage");

    const j = await runAgent(dir, ["ratchets", "--dry-run", "--json"]);
    assertEquals(j.code, 0, j.output);
    const obj = parseJson(j.stdout);
    // A preview envelope: verb + plan, no executed steps.
    assertEquals(obj.verb, "ratchets");
    assertEquals(obj.steps, undefined);
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "coverage"),
    );
  });
});

Deno.test("ratchets --json serializes the held/failed results", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[ratchets.coverage]",
        'direction = "up"',
        "limit = 80",
        'run = "echo DISCERN_METRIC coverage 90"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["ratchets", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    const cov = obj.steps.find((s: { label: string }) =>
      s.label === "coverage"
    );
    assertEquals(cov.outcome, "ok");
    assertEquals(cov.kind, "ratchet");
  });
});

// ── worktree setup ─────────────────────────────────────────────────────────────

Deno.test("worktree setup --dry-run shows the setup plan; --json reports the steps", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "setup");

    const dry = await runAgent(wt, ["worktree", "setup", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.stdout, "Worktree setup plan");
    assertStringIncludes(dry.stdout, "ensure-branch");
    assertStringIncludes(dry.stdout, "refresh agent files");

    const json = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = parseJson(json.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assert(
      obj.steps.some((s: { label: string }) =>
        s.label === "refresh agent files"
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
    assertStringIncludes(dry.stdout, "Teardown plan");
    assertStringIncludes(dry.stdout, "thing");

    // Real teardown with --json reports the destroyed resource.
    const json = await runAgent(wt, ["worktree", "teardown", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = parseJson(json.stdout);
    assertEquals(obj.ok, true);
    const thing = obj.steps.find((s: { label: string }) => s.label === "thing");
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
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.steps, []);
  });
});

// ── graduate ──────────────────────────────────────────────────────────────────

Deno.test("graduate --dry-run shows the plan after the preconditions pass", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gradry");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Graduation plan");
    assertStringIncludes(r.stdout, "remove-worktree");
    // The worktree must still exist — dry-run mutates nothing.
    assertEquals(
      (await runAgent(wt, ["identity", "--branch"])).code,
      0,
      "dry-run must leave the worktree intact",
    );
  });
});

Deno.test("graduate --json performs the graduation and serializes the steps", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gradj");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assert(
      obj.steps.some(
        (s: { label: string }) => s.label === "fast-forward-trunk",
      ),
      r.stdout,
    );
    // The work landed on the trunk in main.
    assert(
      await import("@std/fs").then((m) => m.exists(join(dir, "feature.txt"))),
      "work not landed on the trunk in main",
    );
  });
});

Deno.test("graduate --json reports a precondition failure as a JSON error", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "graderr");
    // Dirty a tracked file in main so graduation refuses.
    const toml = join(dir, "discern.toml");
    await Deno.writeTextFile(
      toml,
      `${await Deno.readTextFile(toml)}\n# dirty\n`,
    );

    const r = await runAgent(wt, ["graduate", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout); // the error is a JSON object, not a human line
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "graduate");
    // error is a machine-stable slug; the human sentence rides in `message`.
    assertEquals(obj.error, "precondition_failed");
    assertStringIncludes(obj.message, "uncommitted tracked changes");
  });
});
