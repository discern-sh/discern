/** Canonical complete note subjects for focused durable-reader and writer guards. */
import {
  CompleteProofEvidenceSchema,
  type LandedAuthorityEvidence,
} from "../src/shared/completion_proof.ts";
import type { Proof } from "../src/shared/result_schemas.ts";
import { completionFixtures, completionId } from "./completion_fixtures.ts";

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
      source: {
        ...candidate.data.source,
        head: commit,
        branch: `refs/heads/${branch}`,
      },
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

/** A normal grant has only this exact source and this one consumed landing. */
export function completeNoteAuthority(proof: Proof): LandedAuthorityEvidence {
  const authority = completionFixtures().authority;
  const complete = proof.completion;
  if (authority.kind !== "authority" || complete === undefined) {
    throw new Error("missing complete fixture");
  }
  const executor = complete.executors[0];
  if (executor === undefined) throw new Error("missing executor");
  return {
    authority_id: authority.id,
    landing_id: completionId(71),
    executor,
    authority: {
      ...authority.data,
      sources: [complete.candidate.source],
      policy: complete.candidate.policy,
      composition_procedure: complete.candidate.composition.procedure,
      state: { kind: "consumed", landing_id: completionId(71), at: 101 },
    },
  };
}
