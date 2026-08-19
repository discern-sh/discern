/**
 * The checkpoint interlock at `discern done` (black-box, through the real
 * engine): a fired stop checkpoint refuses BEFORE any gate job with the
 * batched `awaiting_declaration` contract; `--met` / `--unmet --why` record
 * the caller's conclusion and proceed into the gate in the same invocation;
 * conclusions ride the Proof separately from machine results; declaration
 * changes never trip the unchanged-tree rerun guard yet stale the recorded
 * Proof; the governing policy comes from the merge-base, never the branch's
 * own config edits; and every uncertainty (a corrupt open question store) fails
 * open into a clean re-ask rather than a wedge.
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
  writeExecutable,
} from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import type { GateCheckpointsData } from "../src/shared/result_schemas.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { UNCHANGED_TREE_RERUN_SLUG } from "../src/engine/gate/proof.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";

/** The wire fields these black-box assertions read from a `done` envelope.
 * Presence claims are static; a field the engine omits fails its assertion
 * at runtime with `undefined`, which is exactly the signal wanted. */
interface DoneEnvelope {
  ok: boolean;
  verb: string;
  dry_run?: boolean;
  error?: string;
  message: string;
  hints?: string[];
  plan?: { details?: string[] };
  data: {
    checkpoints: GateCheckpointsData;
    proof?: { line: string };
    gate_proof?: { status: string };
  };
}

/** Decode a JSON result envelope. */
function parseJson(stdout: string): DoneEnvelope {
  return JSON.parse(stdout.trim()) as DoneEnvelope;
}

/** The recorded gate-proof marker's raw content — the full Proof page and its
 * structured `data:`/`evidence:` components (the wire envelope carries the
 * compact summary only). */
async function proofMarker(wt: string): Promise<string> {
  const path = await gitAdminStatePath(wt, "gateProof");
  assert(path !== undefined, "the gate-proof path must resolve");
  return await Deno.readTextFile(path);
}

const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";
const QUESTION_NOTES = "A risky change names what could break, for review.";

/** A gate whose one check always passes, plus one stop checkpoint watching
 * `api/**`. The config is committed by `gitInit`, so the worktree's
 * merge-base carries it — the governing copy. */
const CONFIG_ONE_CHECKPOINT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"
teach = "State the failure modes; note what callers must revisit."
`;

const CONFIG_TWO_CHECKPOINTS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"

[checkpoints.risk-notes]
paths = ["api/**"]
question = "${QUESTION_NOTES}"
`;

const CONFIG_ADVISE = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
mode = "advise"
question = "${QUESTION_API}"
`;

const CONFIG_UNLESS_CHANGED = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
unless_changed = ["docs/**"]
question = "${QUESTION_API}"
`;

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Marker file the check job writes when it RUNS — proof of "no gate job ran". */
const CHECK_TOUCHES =
  "#!/usr/bin/env sh\necho ran >> ../gate-ran.log\nexit 0\n";

/** Scaffold main with `config`, then a worktree carrying one committed change
 * under `api/` — the state whose `done` the checkpoint governs. */
async function worktreeWithApiChange(
  dir: string,
  config: string,
  check: string = CHECK_OK,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), check);
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

Deno.test("done: a fired stop checkpoint refuses before any job, serving the question and both recoveries", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "done");
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    // The serving: id, matched evidence, question, and both recoveries.
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, "api/surface.txt");
    assertStringIncludes(env.message, QUESTION_API);
    assertStringIncludes(env.message, "--met");
    assertStringIncludes(env.message, "--unmet");
    assertStringIncludes(env.message, "--why");
    // The read-only-in-effect claim, stated with its exceptions.
    assertStringIncludes(env.message, "No gate job ran");
    assertStringIncludes(env.message, "tree is unchanged");
    assertHasHint(env, HINTS["checkpoint-declare"], { ids: ["api-review"] });
    // Structured serving for machine callers.
    assertEquals(env.data.checkpoints.outstanding?.length, 1);
    assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "api-review");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.mode, "stop");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    // No gate job ran: the check job's side effect never happened.
    assertEquals(
      await Deno.readTextFile(join(dir, "gate-ran.log")).catch(() => ""),
      "",
      "the refusal must precede every gate job",
    );
    // The refusal opened the open question — the one write it claims.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assert(openQuestions.openQuestions["api-review"] !== undefined);
  });
});

Deno.test("done: --met records the conclusion and proceeds into the gate; the Proof carries it declared", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    // Serve the question (and open the open question).
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    // Declare met: the same invocation runs the gate to green.
    const r = await runAgent(wt, ["done", "--met", "api-review", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.data.checkpoints.declared_met?.length, 1);
    assertEquals(env.data.checkpoints.declared_met?.[0]?.id, "api-review");
    assertEquals(env.data.checkpoints.outstanding, undefined);
    // The Proof renders the conclusion separately from machine results, with
    // the policy identity, qualified as DECLARED. The wire envelope carries
    // the compact summary (its line includes the declared segment); the full
    // page and structured block live in the recorded marker.
    const proof = env.data.proof;
    assert(proof !== undefined, "a green run over a clean tree earns a Proof");
    assertStringIncludes(proof.line, "1 checkpoint declared met");
    assertEquals(env.data.gate_proof?.status, "recorded");
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "Checkpoint conclusions");
    assertStringIncludes(marker, "declared met");
    assertStringIncludes(marker, "policy");
    assertStringIncludes(marker, "evidence: ");
    const stored = JSON.parse(
      marker.split("\n").find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) ?? "{}",
    );
    assertEquals(stored.checkpoints.declared_met.length, 1);
    assertEquals(stored.checkpoints.declared_met[0].id, "api-review");
  });
});

Deno.test("done: declarations replace conclusions without --confirmed, and the rerun guard still holds for true reruns", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // A literal rerun on the unchanged tree with unchanged declarations
    // refuses exactly as before.
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 1, rerun.output);
    assertEquals(parseJson(rerun.stdout).error, UNCHANGED_TREE_RERUN_SLUG);

    // Replacing the conclusion is NEW evidence: it proceeds through
    // reconciliation into a fresh gate run with no --confirmed, and the new
    // Proof carries the declared-unmet conclusion and its rationale.
    const flipped = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The docs lag the new surface; a follow-up covers them.",
      "--json",
    ]);
    assertEquals(flipped.code, 0, flipped.output);
    const env = parseJson(flipped.stdout);
    assertEquals(env.data.checkpoints.declared_unmet?.length, 1);
    assertStringIncludes(
      env.data.checkpoints.declared_unmet?.[0]?.why ?? "",
      "docs lag",
    );
    const proof = env.data.proof;
    assert(proof !== undefined);
    assertStringIncludes(proof.line, "1 declared unmet");
    assertStringIncludes(proof.line, "variance required");
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "declared unmet");
    assertStringIncludes(marker, "owner-authorized variance");
    assertHasHint(env, HINTS["gate-variance-required"], {
      ids: ["api-review"],
    });

    // A changed RATIONALE alone is also new evidence: no --confirmed needed.
    const reworded = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The docs lag the new surface; the follow-up lands next.",
      "--json",
    ]);
    assertEquals(reworded.code, 0, reworded.output);
  });
});

Deno.test("done: a batched refusal serves every awaiting checkpoint at once, and partial declarations narrow it", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_TWO_CHECKPOINTS);

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1);
    const env = parseJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      env.data.checkpoints.outstanding?.map((c) => c.id).sort(),
      ["api-review", "risk-notes"],
    );
    assertStringIncludes(env.message, QUESTION_API);
    assertStringIncludes(env.message, QUESTION_NOTES);

    // One declaration records FIRST; the refusal then names only the rest.
    const partial = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(partial.code, 1, partial.output);
    const remaining = parseJson(partial.stdout);
    assertEquals(remaining.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      remaining.data.checkpoints.outstanding?.map((c) => c.id),
      ["risk-notes"],
    );
    // The already-recorded conclusion survives and the whole set completes.
    const done = await runAgent(wt, ["done", "--met", "risk-notes", "--json"]);
    assertEquals(done.code, 0, done.output);
    const final = parseJson(done.stdout);
    assertEquals(
      final.data.checkpoints.declared_met?.map((c) => c.id).sort(),
      ["api-review", "risk-notes"],
    );
  });
});

Deno.test("done: unknown or inactive declaration ids are errors naming the active set, and record nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const r = await runAgent(wt, [
      "done",
      "--met",
      "no-such-checkpoint",
      "--json",
    ]);
    assertEquals(r.code, 1);
    const env = parseJson(r.stdout);
    assertEquals(env.error, "invalid_value");
    assertStringIncludes(env.message, "no-such-checkpoint");
    assertStringIncludes(env.message, "api-review");
    // Nothing recorded: the valid id in a LATER invocation still awaits.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assertEquals(
      openQuestions.openQuestions["api-review"]?.declaration,
      undefined,
    );
  });
});

Deno.test("done: the rationale boundary rejects shape violations before any write", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    for (
      const why of [
        "",
        "   ",
        "line one\nline two",
        "tab\there",
        "x".repeat(501),
      ]
    ) {
      const r = await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        why,
        "--json",
      ]);
      assertEquals(r.code, 1, `rationale ${JSON.stringify(why)}\n${r.output}`);
      const env = parseJson(r.stdout);
      assert(
        env.error === "invalid_value" || env.error === "invalid_arguments",
        env.error,
      );
      const openQuestions = await readOpenQuestions(wt);
      assert(openQuestions.status === "ok");
      assertEquals(
        openQuestions.openQuestions["api-review"]?.declaration,
        undefined,
        "an invalid rationale must record nothing",
      );
    }

    // Flag pairing is validated at the surface: --unmet without --why, and
    // --why without --unmet, both refuse.
    const noWhy = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--json",
    ]);
    assertEquals(noWhy.code, 1);
    assertEquals(parseJson(noWhy.stdout).error, "invalid_arguments");
    const noUnmet = await runAgent(wt, ["done", "--why", "orphaned", "--json"]);
    assertEquals(noUnmet.code, 1);
    assertEquals(parseJson(noUnmet.stdout).error, "invalid_arguments");
  });
});

Deno.test("done: a rationale of shell and Markdown metacharacters round-trips opaquely", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const hostile =
      "Docs lag `rm -rf` and $(echo pwned) | tee *.md _emphasis_ <b>&amp;</b>";
    const r = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      hostile,
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    // The exact bytes survive into the envelope (JSON escaping only)…
    assertEquals(env.data.checkpoints.declared_unmet?.[0]?.why, hostile);
    // …and the store holds them verbatim, uninterpreted — no interpolation
    // shaved or expanded the text.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    const declaration = openQuestions.openQuestions["api-review"]?.declaration;
    assert(declaration !== undefined && declaration.conclusion === "unmet");
    assertEquals(declaration.why, hostile);
    // The recorded Proof page carries it through the code-span escaping
    // boundary rather than as raw markup, and the structured marker copy
    // round-trips the exact bytes.
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "rm -rf");
    const stored = JSON.parse(
      marker.split("\n").find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) ?? "{}",
    );
    assertEquals(stored.checkpoints.declared_unmet[0].why, hostile);
  });
});

Deno.test("done: advise mode serves the question through the advisory channel and never blocks", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertHasHint(env, HINTS["checkpoint-advise"], {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
    });
    assertEquals(env.data.checkpoints.advise?.length, 1);
    assertEquals(env.data.checkpoints.outstanding, undefined);
    // No declaration exists or is required; the recorded Proof carries no
    // conclusion block for an advise-only run.
    assert(!(await proofMarker(wt)).includes("Checkpoint conclusions"));
  });
});

Deno.test("done: the branch cannot edit its own governing policy — the merge-base copy rules", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    // The branch deletes the checkpoint table and commits the edit; the
    // governing (merge-base) copy still interlocks.
    const stripped = CONFIG_ONE_CHECKPOINT.split("[checkpoints.api-review]")[0];
    await writeConfig(wt, stripped ?? "");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "drop the checkpoint", "--no-gpg-sign");
    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(parseJson(r.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("done: a corrupt open-question store fails open into a clean re-ask", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // Corrupt the store: the conclusion is gone, so the next run rebuilds
    // and asks for a fresh declaration instead of wedging or crashing.
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(path !== undefined);
    await Deno.writeTextFile(path, "corrupted, not json\n");
    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    // The conservative direction: the fresh declaration restores the exact
    // claim the green run recorded, so the rerun guard recognises the
    // unchanged tree + unchanged evidence and the standing verdict holds.
    const redeclared = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(redeclared.code, 1, redeclared.output);
    assertEquals(
      parseJson(redeclared.stdout).error,
      UNCHANGED_TREE_RERUN_SLUG,
      "an identical restored claim is the same run, not new evidence",
    );
    // The declaration write itself succeeded: the store holds it again.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assertEquals(
      openQuestions.openQuestions["api-review"]?.declaration?.conclusion,
      "met",
    );
  });
});

Deno.test("done: an opened stop question remains interlocked after its trigger becomes inactive", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_UNLESS_CHANGED);

    // The API-only effort opens the open question. A later docs change makes the
    // current trigger inactive, but cannot retract a question already served.
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    await Deno.mkdir(join(wt, "docs"), { recursive: true });
    await Deno.writeTextFile(join(wt, "docs", "api.md"), "documented\n");
    await git(wt, "add", "docs/api.md");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "docs: describe the api",
      "--no-gpg-sign",
    );

    const stillAwaiting = await runAgent(wt, ["done", "--json"]);
    assertEquals(stillAwaiting.code, 1, stillAwaiting.output);
    const awaiting = parseJson(stillAwaiting.stdout);
    assertEquals(awaiting.error, AWAITING_DECLARATION_SLUG);
    assertEquals(awaiting.data.checkpoints.outstanding?.[0]?.id, "api-review");
    assertEquals(awaiting.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);

    // A conclusion recorded while the trigger remains inactive is still part
    // of this run's checkpoint evidence, including the variance requirement.
    const concluded = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The changed docs do not yet describe the compatibility trade-off.",
      "--json",
    ]);
    assertEquals(concluded.code, 0, concluded.output);
    const env = parseJson(concluded.stdout);
    assertEquals(env.data.checkpoints.declared_unmet?.[0]?.id, "api-review");
    assertStringIncludes(env.data.proof?.line ?? "", "variance required");
  });
});

Deno.test("done: --dry-run never refuses; it previews the checkpoints that would require declarations", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    const r = await runAgent(wt, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.dry_run, true);
    const details: string[] = env.plan?.details ?? [];
    assert(
      details.some((line) =>
        line.includes("api-review") && line.includes("required")
      ),
      JSON.stringify(details),
    );
    // Previewing wrote nothing: no open question exists yet.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "missing", openQuestions.status);
  });
});

Deno.test("done: an unrelated trunk update preserves a conclusion; a matched-base update reopens it", async () => {
  await withTempDir(async (dir) => {
    // The matched file exists on MAIN with room for non-conflicting edits at
    // both ends, so both trunk advances below auto-merge cleanly.
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_ONE_CHECKPOINT);
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await Deno.mkdir(join(dir, "api"), { recursive: true });
    const body = Array.from({ length: 9 }, (_, i) => `line-${i + 1}`);
    await Deno.writeTextFile(
      join(dir, "api", "surface.txt"),
      `${body.join("\n")}\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "checkpointed");
    await Deno.writeTextFile(
      join(wt, "api", "surface.txt"),
      `branch-take\n${body.slice(1).join("\n")}\n`,
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "feat: reshape the api",
      "--no-gpg-sign",
    );
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // Unrelated trunk advance: a file outside the matched set lands on main.
    await Deno.writeTextFile(join(dir, "unrelated.txt"), "trunk moved\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "unrelated trunk work",
      "--no-gpg-sign",
    );
    const updated = await runAgent(wt, ["update", "--json"]);
    assertEquals(updated.code, 0, updated.output);
    // The tree changed (merge commit), so the gate runs — but the conclusion
    // still binds: no fresh declaration is demanded.
    const after = await runAgent(wt, ["done", "--json"]);
    assertEquals(after.code, 0, after.output);
    const env = parseJson(after.stdout);
    assertEquals(env.data.checkpoints.declared_met?.[0]?.id, "api-review");

    // Matched-base trunk advance: main edits the far end of the SAME matched
    // file; the update merges cleanly but moves the subject's base (and
    // merged current) state, reopening the open question.
    await Deno.writeTextFile(
      join(dir, "api", "surface.txt"),
      `${body.slice(0, -1).join("\n")}\ntrunk-take\n`,
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "trunk touches the api",
      "--no-gpg-sign",
    );
    const secondUpdate = await runAgent(wt, ["update", "--json"]);
    assertEquals(secondUpdate.code, 0, secondUpdate.output);
    const reopened = await runAgent(wt, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assertEquals(parseJson(reopened.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("done: a fresh install's shipped defaults govern out of the box", async () => {
  await withTempDir(async (dir) => {
    // The template's own activation, untouched: this is day one after setup.
    await scaffoldEngine(dir, { keepCheckpoints: true });
    await gitInit(dir);
    // Grow the always-loaded instructions — the knowledge-surface moment the
    // shipped `instruction-economy` stop guards.
    await Deno.mkdir(join(dir, "discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern", "instructions.md"),
      "# Project instructions\n\nAlways run the slow suite twice.\n",
    );

    const refused = await runAgent(dir, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const env = parseJson(refused.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.outstanding?.length, 1);
    assertEquals(
      env.data.checkpoints.outstanding?.[0]?.id,
      "instruction-economy",
    );
    assertStringIncludes(env.message, "always-loaded agent instructions");

    // Declaring met clears the interlock and the same invocation proceeds
    // into the gate: whatever it finds next, it is no longer the declaration.
    const declared = await runAgent(
      dir,
      ["done", "--met", "instruction-economy", "--json"],
    );
    const after = parseJson(declared.stdout);
    assertEquals(after.data.checkpoints.declared_met?.length, 1);
    assertEquals(
      after.data.checkpoints.declared_met?.[0]?.id,
      "instruction-economy",
    );
    assert(after.error !== AWAITING_DECLARATION_SLUG, declared.output);
  });
});

/** The `checkpoints` verb's wire fields these restart assertions read. */
interface CheckpointsEnvelope {
  ok: boolean;
  data: {
    checkpoints: {
      id: string;
      open_question?: {
        state: string;
        declaration?: { conclusion: string; current: boolean };
      };
    }[];
  };
}

Deno.test("done: a trunk policy edit reaches the effort only through update, and arrives beside a tree change", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const met = await runAgent(wt, ["done", "--met", "api-review", "--json"]);
    assertEquals(met.code, 0, met.output);
    const governed = parseJson(met.stdout).data.checkpoints.policy;

    // The trunk lands a SECOND stop checkpoint on the same paths. The effort's
    // merge-base has not moved, so its governing policy has not either.
    await writeConfig(
      dir,
      `${CONFIG_ONE_CHECKPOINT}
[checkpoints.risk-notes]
paths = ["api/**"]
question = "${QUESTION_NOTES}"
`,
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "trunk adds a checkpoint",
      "--no-gpg-sign",
    );

    // Before `update`: the unchanged tree meets the RERUN guard, never a
    // demand from the not-yet-governing checkpoint — and the policy identity
    // still names the old merge-base.
    const before = await runAgent(wt, ["done", "--json"]);
    assertEquals(before.code, 1, before.output);
    assertEquals(parseJson(before.stdout).error, UNCHANGED_TREE_RERUN_SLUG);
    assert(!before.output.includes("risk-notes"), before.output);
    const preUpdate = await runAgent(wt, ["checkpoints", "--json"]);
    assertStringIncludes(preUpdate.stdout, `"policy":"${governed}"`);
    assert(!preUpdate.stdout.includes("risk-notes"), preUpdate.stdout);

    // `update` advances the merge-base — and with it, the policy — beside a
    // tree change (the merge commit), so the new checkpoint can never appear
    // against an already-green unchanged tree: the reopened gate is a fresh
    // run, not a rerun needing --confirmed.
    const updated = await runAgent(wt, ["update", "--json"]);
    assertEquals(updated.code, 0, updated.output);
    const after = await runAgent(wt, ["done", "--json"]);
    assertEquals(after.code, 1, after.output);
    const afterEnv = parseJson(after.stdout);
    assertEquals(afterEnv.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      afterEnv.data.checkpoints.outstanding?.map((entry) => entry.id),
      ["risk-notes"],
    );
    // The untouched checkpoint's conclusion still binds across the advance.
    assertEquals(afterEnv.data.checkpoints.declared_met?.[0]?.id, "api-review");
    assert(afterEnv.data.checkpoints.policy !== governed);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "risk-notes", "--json"])).code,
      0,
    );
  });
});

Deno.test("done: the when text governs from the merge-base while it executes from the worktree", async () => {
  await withTempDir(async (dir) => {
    // Trunk: a `when` probe that FIRES, named by the governing config.
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho trunk-probe >> probe-ran.log\nexit 0\n",
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    // The branch rewrites the probe to PASS — and tries to hijack the policy
    // by pointing its own config at a command that would fire.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 1\n",
    );
    await writeExecutable(
      join(wt, "hijack.sh"),
      "#!/usr/bin/env sh\necho hijack >> hijack-ran.log\nexit 0\n",
    );
    await writeConfig(
      wt,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh hijack.sh"
question = "${QUESTION_API}"
`,
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "feat: extend the api",
      "--no-gpg-sign",
    );

    // The governing TEXT is the merge-base's `sh probe.sh`; the script it
    // resolves is the WORKTREE's copy, which passes — so nothing fires, and
    // the branch's hijack command never ran.
    const quiet = await runAgent(wt, ["done", "--json"]);
    assertEquals(quiet.code, 0, quiet.output);
    const ran = await Deno.readTextFile(join(wt, "probe-ran.log"));
    assertStringIncludes(ran, "wt-probe");
    assert(!ran.includes("trunk-probe"), ran);
    assertEquals(
      await Deno.stat(join(wt, "hijack-ran.log")).then(() => true).catch(() =>
        false
      ),
      false,
      "the branch's own `when` text must never run",
    );

    // The same governing text over a firing worktree probe interlocks.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 0\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe fires", "--no-gpg-sign");
    const fired = await runAgent(wt, ["done", "--json"]);
    assertEquals(fired.code, 1, fired.output);
    const env = parseJson(fired.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "spec-drift");

    // Once served, the checkpoint remains interlocked even if the same
    // worktree probe later passes. Trigger state controls opening, not erasure.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 1\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe passes", "--no-gpg-sign");
    const inactive = await runAgent(wt, ["done", "--json"]);
    assertEquals(inactive.code, 1, inactive.output);
    const inactiveEnv = parseJson(inactive.stdout);
    assertEquals(inactiveEnv.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      inactiveEnv.data.checkpoints.outstanding?.[0]?.id,
      "spec-drift",
    );
  });
});

Deno.test("done: when matches cannot escape their structural selector", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho 'DISCERN_MATCH README.md'\nexit 0\n",
    );
    await Deno.writeTextFile(join(dir, "README.md"), "stable context\n");
    await gitInit(dir);

    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v1\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "add api", "--no-gpg-sign");

    const opened = await runAgent(wt, ["done", "--json"]);
    assertEquals(opened.code, 1, opened.output);
    const openedEnv = parseJson(opened.stdout);
    assertEquals(openedEnv.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // The selector-matched content is the subject. Revising it must reopen the
    // open question even though the probe keeps declaring an unrelated stable path.
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v2\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "revise api", "--no-gpg-sign");
    const reopened = await runAgent(wt, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assertEquals(parseJson(reopened.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("openQuestions: the effort's state survives session restarts — each engine process reads what the last recorded", async () => {
  // Every invocation below is its own OS process over the per-worktree store:
  // the refusal's open question, read back by a fresh `checkpoints` run, resolved by
  // a third process's declaration — the spec's session-restart claim, named.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const read = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(read.code, 0, read.output);
    const awaiting = JSON.parse(read.stdout.trim()) as CheckpointsEnvelope;
    assertEquals(
      awaiting.data.checkpoints[0]?.open_question?.state,
      "awaiting_declaration",
    );

    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const settled = await runAgent(wt, ["checkpoints", "--json"]);
    const met = JSON.parse(settled.stdout.trim()) as CheckpointsEnvelope;
    assertEquals(met.data.checkpoints[0]?.open_question?.state, "declared_met");
    assertEquals(
      met.data.checkpoints[0]?.open_question?.declaration?.current,
      true,
    );
  });
});

Deno.test("done: the declaration refusal escapes matched paths on the markdown surface", async () => {
  // The refusal message renders verbatim under --markdown, and matched paths
  // are working-tree-controlled text — a hostile file name must arrive
  // inside the code-span escaping boundary, never as live Markdown.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    await Deno.writeTextFile(join(wt, "api", "*bold*.txt"), "hostile name\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "hostile path", "--no-gpg-sign");
    const md = await runAgent(wt, ["done", "--markdown"]);
    assertEquals(md.code, 1, md.output);
    assertStringIncludes(md.stdout, "`api/*bold*.txt`");
    assertStringIncludes(md.stdout, "`api/surface.txt`");
  });
});
