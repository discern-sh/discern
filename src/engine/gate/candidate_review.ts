/** Retained candidate review binds agent declarations separately from machine receipts. */
import { z } from "@zod/zod";
import {
  type ProofCheckpointsData,
  ProofCheckpointsSchema,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { ObjectIdSchema } from "../completion/identity.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { CandidateProof } from "../completion/evidence.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { CompletionSession } from "../landing_queue/public_completion.ts";
import type { CandidateDecisions } from "../landing_queue/authority.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";
import type { EnvironmentArtifact } from "../execution/types.ts";
import {
  type OpenQuestionsRead,
  parseOpenQuestionStore,
  readOpenQuestions,
} from "../checkpoints/open_questions.ts";
import { inspectCheckpointObligations } from "../checkpoints/inspection.ts";
import { declarationMaterial } from "../checkpoints/evidence.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";

const storedQuestionsSchema = z.unknown().transform(
  (value, context): OpenQuestionsRead => {
    if (typeof value === "object" && value !== null && "status" in value) {
      if (value.status === "missing") return { status: "missing" };
      if (value.status === "ok" && "openQuestions" in value) {
        const questions = parseOpenQuestionStore(
          JSON.stringify({
            version: ON_DISK_FORMATS.checkpointOpenQuestions.version,
            openQuestions: value.openQuestions,
          }),
        );
        if (questions !== undefined) {
          return { status: "ok", openQuestions: questions };
        }
      }
      if (
        (value.status === "invalid" || value.status === "unavailable" ||
          value.status === "newer") &&
        "reason" in value && typeof value.reason === "string"
      ) return { status: value.status, reason: value.reason };
    }
    context.addIssue({
      code: "custom",
      message: "Retained checkpoint questions cannot be read.",
    });
    return {
      status: "invalid",
      reason: "Retained checkpoint questions cannot be read.",
    };
  },
);
const CandidateReviewSchema = z.strictObject({
  version: z.literal(1),
  head: ObjectIdSchema,
  predecessor: ObjectIdSchema,
  mode: z.enum(["strict", "report"]),
  stored: storedQuestionsSchema,
  checkpoints: ProofCheckpointsSchema.nullable(),
  proposals: z.array(StandardLimitProposalSchema),
});
export type CandidateReview = z.infer<typeof CandidateReviewSchema>;

/** Capture before returning the validation checkout; no owner approval is created here. */
export async function captureCandidateReview(
  root: string,
  session: CompletionSession,
  checkpoints: ProofCheckpointsData | undefined,
  proposals: CandidateDecisions["proposals"],
): Promise<EnvironmentArtifact> {
  const candidate = session.execution.candidate;
  const review = CandidateReviewSchema.parse({
    version: 1,
    head: candidate.head,
    predecessor: candidate.expected_predecessor.head,
    mode: session.mode,
    stored: await readOpenQuestions(root),
    checkpoints: checkpoints ?? null,
    proposals,
  });
  return await saveEnvironmentArtifact(
    root,
    {
      attempt_id: session.execution.fence.attempt_id,
      candidate_id: session.execution.candidate_id,
      context: session.context,
    },
    "candidate-review",
    review,
  );
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
      "Complete candidate review is missing; run done in an eligible environment.",
    );
  }
  const review = CandidateReviewSchema.parse(
    await readEnvironmentArtifact(root, proof.review),
  );
  if (
    review.head !== candidate.head ||
    review.predecessor !== candidate.expected_predecessor.head ||
    review.mode !== proof.mode
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
    predecessor: candidate.expected_predecessor.head,
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
  // Existing fail-open checkpoint accounts remain explicit; a later reading cannot add new uncertainty.
  if (
    JSON.stringify(inspection.drops) !==
      JSON.stringify(review.checkpoints?.drops ?? [])
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
