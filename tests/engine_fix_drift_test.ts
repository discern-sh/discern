/**
 * Fix-stage strand detection (ADR 0047). The fix stage may mutate the tree, but a
 * GREEN finish must not hide uncommitted fixer output: a fixer that reformats a file
 * the agent already COMMITTED leaves a change a clean gate would otherwise conceal
 * until `discern graduate` scoops it up staged-but-uncommitted in the main checkout.
 *
 * Two layers: the pure `D1 \ D0` decision (and the shared porcelain parser it rests
 * on), then the wired gate behaviour — the positive strand AND the inner-loop case
 * that must NOT trip (a fixer reworking the agent's own uncommitted edits).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { fixDriftPaths } from "../src/engine/gate/fix_drift.ts";
import { parsePorcelainPaths } from "../src/engine/scopes/changed.ts";

// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}
// deno-lint-ignore no-explicit-any
const diagFor = (obj: any, tool: string) =>
  (obj.diagnostics ?? []).find((d: { tool: string }) => d.tool === tool);

/** A stand-in formatter: strip trailing spaces from doc.md (a real, input-dependent
 * transform, so it dirties a file that isn't already canonical). */
const FIXER = [
  "#!/usr/bin/env sh",
  `awk '{ sub(/ +$/, ""); print }' doc.md > doc.md.tmp && mv doc.md.tmp doc.md`,
  "",
].join("\n");

/** A minimal config whose ONLY gate work is the fix stage above — guidance/skills
 * currency off so the strand check is the only thing that can fail a green run. */
const CONFIG = [
  "[project]",
  'slug = "engine-test"',
  'main_branch = "main"',
  "",
  "[features]",
  "guidance = false",
  "skills = false",
  "",
  "[capabilities]",
  'format = "sh fixer.sh"',
  "",
].join("\n");

// ── pure: the D1 \ D0 decision ──────────────────────────────────────────────────

Deno.test("fixDriftPaths: a file clean at start, dirtied by the fix stage, is stranded", () => {
  const before = new Set<string>();
  const after = new Set(["docs/a.md"]);
  assertEquals(fixDriftPaths(before, after), ["docs/a.md"]);
});

Deno.test("fixDriftPaths: a file ALREADY dirty before the fix stage is never stranded (inner loop)", () => {
  const before = new Set(["src/wip.ts"]);
  const after = new Set(["src/wip.ts"]); // the fixer reworked the agent's own WIP
  assertEquals(fixDriftPaths(before, after), []);
});

Deno.test("fixDriftPaths: mixes — only the newly-dirtied, committed-clean paths, sorted", () => {
  const before = new Set(["a-wip.ts"]);
  const after = new Set(["a-wip.ts", "z.md", "b.md"]);
  assertEquals(fixDriftPaths(before, after), ["b.md", "z.md"]);
});

Deno.test("fixDriftPaths: a no-op fix stage strands nothing", () => {
  const tree = new Set(["x.ts", "y.md"]);
  assertEquals(fixDriftPaths(tree, tree), []);
});

// ── pure: the shared porcelain parser ───────────────────────────────────────────

Deno.test("parsePorcelainPaths: strips the status prefix, follows renames, drops quotes", () => {
  const out = [
    " M src/a.ts",
    "?? new.txt",
    'R  old.ts -> "new name.ts"',
    "",
  ].join("\n");
  assertEquals(parsePorcelainPaths(out), [
    "src/a.ts",
    "new.txt",
    "new name.ts",
  ]);
});

// ── wired: the gate behaviour ───────────────────────────────────────────────────

Deno.test("finish: a fixer that reformats a COMMITTED-clean file fails with fix_drift", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    // Committed with trailing whitespace → the fixer will reformat it on finish.
    await Deno.writeTextFile(join(dir, "doc.md"), "hello   \n");
    await gitInit(dir); // commits everything → tree clean at finish-start

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "fix_drift");
    const diag = diagFor(obj, "fix");
    assert(diag, `expected a fix diagnostic, got ${JSON.stringify(obj)}`);
    assertEquals(diag.severity, "error");
    assertEquals(diag.reproduce_cmd, "git diff");
    assertStringIncludes(diag.message, "doc.md");
    assertStringIncludes(diag.message, "uncommitted");
    // The fixer's own edit landed (proving it ran), but is now canonical, not stranded.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "hello\n");
  });
});

Deno.test("finish: a fixer reworking the agent's OWN uncommitted edit does NOT trip (inner loop)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await Deno.writeTextFile(join(dir, "doc.md"), "hello\n"); // committed clean
    await gitInit(dir);
    // The agent edits doc.md but has NOT committed it — its own work-in-progress.
    await Deno.writeTextFile(join(dir, "doc.md"), "world   \n");

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    // The fixer DID reformat the WIP file (so this isn't a vacuous pass) — it was
    // already dirty at finish-start, so it is the agent's to commit, not a strand.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "world\n");
  });
});

// ── wired: the graduate boundary (ADR 0061) ─────────────────────────────────────
// The same fixed-point property `finish` enforces, brought to `graduate` — so a branch an
// agent committed WITHOUT a clean `finish` (e.g. running only a scope gate on a docs edit,
// never the formatter) cannot fast-forward unformatted Markdown onto the trunk LOCALLY,
// where CI's trailing `git diff --exit-code` never runs.

Deno.test("graduate: refuses (non-destructively) when the fix stage would reformat a committed file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await gitInit(dir); // main: config + fixer committed, fix-stage clean
    const wt = await addWorktree(dir, "gamma");

    // The agent skips `finish` and commits an unformatted doc straight onto the branch.
    await Deno.writeTextFile(join(wt, "doc.md"), "hello   \n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "docs: add note", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "doc.md");
    assertStringIncludes(r.output, "fix stage");
    // Non-destructive: the worktree survives and the unformatted doc never reached main.
    assertEquals(
      await exists(wt),
      true,
      `worktree must survive the refusal\n${r.output}`,
    );
    assertEquals(
      await exists(join(dir, "doc.md")),
      false,
      "the unformatted doc must not reach main",
    );
    // The fixer's reformat is left applied in the worktree, ready for the agent to commit.
    assertEquals(await Deno.readTextFile(join(wt, "doc.md")), "hello\n");
  });
});

Deno.test("graduate: a fix-stage-clean branch lands normally", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await gitInit(dir);
    const wt = await addWorktree(dir, "epsilon");

    // doc.md is already canonical → the guard's fixer is a no-op, nothing stranded.
    await Deno.writeTextFile(join(wt, "doc.md"), "hello\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "docs: add note", "--no-gpg-sign");

    const r = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `a clean branch should graduate\n${r.output}`,
    );
    // The work landed on the trunk in the main checkout, formatted.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "hello\n");
  });
});
