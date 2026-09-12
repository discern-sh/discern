import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Retained candidate review binds agent declarations separately from machine receipts. */
import type { z } from "@zod/zod";
import type { ProofCheckpointsData } from "../../shared/result_schemas.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { CandidateProof } from "../completion/evidence.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { CompletionSession } from "../completion/source_tip.ts";
import type { CandidateDecisions } from "../completion/authority.ts";
import {
  type CompletionArtifact,
  readCompletionArtifact,
  saveCompletionArtifact,
} from "../completion/artifacts.ts";
import { readOpenQuestions } from "../checkpoints/open_questions.ts";
import { inspectCheckpointObligations } from "../checkpoints/inspection.ts";
import { declarationMaterial } from "../checkpoints/evidence.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";

import { CandidateReviewSchema } from "../completion/documents.ts";
export type CandidateReview = z.infer<typeof CandidateReviewSchema>;

/** Capture before returning the validation checkout; no owner approval is created here. */
export async function captureCandidateReview(
  root: string,
  session: CompletionSession,
  checkpoints: ProofCheckpointsData | undefined,
  proposals: CandidateDecisions["proposals"],
): Promise<CompletionArtifact> {
  return await recordCandidateReview(
    root,
    session.execution.candidate,
    {
      attempt_id: session.execution.fence.attempt_id,
      candidate_id: session.execution.candidate_id,
    },
    session.mode,
    checkpoints,
    proposals,
  );
}

/** Retain settled checkpoint evidence independently of machine validation or landing authority. */
export async function recordCandidateReview(
  root: string,
  candidate: Candidate,
  subject: Pick<CompletionArtifact, "attempt_id" | "candidate_id">,
  mode: "strict" | "report",
  checkpoints: ProofCheckpointsData | undefined,
  proposals: CandidateDecisions["proposals"] = [],
  name: "candidate-review" | "emergency-review" = "candidate-review",
): Promise<CompletionArtifact> {
  const review = CandidateReviewSchema.parse({
    version: ON_DISK_FORMATS.candidateReview.version,
    head: candidate.head,
    predecessor: candidate.predecessor,
    mode,
    stored: await readOpenQuestions(root),
    checkpoints: checkpoints ?? null,
    proposals,
  });
  return await saveCompletionArtifact(root, subject, name, review);
}

/** A Proof cannot borrow another candidate's review or silently infer missing old evidence. */
export async function readCandidateReview(
  root: string,
  candidate: Candidate,
  proof: CandidateProof,
): Promise<CandidateReview> {
  if (
    proof.review === undefined ||
    proof.review.candidate_id !== proof.candidate_id ||
    proof.review.path !== "environment/candidate-review.json"
  ) {
    throw new Error(
      "Complete candidate review is missing; run discern done on the committed tree.",
    );
  }
  return await readCandidateReviewArtifact(
    root,
    candidate,
    proof.review,
    proof.mode,
  );
}

/** The artifact receipt authenticates bytes; its review must still name the exact change and mode. */
export async function readCandidateReviewArtifact(
  root: string,
  candidate: Candidate,
  artifact: CompletionArtifact,
  mode: "strict" | "report",
  name: "candidate-review" | "emergency-review" = "candidate-review",
): Promise<CandidateReview> {
  if (artifact.path !== `environment/${name}.json`) {
    throw new Error("The receipt does not name a candidate review.");
  }
  const review = CandidateReviewSchema.parse(
    await readCompletionArtifact(root, artifact),
  );
  if (
    review.head !== candidate.head ||
    review.predecessor !== candidate.predecessor ||
    review.mode !== mode
  ) {
    throw new Error(
      "Candidate review belongs to another subject or enforcement mode.",
    );
  }
  return review;
}

/** Re-evaluate definitions, triggers and subjects from immutable Git without running project code. */
export async function assessCandidateReview(
  root: string,
  config: DiscernConfig,
  candidate: Candidate,
  review: CandidateReview,
): Promise<
  { decisions: CandidateDecisions; blockers: readonly CompletionBlocker[] }
> {
  const inspection = await inspectCheckpointObligations(root, config, {
    predecessor: candidate.predecessor,
    currentCommit: candidate.head,
    stored: review.stored,
    whenSettled: true,
  });
  const blockers: CompletionBlocker[] = [];
  const judgments: CandidateDecisions["judgments"] = [];
  for (const entry of inspection.entries) {
    if (entry.definition.mode !== "stop" || entry.obligation.state === "none") {
      continue;
    }
    const declaration = entry.openQuestion?.declaration;
    if (
      declaration === undefined ||
      (entry.obligation.state !== "declared_met" &&
        entry.obligation.state !== "declared_unmet")
    ) {
      blockers.push({
        kind: "missing-judgment",
        subjects: [entry.definition.id],
      });
      continue;
    }
    judgments.push({
      checkpoint: entry.definition.id,
      subject: declaration.subject,
      declaration: await sha256Hex(declarationMaterial(declaration)),
    });
  }
  // Runtime predicate accounts stay bound to the retained attempt; this read rechecks structural facts without executing those predicates.
  if (
    JSON.stringify(inspection.drops) !==
      JSON.stringify(
        (review.checkpoints?.drops ?? []).filter((drop) =>
          !drop.reason.startsWith("when_")
        ),
      )
  ) {
    blockers.push({
      kind: "missing-judgment",
      subjects: ["checkpoint-reading-changed"],
    });
  }
  return {
    decisions: { judgments, variances: [], proposals: review.proposals },
    blockers,
  };
}
