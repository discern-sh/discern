/** Canonical complete note subjects for focused durable-reader and writer guards. */
import { CompleteProofEvidenceSchema } from "../src/shared/completion_proof.ts";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
import type { Proof } from "../src/shared/result_schemas.ts";
import { completionFixtures } from "./completion_fixtures.ts";

/** A complete, settled fixture retains each component's producing attempt. */
export function completeNoteProof(
  commit: string,
  branch: string,
  mode: "strict" | "report" = "strict",
): Proof {
  const records = completionFixtures();
  const candidate = records.candidate;
  const evidence = records.evidence;
  const validation = records.proof;
  const attempt = records.attempt;
  if (
    candidate.kind !== "candidate" || evidence.kind !== "evidence" ||
    validation.kind !== "proof" || attempt.kind !== "attempt"
  ) throw new Error("completion fixture kinds differ");
  const complete = CompleteProofEvidenceSchema.parse({
    candidate_id: candidate.id,
    proof_id: validation.id,
    candidate: {
      ...candidate.data,
      head: commit,
      sources: [{
        ...candidateAuthor(candidate.data),
        head: commit,
        branch: `refs/heads/${branch}`,
      }],
    },
    validation: { ...validation.data, head: commit, mode },
    components: [{ id: evidence.id, evidence: { ...evidence.data, mode } }],
    attempts: [{
      ...attempt.data,
      mode,
      state: { kind: "finished", outcome: "passed", finished_at: 100 },
    }],
    executors: [attempt.data.identity.executor],
  });
  return {
    ...(mode === "report" ? { mode } : {}),
    branch,
    trunk: "main",
    head: commit.slice(0, 12),
    files_total: 1,
    insertions: 1,
    deletions: 0,
    line: `Proof for ${branch}`,
    markdown: `### Proof for ${branch}`,
    completion: complete,
  };
}
