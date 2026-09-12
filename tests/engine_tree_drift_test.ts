/**
 * Strand detection (ADR 0047, extended to every stage by ADR 0148). Any gate stage
 * may mutate the tree — the fix stage by design, a build/test/scope gate by accident
 * of wiring — but a GREEN finish must not hide uncommitted gate output: a stage that
 * touches a file the agent already COMMITTED leaves a change a clean gate would
 * otherwise conceal. Completion checks each producer boundary before evidence or
 * Proof can authorize the committed candidate.
 *
 * Four layers: the pure stranded-by-stage decision (and the shared porcelain parser
 * it rests on), the wired gate behaviour driven across EVERY stage a project can wire
 * a command into (so a new mutating-stage escape hatch cannot appear silently), the
 * inner-loop case that must NOT trip (a stage reworking the agent's own
 * uncommitted edits), and the strand checkpoint (ADR 0262) that stops a
 * proof-eligible run right after the pre-groups while explicit standalone
 * diagnostics on a dirty tree keep their full end-of-run feedback.
 */

import { decodeCliResult } from "./decode_cli_result.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
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
import {
  type StageSnapshot,
  strandedByStage,
} from "../src/engine/gate/tree_drift.ts";
import { PRE_CHECKPOINT_STAGES } from "../src/engine/gate/plan.ts";
import { jobStage, STAGES } from "../src/shared/capabilities.ts";
import { parsePorcelainZ } from "../src/shared/git_paths.ts";
import {
  decodeGateResult,
  diagFor,
  stepFor,
} from "./engine_done_json_shared.ts";

/** A stand-in formatter: strip trailing spaces from doc.md (a real, input-dependent
 * transform, so it dirties a file that isn't already canonical). */
const FIXER = [
  "#!/usr/bin/env sh",
  `awk '{ sub(/ +$/, ""); print }' doc.md > doc.md.tmp && mv doc.md.tmp doc.md`,
  "",
].join("\n");

/** A minimal config whose ONLY gate work is the fix stage above — instructions/skills
 * currency off so the strand check is the only thing that can fail a green run. */
const CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
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
  // The finished tree is what the proof vouches for: dirty mid-run, clean at the
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

    const obj = decodeGateResult(r.stdout);
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
    phrase: "the check stage",
  },
  {
    name: "test",
    capability: 'test = "sh mutate.sh"',
    phrase: "the test stage",
  },
];

Deno.test("the mutating-stage table exercises every gate stage (the fix stage via its dedicated case above)", () => {
  // The table's class promise, held to the stage registry: a stage added to
  // STAGES fails here until a member (or dedicated case) exercises it.
  const exercised = new Set<string>(["fix"]);
  for (const stage of MUTATING_STAGES) {
    exercised.add(jobStage(stage.name) ?? `unknown job: ${stage.name}`);
  }
  assertEquals([...exercised].sort(), [...STAGES].sort());
});

for (const stage of MUTATING_STAGES) {
  Deno.test(`done: a ${stage.name} command that dirties a COMMITTED-clean tracked file fails with tree_drift, attributed to ${stage.phrase}`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        [
          "[project]",
          'slug = "engine-test"',
          "",
          "[repository]",
          'trunk = "main"',
          "",
          "[jobs]",
          stage.capability,
          "",
        ].join("\n"),
      );
      await writeExecutable(join(dir, "mutate.sh"), MUTATOR);
      await Deno.writeTextFile(join(dir, "data.txt"), "committed\n");
      await gitInit(dir); // commits everything → data.txt committed-clean

      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);

      const obj = decodeGateResult(r.stdout);
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
        "",
        "[repository]",
        'trunk = "main"',
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

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
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

Deno.test("done --standalone: a fixer reworking the agent's OWN uncommitted edit does NOT trip (inner loop)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await Deno.writeTextFile(join(dir, "doc.md"), "hello\n"); // committed clean
    await gitInit(dir);
    // The agent edits doc.md but has NOT committed it — its own work-in-progress.
    await Deno.writeTextFile(join(dir, "doc.md"), "world   \n");

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    // The fixer DID reformat the WIP file (so this isn't a vacuous pass) — it was
    // already dirty at finish-start, so it is the agent's to commit, not a strand.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "world\n");
  });
});

// ── wired: the strand checkpoint (ADR 0262) ───────────────────────────────────
// A run that starts on a clean, committed tree is seeking a proof, and a strand
// left by the fix/build pre-groups already forfeits it — so `done` stops at the
// post-pre-group checkpoint instead of paying for standards, check∥test, and
// scope-gate work that cannot change the verdict. An explicit standalone dirty start (tracked or
// untracked) skips the checkpoint: it can earn no proof anyway, and the
// end-of-run detection still reports its strands after the full run's feedback.

/** A check-stage sentinel proving the expensive later work ran: it drops a marker
 * file the assertions read. Its output is untracked, so it is never a strand. */
const SENTINEL = [
  "#!/usr/bin/env sh",
  'echo "ran" > check-ran.txt',
  "",
].join("\n");

/**
 * Scaffold a committed-clean repo whose `mutatorJob` runs `mutatorScript` (default:
 * append to the committed data.txt — a guaranteed strand) and whose check stage
 * drops the {@link SENTINEL} marker. Everything is committed, so the run starts
 * proof-eligible unless a test dirties the tree afterwards.
 */
async function scaffoldCheckpointRepo(
  dir: string,
  mutatorJob: string,
  mutatorScript = MUTATOR,
): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[jobs]",
      `${mutatorJob} = "sh mutate.sh"`,
      'lint = "sh sentinel.sh"',
      "",
    ].join("\n"),
  );
  await writeExecutable(join(dir, "mutate.sh"), mutatorScript);
  await writeExecutable(join(dir, "sentinel.sh"), SENTINEL);
  await Deno.writeTextFile(join(dir, "data.txt"), "committed\n");
  await Deno.writeTextFile(join(dir, "wip.txt"), "committed\n");
  await gitInit(dir);
}

/** The checkpoint's pre-group mutators — one per stage that runs before it. */
const PRE_CHECKPOINT_MUTATORS: ReadonlyArray<{ job: string; phrase: string }> =
  [
    { job: "format", phrase: "the fix stage" },
    { job: "build", phrase: "the build stage" },
  ];

Deno.test("the checkpoint mutator table exercises every pre-checkpoint stage", () => {
  // The table's class promise, held to the plan's own registry: a stage added to
  // PRE_CHECKPOINT_STAGES fails here until a mutator exercises its checkpoint.
  assertEquals(
    PRE_CHECKPOINT_MUTATORS.map((m) => jobStage(m.job)),
    [...PRE_CHECKPOINT_STAGES],
  );
});

for (const mutator of PRE_CHECKPOINT_MUTATORS) {
  Deno.test(`done: a clean start whose ${mutator.job} job strands a tracked file stops at the checkpoint — later work never runs`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldCheckpointRepo(dir, mutator.job);

      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);

      const obj = decodeGateResult(r.stdout);
      assertEquals(obj.ok, false);
      assertEquals(obj.data.failed_stage, "tree_drift");
      const diag = diagFor(obj, "tree-drift");
      assert(
        diag,
        `expected a tree-drift diagnostic, got ${JSON.stringify(obj)}`,
      );
      assertStringIncludes(diag.message, mutator.phrase);
      assertStringIncludes(diag.message, "data.txt");
      // One detection, one diagnostic: the checkpoint REPLACES the final pass
      // on this path rather than running beside it.
      assertEquals(
        (obj.diagnostics ?? []).filter((d) => d.tool === "tree-drift")
          .length,
        1,
      );
      // The doomed tail was cut: the check job serialized as skipped and its
      // sentinel never ran.
      assertEquals(stepFor(obj, "lint")?.outcome, "skipped");
      assertEquals(await targetExists(join(dir, "check-ran.txt")), false);
    });
  });
}

Deno.test("done --standalone: a tracked-dirty start skips the checkpoint — later jobs run, the strand reports at the end", async () => {
  await withTempDir(async (dir) => {
    await scaffoldCheckpointRepo(dir, "format");
    // The agent's own work-in-progress: a committed file edited, not committed.
    await Deno.writeTextFile(join(dir, "wip.txt"), "edited\n");

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "tree_drift");
    const diag = diagFor(obj, "tree-drift");
    assert(
      diag,
      `expected a tree-drift diagnostic, got ${JSON.stringify(obj)}`,
    );
    assertStringIncludes(diag.message, "data.txt");
    // The WIP file was dirty at gate start — the agent's own edit, not a strand.
    assert(!diag.message.includes("wip.txt"), diag.message);
    // Full feedback: the check job really ran before the end-of-run verdict.
    assertEquals(stepFor(obj, "lint")?.outcome, "ok");
    assertEquals(await targetExists(join(dir, "check-ran.txt")), true);
  });
});

Deno.test("done --standalone: an untracked-dirty start is not proof-eligible — the checkpoint stands down, the full run reports at the end", async () => {
  await withTempDir(async (dir) => {
    await scaffoldCheckpointRepo(dir, "format");
    // Untracked dirt is invisible to the TRACKED-dirty snapshot (which stays
    // empty here), but the proof pin counts it — eligibility must read the pin.
    await Deno.writeTextFile(join(dir, "stray.txt"), "untracked\n");

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "tree_drift");
    const diag = diagFor(obj, "tree-drift");
    assert(diag !== undefined);
    assertStringIncludes(diag.message, "data.txt");
    // No early abort: the check job ran to completion first.
    assertEquals(stepFor(obj, "lint")?.outcome, "ok");
    assertEquals(await targetExists(join(dir, "check-ran.txt")), true);
  });
});

/** Restore data.txt to its committed bytes — a build undoing the fixer's edit. */
const RESTORER = [
  "#!/usr/bin/env sh",
  'printf "committed\\n" > data.txt',
  "",
].join("\n");

Deno.test("prepare permits fixer/regeneration convergence; clean completion stops at the first producer drift", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'format = "sh mutate.sh"',
        'lint = "sh sentinel.sh"',
        "",
        "[generated.data]",
        'paths = ["data.txt"]',
        'run = "sh restore.sh"',
        "",
      ].join("\n"),
    );
    await writeExecutable(join(dir, "mutate.sh"), MUTATOR);
    await writeExecutable(join(dir, "restore.sh"), RESTORER);
    await writeExecutable(join(dir, "sentinel.sh"), SENTINEL);
    await Deno.writeTextFile(join(dir, "data.txt"), "committed\n");
    await gitInit(dir);

    const prepared = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepared.code, 0, prepared.output);
    const preparation = decodeCliResult(prepared.stdout, "prepare");
    assertEquals(
      preparation.steps?.find((step) => step.label === "format")?.outcome,
      "ok",
    );
    assertEquals(
      preparation.steps?.find((step) => step.label === "generated:data")
        ?.outcome,
      "ok",
    );
    assertEquals(await Deno.readTextFile(join(dir, "data.txt")), "committed\n");
    assertEquals(await targetExists(join(dir, "check-ran.txt")), true);
    await Deno.remove(join(dir, "check-ran.txt"));
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-qm",
      "Prepare the generated source",
      "--no-gpg-sign",
    );
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "tree_drift", r.stdout);
    assertEquals(stepFor(obj, "format").outcome, "ok", r.stdout);
    assertEquals(
      obj.data.completion?.pending?.[0]?.kind,
      "validation-failed",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, "data.txt")),
      "committed\nregenerated\n",
    );
    assertEquals(stepFor(obj, "generated:data").outcome, "skipped");
    assertEquals(await targetExists(join(dir, "check-ran.txt")), false);
    assertStringIncludes(
      obj.diagnostics?.map((item) => item.message).join("\n") ?? "",
      "data.txt",
    );
    assertEquals(obj.data.gate_proof?.status, "pending");
  });
});

/** A mutator that also fails: the command failure must outrank the strand. */
const FAILING_MUTATOR = [
  "#!/usr/bin/env sh",
  'echo "regenerated" >> data.txt',
  "exit 1",
  "",
].join("\n");

Deno.test("done: a pre-group command failure outranks the checkpoint — failed_stage stays fix, no tree-drift diagnostic", async () => {
  await withTempDir(async (dir) => {
    await scaffoldCheckpointRepo(dir, "format", FAILING_MUTATOR);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "fix");
    assertEquals(diagFor(obj, "tree-drift"), undefined);
  });
});

Deno.test("done: generated drift outranks the checkpoint — the owning group is named, not tree_drift", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[generated.reference]",
        'paths = ["gen.txt"]',
        'run = "sh regen.sh"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "regen.sh"),
      ["#!/usr/bin/env sh", 'echo "regenerated" >> gen.txt', ""].join("\n"),
    );
    await Deno.writeTextFile(join(dir, "gen.txt"), "committed\n");
    await gitInit(dir); // clean, committed start — proof-eligible

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "generated_drift");
    assertEquals(diagFor(obj, "tree-drift"), undefined);
  });
});

/** A fixer that strands AND breaks the index: strand evidence becomes
 * unavailable, while the final tracked-refresh proof fails closed. */
const INDEX_BREAKING_MUTATOR = [
  "#!/usr/bin/env sh",
  'echo "regenerated" >> data.txt',
  'printf "garbage" > .git/index',
  "",
].join("\n");

Deno.test("done: the producer boundary fails closed when a fixer corrupts the index", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(join(dir, "fixer.sh"), INDEX_BREAKING_MUTATOR);
    await Deno.writeTextFile(join(dir, "data.txt"), "committed\n");
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "check/test");
    assertEquals(stepFor(obj, "format").outcome, "ok");
    assertEquals(
      obj.data.completion?.pending?.[0]?.kind,
      "stale-evidence",
    );
    assertEquals(obj.data.gate_proof?.status, "pending");
    assertEquals(await Deno.readTextFile(join(dir, ".git/index")), "garbage");
  });
});

Deno.test("done: unreadable strand snapshots stay visible and cannot mint reusable Proof", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'test = "touch strand-status-disabled"',
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      "strand-status-disabled\n",
    );
    const gitWrapper = join(dir, "git-with-unreadable-strand-status");
    await writeExecutable(
      gitWrapper,
      [
        "#!/usr/bin/env sh",
        "is_status=0",
        "is_porcelain=0",
        'for arg in "$@"; do',
        '  [ "$arg" = "status" ] && is_status=1',
        '  [ "$arg" = "--porcelain=v1" ] && is_porcelain=1',
        "done",
        'if [ -f strand-status-disabled ] && [ "$is_status" = 1 ] && [ "$is_porcelain" = 1 ]; then',
        '  echo "strand status deliberately unavailable" >&2',
        "  exit 70",
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const first = await runAgent(dir, ["done", "--json"], {
      env: { GIT_BIN: gitWrapper },
    });
    assertEquals(first.code, 1, first.output);
    const envelope = decodeGateResult(first.stdout);
    assertEquals(envelope.data.failed_stage, "tree_drift");
    assertEquals(envelope.data.gate_proof?.status, "pending");
    assertTerminalTextIncludes(
      first.stdout,
      "Tracked checkout observation is unavailable; no reusable Proof can be issued.",
    );
    assert(
      envelope.data.completion?.pending?.some((item) =>
        item.kind === "validation-failed"
      ),
    );
    const second = await runAgent(dir, ["done", "--json"], {
      env: { GIT_BIN: gitWrapper },
    });
    assertEquals(second.code, 1, second.output);
    const retried = decodeGateResult(second.stdout);
    assert(
      retried.data.completion?.pending?.some((item) =>
        item.kind === "validation-failed"
      ),
    );
    assertTerminalTextIncludes(
      second.stdout,
      "Tracked checkout observation is unavailable; no reusable Proof can be issued.",
    );
    assert(
      !second.stdout.includes("reused the current green Proof"),
      second.output,
    );
    assert(!second.stdout.includes('"status":"recorded"'), second.output);
  });
});

Deno.test("done: the checkpoint keeps post-pre-group scope classification — the fired scope rides in the result while its gate stays skipped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'format = "sh fixer.sh"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "sh gate.sh"',
        "",
      ].join("\n"),
    );
    await writeExecutable(join(dir, "fixer.sh"), FIXER);
    await writeExecutable(
      join(dir, "gate.sh"),
      ["#!/usr/bin/env sh", 'echo "ran" > gate-ran.txt', ""].join("\n"),
    );
    await Deno.mkdir(join(dir, "widget"), { recursive: true });
    await Deno.writeTextFile(join(dir, "widget/data.txt"), "committed\n");
    await Deno.writeTextFile(join(dir, "doc.md"), "hello\n");
    await gitInit(dir);
    const wt = await addWorktree(dir, "theta");

    // The branch commits a widget change (so the widget gate would fire) plus a
    // doc the fixer will reflow (the strand) — then runs done on the clean tree.
    await Deno.writeTextFile(join(wt, "widget/data.txt"), "changed\n");
    await Deno.writeTextFile(join(wt, "doc.md"), "hello   \n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "widget change", "--no-gpg-sign");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.data.failed_stage, "tree_drift");
    // Classification still happened after the pre-groups ran…
    assert(obj.data.scopes_changed.includes("widget"), r.stdout);
    // …but the would-fire gate never did: planned to run, serialized skipped.
    const gate = stepFor(obj, "scope:widget");
    assertEquals(gate?.disposition, "run");
    assertEquals(gate?.outcome, "skipped");
    assertEquals(await targetExists(join(wt, "gate-ran.txt")), false);
  });
});

// ── wired: the accept boundary (ADR 0061) ─────────────────────────────────────
// Acceptance requires complete evidence; missing Proof cannot run a fixer or land source.

Deno.test("accept: refuses (non-destructively) an unproven committed file without executing its fixer", async () => {
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
    assertTerminalTextIncludes(
      r.output,
      "has no honored Proof at HEAD, so there is nothing proven to land",
    );
    // Non-destructive: the worktree survives and the unformatted doc never reached main.
    assertEquals(
      await targetExists(wt),
      true,
      `worktree must survive the refusal\n${r.output}`,
    );
    assertEquals(
      await targetExists(join(dir, "doc.md")),
      false,
      "the unformatted doc must not reach main",
    );
    // Missing completion cannot run a producer or rewrite the authored file.
    assertEquals(await Deno.readTextFile(join(wt, "doc.md")), "hello   \n");
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

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await targetExists(wt),
      false,
      `a clean branch should accept\n${r.output}`,
    );
    // The work landed on the trunk in the main checkout, formatted.
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), "hello\n");
  });
});
