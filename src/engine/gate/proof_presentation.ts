/** Retain the clean gate's presentation in common storage; it grants no authority. */
import { type Proof, ProofSchema } from "../../shared/result_schemas.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";
import { readCompleteProof } from "./completion_proof.ts";

/** A presentation must reproduce the complete immutable claim, never replace it. */
async function validatePresentation(
  root: string,
  pointer: CompletionProofPointer,
  value: unknown,
): Promise<Proof> {
  const proof = ProofSchema.parse(value);
  const complete = await readCompleteProof(root, pointer);
  if (
    JSON.stringify(proof.completion) !== JSON.stringify(complete) ||
    proof.head !== complete.candidate.head.slice(0, 12) ||
    proof.branch !==
      complete.candidate.source.branch.slice("refs/heads/".length) ||
    (proof.mode ?? "strict") !== complete.validation.mode
  ) {
    throw new Error(
      "The retained Proof presentation differs from its complete immutable evidence.",
    );
  }
  return proof;
}

/** Called only after the clean source's gate marker has been successfully recorded. */
export async function retainProofPresentation(
  root: string,
  pointer: CompletionProofPointer,
  value: Proof,
): Promise<void> {
  const proof = await validatePresentation(root, pointer, value);
  const complete = proof.completion;
  if (complete === undefined || complete.validation.review === undefined) {
    throw new Error(
      "A retained gate presentation requires complete candidate review.",
    );
  }
  const artifact = await saveEnvironmentArtifact(
    root,
    {
      attempt_id: complete.validation.attempt_id,
      candidate_id: pointer.candidate_id,
      context: complete.validation.review.context,
    },
    `gate-proof-${pointer.proof_id}`,
    proof,
  );
  const written = await writeCompletionRecord(root, {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "presentation",
    id: pointer.proof_id,
    revision: 1,
    data: { candidate_id: pointer.candidate_id, artifact },
  }, null);
  if (written.kind !== "written") {
    throw new Error(
      `Proof presentation publication ${written.kind}; preserve the source checkout and recover its complete evidence.`,
    );
  }
}

/** Read original jobs, measurements and renderings after the source checkout is retired. */
export async function readProofPresentation(
  root: string,
  pointer: CompletionProofPointer,
): Promise<Proof> {
  const retained = await readCompletionRecord(root, {
    kind: "presentation",
    id: pointer.proof_id,
  });
  const complete = await readCompleteProof(root, pointer);
  if (
    retained.kind !== "recorded" || retained.record.kind !== "presentation" ||
    retained.record.data.candidate_id !== pointer.candidate_id ||
    retained.record.data.artifact.attempt_id !==
      complete.validation.attempt_id ||
    retained.record.data.artifact.context !==
      complete.validation.review?.context ||
    retained.record.data.artifact.path !==
      `environment/gate-proof-${pointer.proof_id}.json`
  ) {
    throw new Error(
      "The clean gate's retained Proof presentation is unavailable; preserve the source and common evidence for recovery.",
    );
  }
  return await validatePresentation(
    root,
    pointer,
    await readEnvironmentArtifact(root, retained.record.data.artifact),
  );
}
