/** Emergency preparation carries settled judgment evidence without a passing Proof. */
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { ArtifactSchema } from "../completion/evidence.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { CompletionArtifact } from "../completion/artifacts.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { decodeJson } from "../../shared/runtime_decode.ts";
import { readOpenQuestions } from "../checkpoints/open_questions.ts";
import {
  assessCandidateReview,
  readCandidateReviewArtifact,
} from "../gate/candidate_review.ts";

const prefix = "emergency-review-v1.";

/** A handle names immutable review bytes; it conveys no integration authority. */
export function emergencyPreparationHandle(
  artifact: CompletionArtifact,
): string {
  return prefix +
    encodeBase64(new TextEncoder().encode(JSON.stringify(artifact)));
}

/** Recheck the receipt, exact subject, and current declarations before honoring settled triggers. */
export async function readEmergencyPreparation(
  root: string,
  config: DiscernConfig,
  candidateId: string,
  candidate: Candidate,
  handle: string,
): Promise<CompletionArtifact> {
  if (!handle.startsWith(prefix)) {
    throw new Error(
      "Use the preparation receipt returned by accept emergency --prepare.",
    );
  }
  const artifact = decodeJson(
    ArtifactSchema,
    new TextDecoder().decode(decodeBase64(handle.slice(prefix.length))),
    "emergency preparation receipt",
  );
  if (artifact.candidate_id !== candidateId) {
    throw new Error(
      "Emergency preparation belongs to another candidate. Prepare the current repair again.",
    );
  }
  const review = await readCandidateReviewArtifact(
    root,
    candidate,
    artifact,
    "strict",
    "emergency-review",
  );
  if (
    JSON.stringify(review.stored) !==
      JSON.stringify(await readOpenQuestions(root))
  ) {
    throw new Error(
      "Checkpoint declarations changed after preparation. Prepare the current repair again.",
    );
  }
  if (
    (review.checkpoints?.drops?.length ?? 0) > 0 ||
    (review.checkpoints?.declared_unmet.length ?? 0) > 0 ||
    review.proposals.length > 0
  ) {
    throw new Error(
      "Emergency preparation cannot approve checkpoint variances, missing evidence, or standard proposals.",
    );
  }
  const assessment = await assessCandidateReview(
    root,
    config,
    candidate,
    review,
  );
  if (assessment.blockers.length > 0) {
    throw new Error(
      "Emergency checkpoint evidence no longer matches this repair. Prepare it again.",
    );
  }
  return artifact;
}
