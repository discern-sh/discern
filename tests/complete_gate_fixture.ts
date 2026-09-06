import { recordGateOutcome } from "../src/engine/gate/proof.ts";
/** Complete immutable receipts for focused Proof-reader tests; no landing grant is created. */
import { assert } from "@std/assert";
import type { Proof } from "../src/shared/result_schemas.ts";
import type { CompletionProofPointer } from "../src/shared/completion_proof.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";
import { readCompleteProof } from "../src/engine/gate/completion_proof.ts";
import { COMPLETION_CLOCK, completionFixtures } from "./completion_fixtures.ts";
import { completeNoteProof } from "./completion_note_fixtures.ts";
import { gitOut } from "./engine_helpers.ts";

/** Publish fresh schema-valid records through the real claim, artifact and CAS boundaries. */
export async function completeGateFixture(root: string): Promise<{
  proof: Proof;
  pointer: CompletionProofPointer;
}> {
  const fixtures = completionFixtures();
  const { candidate, attempt, evidence, proof } = fixtures;
  assert(
    candidate.kind === "candidate" && attempt.kind === "attempt" &&
      evidence.kind === "evidence" && proof.kind === "proof",
  );
  const head = await gitOut(root, "rev-parse", "HEAD");
  const tree = await gitOut(root, "rev-parse", "HEAD^{tree}");
  const branch = await gitOut(root, "symbolic-ref", "--short", "HEAD");
  const candidateId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();
  const proofId = crypto.randomUUID();
  assert(attempt.data.state.kind === "claimed");
  const fence = {
    attempt_id: attemptId,
    token: attempt.data.state.claim.token,
  };
  const claimed = {
    ...attempt,
    id: attemptId,
    data: {
      ...attempt.data,
      identity: {
        ...attempt.data.identity,
        id: attemptId,
        candidate_id: candidateId,
      },
    },
  };
  const written = await writeCompletionRecord(
    root,
    claimed,
    null,
    undefined,
    COMPLETION_CLOCK,
  );
  assert(written.kind === "written", JSON.stringify(written));
  const candidateRecord = {
    ...candidate,
    id: candidateId,
    data: {
      ...candidate.data,
      attempt_id: attemptId,
      source: {
        ...candidate.data.source,
        head,
        tree,
        branch: `refs/heads/${branch}`,
      },
      head,
      tree,
      expected_predecessor: { head, candidate_id: null },
    },
  };
  const review = await saveEnvironmentArtifact(
    root,
    {
      attempt_id: attemptId,
      candidate_id: candidateId,
      context: "local",
    },
    "candidate-review",
    {
      version: 1,
      head,
      predecessor: head,
      mode: "strict",
      stored: await readOpenQuestions(root),
      checkpoints: null,
      proposals: [],
    },
  );
  const records: CompletionRecord[] = [candidateRecord, {
    ...evidence,
    id: evidenceId,
    data: {
      ...evidence.data,
      attempt_id: attemptId,
      candidate_id: candidateId,
      artifacts: evidence.data.artifacts.map((artifact) => ({
        ...artifact,
        attempt_id: attemptId,
        candidate_id: candidateId,
      })),
    },
  }, {
    ...proof,
    id: proofId,
    data: {
      ...proof.data,
      attempt_id: attemptId,
      candidate_id: candidateId,
      head,
      review,
      receipts: proof.data.receipts.map((receipt) => ({
        ...receipt,
        evidence_id: evidenceId,
        candidate_id: candidateId,
      })),
    },
  }];
  for (const record of records) {
    const published = await writeCompletionRecord(
      root,
      record,
      null,
      fence,
      COMPLETION_CLOCK,
    );
    assert(published.kind === "written", JSON.stringify(published));
  }
  const settled = await writeCompletionRecord(
    root,
    {
      ...claimed,
      revision: 2,
      data: {
        ...claimed.data,
        state: { kind: "finished", outcome: "passed", finished_at: 100 },
      },
    },
    written.stamp,
    fence,
    COMPLETION_CLOCK,
  );
  assert(settled.kind === "written", JSON.stringify(settled));
  const pointer = { candidate_id: candidateId, proof_id: proofId };
  return {
    pointer,
    proof: {
      ...completeNoteProof(head, branch),
      completion: await readCompleteProof(root, pointer),
    },
  };
}

/** Exercise the real marker writer using fresh complete receipts for its pinned source. */
export async function recordCompleteGateFixture(
  ...args: Parameters<typeof recordGateOutcome>
): ReturnType<typeof recordGateOutcome> {
  if (!args[2]) return await recordGateOutcome(...args);
  const fixture = await completeGateFixture(args[0]);
  return await recordGateOutcome(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4] ?? fixture.proof,
    args[5],
    args[6],
    fixture.pointer,
  );
}
