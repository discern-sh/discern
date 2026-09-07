/**
 * Checkpoint declaration admission through the real CLI: stops precede jobs,
 * conclusions remain distinct from machine evidence, and malformed
 * declarations leave the store untouched. Each journey builds one fired
 * fixture and walks the declaration lifecycle in steps named for the
 * behaviour each guards, so a refusal, a conclusion, and a replacement are
 * proven on the state the previous step left behind.
 *
 * Guards: boundary:evidence-kind-separation, claim:no-model-inside
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  readOpenQuestions,
  validateUnmetRationale,
} from "../src/engine/checkpoints/open_questions.ts";
import { UNCHANGED_TREE_RERUN_SLUG } from "../src/engine/gate/proof.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  CHECK_TOUCHES,
  CONFIG_ONE_CHECKPOINT,
  CONFIG_TWO_CHECKPOINTS,
  decodedProofMarker,
  parseCheckpointGateJson,
  parseGateJson,
  parseJson,
  proofMarker,
  QUESTION_API,
  QUESTION_NOTES,
  sidecarMarker,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** The rationale shapes the boundary must reject: blank, whitespace, a
 * second line, a tab, and one character over the cap. */
const INVALID_RATIONALES = [
  "",
  "   ",
  "line one\nline two",
  "tab\there",
  "x".repeat(501),
];

Deno.test("done: a fired stop checkpoint refuses until its conclusion is recorded, and invalid declarations record nothing", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

    await t.step(
      "a fired stop checkpoint refuses before any job, serving the question and both recoveries",
      async () => {
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
        assertHasHint(env, HINTS["checkpoint-declare"], {
          ids: ["api-review"],
        });
        // Structured serving for machine callers.
        assertEquals(env.data.checkpoints.outstanding?.length, 1);
        assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "api-review");
        assertEquals(env.data.checkpoints.outstanding?.[0]?.mode, "stop");
        assertEquals(env.data.checkpoints.outstanding?.[0]?.matched, [
          "api/surface.txt",
        ]);
        // No gate job ran: the check job's side effect never happened.
        assertEquals(
          await sidecarMarker(wt, "gate-ran.log"),
          "",
          "the refusal must precede every gate job",
        );
        // The refusal opened the open question — the one write it claims.
        const openQuestions = await readOpenQuestions(wt);
        assert(openQuestions.status === "ok");
        assert(openQuestions.openQuestions["api-review"] !== undefined);
      },
    );

    await t.step(
      "unknown or inactive declaration ids are errors naming the active set, and record nothing",
      async () => {
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
      },
    );

    await t.step(
      "the rationale boundary rejects shape violations before any write",
      async () => {
        // Every shape is rejected by the one validator the write path applies
        // before touching the store; the boundary then proves that ordering
        // once, with the shape a caller is likeliest to send.
        for (const why of INVALID_RATIONALES) {
          assert(
            !validateUnmetRationale(why).ok,
            `rationale ${JSON.stringify(why)} must be rejected`,
          );
        }
        const invalid = INVALID_RATIONALES[2] ?? "";
        const r = await runAgent(wt, [
          "done",
          "--unmet",
          "api-review",
          "--why",
          invalid,
          "--json",
        ]);
        assertEquals(
          r.code,
          1,
          `rationale ${JSON.stringify(invalid)}\n${r.output}`,
        );
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
        const noUnmet = await runAgent(wt, [
          "done",
          "--why",
          "orphaned",
          "--json",
        ]);
        assertEquals(noUnmet.code, 1);
        assertEquals(parseJson(noUnmet.stdout).error, "invalid_arguments");
        // Every refusal above preceded the gate: the check job still never ran.
        assertEquals(await sidecarMarker(wt, "gate-ran.log"), "");
      },
    );

    await t.step(
      "--met records the conclusion and proceeds into the gate; the Proof carries it declared",
      async () => {
        // Declare met: the same invocation runs the gate to green.
        const r = await runAgent(wt, ["done", "--met", "api-review", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseCheckpointGateJson(r.stdout);
        assertEquals(env.ok, true);
        assertEquals(env.data.checkpoints.declared_met?.length, 1);
        assertEquals(env.data.checkpoints.declared_met?.[0]?.id, "api-review");
        assertEquals(env.data.checkpoints.outstanding, undefined);
        // The gate ran this time: the check job left its marker.
        assertStringIncludes(await sidecarMarker(wt, "gate-ran.log"), "ran");
        // The Proof renders the conclusion separately from machine results, with
        // the policy identity, qualified as DECLARED. The wire envelope carries
        // the compact summary (its line includes the declared segment); the full
        // page and structured block live in the recorded marker.
        const proof = env.data.proof;
        assert(
          proof !== undefined,
          "a green run over a clean tree earns a Proof",
        );
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
      },
    );
  });
});

Deno.test("done: a corrupt open-question store fails open into a clean re-ask", async () => {
  // Its own fixture on purpose: the rerun-guard claim below holds when the
  // strict green run is the last gate evidence recorded, so this journey
  // must not ride a fixture whose later runs (a report-mode --ci pass)
  // change what the guard compares.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    // Conclude the served question met in the opening run: the green Proof
    // the rerun guard below recognises.
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

Deno.test("done: declarations replace conclusions, a true green rerun reuses Proof, and hostile text stays inert", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    // Conclude the served question met in the opening run: the state every
    // step below replaces, reopens, or re-serves.
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    await t.step(
      "declarations replace conclusions, while a true green rerun reuses Proof",
      async () => {
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
      },
    );

    await t.step(
      "a rationale of shell and Markdown metacharacters round-trips opaquely",
      async () => {
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
        const declaration = openQuestions.openQuestions["api-review"]
          ?.declaration;
        assert(
          declaration !== undefined && declaration.conclusion === "unmet",
        );
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
      },
    );

    await t.step(
      "the declaration refusal escapes matched paths on the markdown surface",
      async () => {
        // The refusal message renders verbatim under --markdown, and matched
        // paths are working-tree-controlled text — a hostile file name must
        // arrive inside the code-span escaping boundary, never as live
        // Markdown. Committing it also moves the subject, so the question is
        // served again.
        await Deno.writeTextFile(
          join(wt, "api", "*bold*.txt"),
          "hostile name\n",
        );
        await git(wt, "add", "-A");
        await git(wt, "commit", "-q", "-m", "hostile path", "--no-gpg-sign");
        const md = await runAgent(wt, ["done", "--markdown"]);
        assertEquals(md.code, 1, md.output);
        assertStringIncludes(md.stdout, "`api/*bold*.txt`");
        assertStringIncludes(md.stdout, "`api/surface.txt`");
      },
    );
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
