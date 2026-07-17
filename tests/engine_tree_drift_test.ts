/**
 * Strand detection (ADR 0047, extended to every stage by ADR 0148). Any gate stage
 * may mutate the tree — the fix stage by design, a build/test/scope gate by accident
 * of wiring — but a GREEN finish must not hide uncommitted gate output: a stage that
 * touches a file the agent already COMMITTED leaves a change a clean gate would
 * otherwise conceal until `discern accept` scoops it up staged-but-uncommitted in the
 * main checkout.
 *
 * Three layers: the pure stranded-by-stage decision (and the shared porcelain parser
 * it rests on), the wired gate behaviour driven across EVERY stage a project can wire
 * a command into (so a new mutating-stage escape hatch cannot appear silently), and
 * the inner-loop case that must NOT trip (a stage reworking the agent's own
 * uncommitted edits).
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
import {
  type StageSnapshot,
  strandedByStage,
} from "../src/engine/gate/tree_drift.ts";
import { parsePorcelainZ } from "../src/shared/git_paths.ts";

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
  "[capabilities]",
  'format = "sh fixer.sh"',
  "",
].join("\n");

// ── pure: the stranded-by-stage decision ────────────────────────────────────────

const snap = (
  stage: StageSnapshot["stage"],
  ...paths: string[]
): StageSnapshot => ({
  stage,
  dirty: new Set(paths),
});

Deno.test("strandedByStage: a file clean at start, dirtied by the fix stage, is stranded and attributed", () => {
  const strands = strandedByStage(new Set(), [snap("fix", "docs/a.md")]);
  assertEquals(strands, [{ stage: "fix", paths: ["docs/a.md"] }]);
});

Deno.test("strandedByStage: a file ALREADY dirty before any stage is never stranded (inner loop)", () => {
  const strands = strandedByStage(new Set(["src/wip.ts"]), [
    snap("fix", "src/wip.ts"), // the fixer reworked the agent's own WIP
  ]);
  assertEquals(strands, []);
});

Deno.test("strandedByStage: mixes — only the newly-dirtied, committed-clean paths, sorted", () => {
  const strands = strandedByStage(new Set(["a-wip.ts"]), [
    snap("fix", "a-wip.ts", "z.md", "b.md"),
  ]);
  assertEquals(strands, [{ stage: "fix", paths: ["b.md", "z.md"] }]);
});

Deno.test("strandedByStage: a no-op gate strands nothing", () => {
  const tree = new Set(["x.ts", "y.md"]);
  assertEquals(strandedByStage(tree, [{ stage: "fix", dirty: tree }]), []);
});

Deno.test("strandedByStage: each strand names the FIRST stage that dirtied it", () => {
  const strands = strandedByStage(new Set(), [
    snap("fix", "a.md"),
    snap("build", "a.md", "gen.json"),
    snap("check/test", "a.md", "gen.json", "golden.txt"),
  ]);
  assertEquals(strands, [
    { stage: "fix", paths: ["a.md"] },
    { stage: "build", paths: ["gen.json"] },
    { stage: "check/test", paths: ["golden.txt"] },
  ]);
});

Deno.test("strandedByStage: a path a later stage RESTORES to committed state is not stranded", () => {
  // The finished tree is what the receipt vouches for: dirty mid-run, clean at the
  // end, means nothing is left to commit.
  const strands = strandedByStage(new Set(), [
    snap("fix", "roundtrip.md"),
    snap("build"),
  ]);
  assertEquals(strands, []);
});

Deno.test("strandedByStage: no snapshots (no stage group ran) strands nothing", () => {
  assertEquals(strandedByStage(new Set(["wip.ts"]), []), []);
});

// ── pure: the shared porcelain parser ───────────────────────────────────────────

Deno.test("the strand snapshot reads both sides of -z rename records verbatim", () => {
  // A rename names two paths, and both are evidence: losing the vacated (old)
  // side would make a rename register as LESS change than a plain deletion —
  // the scope classifier would skip the vacated scope's gate, and a fixer-made
  // rename would under-report its strand.
  const out =
    " M src/a.ts\0?? new.txt\0R  new name.ts\0old.ts\0R  renamed.ts\0old name.ts\0";
  const paths = parsePorcelainZ(out).flatMap((entry) =>
    entry.origPath === undefined ? [entry.path] : [entry.origPath, entry.path]
  );
  assertEquals(paths, [
    "src/a.ts",
    "new.txt",
    "old.ts",
    "new name.ts",
    "old name.ts",
    "renamed.ts",
  ]);
});

// ── wired: the gate behaviour, across every stage a command can be wired into ────

Deno.test("done: a fixer that reformats a COMMITTED-clean file fails with tree_drift", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    // Committed with trailing whitespace → the fixer will reformat it on finish.
    await Deno.writeTextFile(join(dir, "doc.md"), "hello   \n");
    await gitInit(dir); // commits everything → tree clean at finish-start

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "tree_drift");
    const diag = diagFor(obj, "tree-drift");
    assert(
      diag,
      `expected a tree-drift diagnostic, got ${JSON.stringify(obj)}`,
    );
    assertEquals(diag.severity, "error");
    assertEquals(diag.reproduce_cmd, "git diff");
    assertStringIncludes(diag.message, "the fix stage");
    assertStringIncludes(diag.message, "doc.md");
    assertStringIncludes(diag.message, "uncommitted");
    // The fixer's own edit landed (proving it ran), but is now canonical, not stranded.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "hello\n");
  });
});

/** A stand-in for any stage command that regenerates a TRACKED file — an xcodegen,
 * a schema codegen, a golden-file rewriter. Appends, so it always dirties. */
const MUTATOR = [
  "#!/usr/bin/env sh",
  'echo "regenerated" >> data.txt',
  "",
].join("\n");

/**
 * The CLASS, driven across every non-fix surface a project can wire a command into:
 * each member mutates a committed-clean tracked file and must fail the gate with
 * `tree_drift`, the diagnostic naming the ORIGIN stage — not "the formatter", the
 * misdiagnosis a green gate used to invite. `capability` is the config line; `phrase`
 * is the attribution the agent reads. (The fix stage has its own test above; `lint`
 * and `test` both land in done's fused check/test group.)
 */
const MUTATING_STAGES: ReadonlyArray<
  { name: string; capability: string; phrase: string }
> = [
  {
    name: "build",
    capability: 'build = "sh mutate.sh"',
    phrase: "the build stage",
  },
  {
    name: "lint",
    capability: 'lint = "sh mutate.sh"',
    phrase: "the check/test stage",
  },
  {
    name: "test",
    capability: 'test = "sh mutate.sh"',
    phrase: "the check/test stage",
  },
];

for (const stage of MUTATING_STAGES) {
  Deno.test(`done: a ${stage.name} command that dirties a COMMITTED-clean tracked file fails with tree_drift, attributed to ${stage.phrase}`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        [
          "[project]",
          'slug = "engine-test"',
          'main_branch = "main"',
          "",
          "[capabilities]",
          stage.capability,
          "",
        ].join("\n"),
      );
      await writeExecutable(join(dir, "mutate.sh"), MUTATOR);
      await Deno.writeTextFile(join(dir, "data.txt"), "committed\n");
      await gitInit(dir); // commits everything → data.txt committed-clean

      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);

      const obj = parseJson(r.stdout);
      assertEquals(obj.ok, false);
      assertEquals(obj.data.failed_stage, "tree_drift");
      const diag = diagFor(obj, "tree-drift");
      assert(
        diag,
        `expected a tree-drift diagnostic, got ${JSON.stringify(obj)}`,
      );
      assertStringIncludes(diag.message, stage.phrase);
      assertStringIncludes(diag.message, "data.txt");
      assertEquals(diag.reproduce_cmd, "git diff");
    });
  });
}

Deno.test("done: a scope gate that dirties a COMMITTED-clean tracked file fails with tree_drift, attributed to the scope gate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "sh mutate.sh"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "mutate.sh"),
      [
        "#!/usr/bin/env sh",
        'echo "regenerated" >> widget/data.txt',
        "",
      ].join("\n"),
    );
    await Deno.mkdir(join(dir, "widget"), { recursive: true });
    await Deno.writeTextFile(join(dir, "widget/data.txt"), "committed\n");
    await gitInit(dir);
    // An untracked file in the scope marks it changed, so its gate runs; untracked
    // dirt is outside the strand's TRACKED scope, so only the gate's own mutation
    // of the committed file can trip the check.
    await Deno.writeTextFile(join(dir, "widget/trigger.txt"), "changed\n");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assert(obj.data.scopes_changed.includes("widget"), r.stdout);
    assertEquals(obj.data.failed_stage, "tree_drift");
    const diag = diagFor(obj, "tree-drift");
    assert(
      diag,
      `expected a tree-drift diagnostic, got ${JSON.stringify(obj)}`,
    );
    assertStringIncludes(diag.message, "a scope gate");
    assertStringIncludes(diag.message, "widget/data.txt");
  });
});

Deno.test("done: a fixer reworking the agent's OWN uncommitted edit does NOT trip (inner loop)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await Deno.writeTextFile(join(dir, "doc.md"), "hello\n"); // committed clean
    await gitInit(dir);
    // The agent edits doc.md but has NOT committed it — its own work-in-progress.
    await Deno.writeTextFile(join(dir, "doc.md"), "world   \n");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    // The fixer DID reformat the WIP file (so this isn't a vacuous pass) — it was
    // already dirty at finish-start, so it is the agent's to commit, not a strand.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "world\n");
  });
});

// ── wired: the accept boundary (ADR 0061) ─────────────────────────────────────
// The same fixed-point property `done` enforces, brought to `accept` — so a branch an
// agent committed WITHOUT a clean `done` (e.g. running only a scope gate on a docs edit,
// never the formatter) cannot fast-forward unformatted Markdown onto the trunk LOCALLY,
// where CI's trailing `git diff --exit-code` never runs.

Deno.test("accept: refuses (non-destructively) when the fix stage would reformat a committed file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await gitInit(dir); // main: config + fixer committed, fix-stage clean
    const wt = await addWorktree(dir, "gamma");

    // The agent skips `done` and commits an unformatted doc straight onto the branch.
    await Deno.writeTextFile(join(wt, "doc.md"), "hello   \n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "docs: add note", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
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

Deno.test("accept: a fix-stage-clean branch lands normally", async () => {
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

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `a clean branch should accept\n${r.output}`,
    );
    // The work landed on the trunk in the main checkout, formatted.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "hello\n");
  });
});
