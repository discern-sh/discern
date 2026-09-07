/** Checkpoint evidence accept journeys with independently owned fixtures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { AWAITING_CONSENT_SLUG } from "../src/shared/consent.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  type AcceptEnvelope,
  type AcceptWireData,
  checkpointedWorktree,
  CONFIG_WITH_GRANT,
  landedNotePayload,
  parseAcceptJson,
  parseAppliedAcceptJson,
  QUESTION,
} from "./engine_checkpoints_accept_fixture.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

type CheckpointDropAcceptEnvelope = Omit<AcceptEnvelope, "data"> & {
  data: AcceptWireData & {
    checkpoint_drops: NonNullable<AcceptWireData["checkpoint_drops"]>;
  };
};

/** Decode an accept review whose assertions consume checkpoint-drop evidence. */
function parseCheckpointDropAcceptJson(
  stdout: string,
): CheckpointDropAcceptEnvelope {
  const result = parseAcceptJson(stdout);
  assertResultDataKey(result, "checkpoint_drops");
  assert(result.data.checkpoint_drops !== undefined);
  return {
    ...result,
    data: {
      ...result.data,
      checkpoint_drops: result.data.checkpoint_drops,
    },
  };
}

Deno.test("accept: report-mode Proof is non-landable in preview and apply", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    const reported = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(reported.code, 0, reported.output);

    const store = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(store !== undefined);
    await Deno.writeTextFile(store, "not json\n");

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    const previewResult = parseAcceptJson(preview.stdout);
    assertResultDataKey(previewResult, "queue");
    assert(
      previewResult.data.queue?.some((row) =>
        row.pending.some((item) => item.kind === "missing-evidence")
      ),
      preview.stdout,
    );
    assertEquals(previewResult.dry_run, true);

    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 1, apply.output);
    assertEquals(
      parseAcceptJson(apply.stdout).error,
      "checkpoint_evidence_unavailable",
    );
    assert(await targetExists(wt), "report-mode Proof must land nothing");
  });
});

Deno.test("accept: an indeterminate stop serves full evidence and excludes recorded grants", async () => {
  await withTempDir(async (dir) => {
    const config = CONFIG_WITH_GRANT.replace(
      `question = "${QUESTION}"`,
      `question = "${QUESTION}"\nwhen = "exit 7"`,
    );
    const wt = await checkpointedWorktree(dir, config);
    const served = await runAgent(wt, ["done", "--json"]);
    assertEquals(served.code, 1, served.output);
    const servedResult = decodeCliResult(served.stdout, "done");
    assertEquals(servedResult.error, AWAITING_DECLARATION_SLUG);
    assertStringIncludes(servedResult.message ?? "", "api/surface.txt");

    const gate = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(gate.code, 0, gate.output);

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(
      parseCheckpointDropAcceptJson(preview.stdout).data.checkpoint_drops[0]
        ?.reason,
      "when_invalid_exit",
    );

    // The standing grant covers the changed scope, but indeterminate stop
    // evidence deliberately requires this conversation's boolean attestation.
    const review = await runAgent(wt, ["accept", "--json"]);
    assertEquals(review.code, 1, review.output);
    const reviewEnv = parseCheckpointDropAcceptJson(review.stdout);
    assertEquals(reviewEnv.error, AWAITING_CONSENT_SLUG);
    assertEquals(
      reviewEnv.data.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );

    const landedSha = await gitOut(wt, "rev-parse", "HEAD");
    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 0, apply.output);
    const applied = parseAppliedAcceptJson(apply.stdout);
    assertEquals(applied.data.root, await Deno.realPath(dir));
    assertEquals(applied.prefix.consent, { source: "conversation" });
    assertEquals(
      applied.data.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );

    const payload = await landedNotePayload(dir, landedSha);
    assertEquals(
      payload.proof?.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );
  });
});

Deno.test("accept: unreadable declaration evidence refuses before landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    const gate = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(gate.code, 0, gate.output);
    const policyCommit = await gitOut(wt, "merge-base", "main", "HEAD");

    // The strict Proof was recorded against readable declaration state. This
    // corruption is first observable by proof inspection and acceptance.
    const store = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(store !== undefined);
    await Deno.writeTextFile(store, "not json\n");
    const liveDrop = (envelope: CheckpointDropAcceptEnvelope) =>
      envelope.data.checkpoint_drops.find((drop) =>
        drop.reason === "open_question_store_corrupt"
      );
    const declarationDrop = (envelope: CheckpointDropAcceptEnvelope) =>
      envelope.data.checkpoint_drops.find((drop) =>
        drop.reason === "declaration_evidence_unavailable"
      );

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(
      liveDrop(parseCheckpointDropAcceptJson(preview.stdout))?.policy_commit,
      policyCommit,
    );

    const review = await runAgent(wt, ["accept", "--json"]);
    assertEquals(review.code, 1, review.output);
    const reviewEnv = parseCheckpointDropAcceptJson(review.stdout);
    assertEquals(reviewEnv.error, "checkpoint_evidence_unavailable");
    assertStringIncludes(
      declarationDrop(reviewEnv)?.account ?? "",
      "declaration evidence could not be read",
    );

    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 1, apply.output);
    assertEquals(
      parseAcceptJson(apply.stdout).error,
      "checkpoint_evidence_unavailable",
    );
    assert(
      parseCheckpointDropAcceptJson(apply.stdout).data.checkpoint_drops.some(
        (drop) => drop.reason === "declaration_evidence_unavailable",
      ),
    );
    assert(await targetExists(wt), "unreadable declarations must land nothing");
  });
});
