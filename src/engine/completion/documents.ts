/** Data contracts for the documents a run retains beside its records. */
import { z } from "@zod/zod";
import { ProofCheckpointsSchema } from "../../shared/result_schemas.ts";
import { StandardLimitProposalSchema } from "../../shared/landing_decision_schemas.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { CompletionProofPointerSchema } from "../../shared/completion_proof.ts";
import { ObjectIdSchema, RecordIdSchema } from "./identity.ts";
import {
  type OpenQuestionsRead,
  parseOpenQuestionStore,
} from "../checkpoints/open_questions.ts";

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

/** The checkpoint conclusions and standard proposals a green run judged. */
export const CandidateReviewSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.candidateReview.version),
  head: ObjectIdSchema,
  predecessor: ObjectIdSchema,
  mode: z.enum(["strict", "report"]),
  stored: storedQuestionsSchema,
  checkpoints: ProofCheckpointsSchema.nullable(),
  proposals: z.array(StandardLimitProposalSchema),
});

/** A later complete Proof that settled an emergency landing's skipped checks. */
export const EmergencyResolutionSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.emergencyResolution.version),
  landing_id: RecordIdSchema,
  proof: CompletionProofPointerSchema,
  head: ObjectIdSchema,
  resolved_at: z.number(),
});
