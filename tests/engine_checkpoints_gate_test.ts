/**
 * Checkpoint declaration admission through the real CLI: stops precede jobs,
 * conclusions remain distinct from machine evidence, and malformed declarations
 * leave the store untouched.
 *
 * Guards: boundary:evidence-kind-separation, claim:no-model-inside
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  CHECK_TOUCHES,
  CONFIG_ONE_CHECKPOINT,
  decodedProofMarker,
  parseCheckpointGateJson,
  parseGateJson,
  parseJson,
  proofMarker,
  QUESTION_API,
  QUESTION_NOTES,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

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

Deno.test("done: a fired stop checkpoint refuses before any job, serving the question and both recoveries", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "done");
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assert(typeof env.message === "string");
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
      (await readTextIfExists(join(dir, "gate-ran.log"))) ?? "",
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
    const env = parseCheckpointGateJson(r.stdout);
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
    const strictMarker = await proofMarker(wt);
    assertEquals(decodedProofMarker(strictMarker).mode, "strict");
    assertEquals(env.data.gate_proof?.status, "recorded");
    const reported = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(reported.code, 0, reported.output);
    assertEquals(
      await proofMarker(wt),
      strictMarker,
      "report mode must preserve honored strict evidence for the same HEAD",
    );
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "Checkpoint conclusions");
    assertStringIncludes(marker, "declared met");
    assertStringIncludes(marker, "policy");
    const record = decodedProofMarker(marker);
    assert(record.evidence !== undefined);
    const stored = record.proof;
    assert(stored !== undefined);
    assert(stored.checkpoints.declared_met !== undefined);
    assertEquals(stored.checkpoints.declared_met.length, 1);
    const declaredMet = stored.checkpoints.declared_met[0];
    assert(declaredMet !== undefined);
    assertEquals(declaredMet.id, "api-review");
  });
});

Deno.test("done: declarations replace conclusions, while a true green rerun reuses Proof", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // A literal strict call on the unchanged tree reuses exact current Proof.
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    assertEquals(parseGateJson(rerun.stdout).data.gate_ran, false);

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
    const env = parseCheckpointGateJson(flipped.stdout);
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
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assert(typeof env.message === "string");
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
    const remaining = parseCheckpointGateJson(partial.stdout);
    assertEquals(remaining.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      remaining.data.checkpoints.outstanding?.map((c) => c.id),
      ["risk-notes"],
    );
    // The already-recorded conclusion survives and the whole set completes.
    const done = await runAgent(wt, ["done", "--met", "risk-notes", "--json"]);
    assertEquals(done.code, 0, done.output);
    const final = parseCheckpointGateJson(done.stdout);
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
    assert(typeof env.message === "string");
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
    const env = parseCheckpointGateJson(r.stdout);
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
    const stored = decodedProofMarker(marker).proof;
    assert(stored !== undefined);
    assert(stored.checkpoints.declared_unmet !== undefined);
    const declaredUnmet = stored.checkpoints.declared_unmet[0];
    assert(declaredUnmet !== undefined);
    assertEquals(declaredUnmet.why, hostile);
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
