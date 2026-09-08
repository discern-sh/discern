/** Data contracts for retained execution, review and landing artifacts. */
import { z } from "@zod/zod";
import {
  AcceptProofNoteSchema,
  DiagnosticSchema,
  ProofCheckpointsSchema,
  ProofSchema,
  StandardLimitProposalSchema,
  StepResultJsonSchema,
} from "../../shared/result_schemas.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { CompletionProofPointerSchema } from "../../shared/completion_proof.ts";
import { IgnoredFileChangeSummarySchema } from "../../shared/ignored_file_changes.ts";
import { ObjectIdSchema, RecordIdSchema } from "../completion/identity.ts";
import { EnvironmentSchema } from "../completion/environment.ts";
import { CandidateSchema } from "../completion/candidate.ts";
import {
  type OpenQuestionsRead,
  parseOpenQuestionStore,
} from "../checkpoints/open_questions.ts";
import { ExecutionIntentSchema } from "./intent.ts";
import { SnapshotSchema } from "./snapshot_schema.ts";
import { WorkspaceStateSchema } from "./workspace_state.ts";

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
export const CandidateReviewSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.candidateReview.version),
  head: ObjectIdSchema,
  predecessor: ObjectIdSchema,
  mode: z.enum(["strict", "report"]),
  stored: storedQuestionsSchema,
  checkpoints: ProofCheckpointsSchema.nullable(),
  proposals: z.array(StandardLimitProposalSchema),
});
export const RetirementCaptureSchema = z.strictObject({
  ignored_file_changes: IgnoredFileChangeSummarySchema.optional(),
  environment: EnvironmentSchema,
  snapshot: SnapshotSchema,
});
export const LandingNoteResultSchema = z.strictObject({
  proof_note: AcceptProofNoteSchema.optional(),
  hints: z.array(z.string()),
  reason: z.string().optional(),
});

export const EmergencyResolutionSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.emergencyResolution.version),
  landing_id: RecordIdSchema,
  proof: CompletionProofPointerSchema,
  head: ObjectIdSchema,
  resolved_at: z.number(),
});
export const LandingConvergenceResultSchema = z.strictObject({
  ok: z.boolean(),
  steps: z.array(StepResultJsonSchema),
  diagnostics: z.array(DiagnosticSchema),
  hints: z.array(z.string()),
});
export const StartedChildSchema = z.strictObject({
  pid: z.number().int().positive(),
  isolated: z.boolean(),
});

/** A known wrapper never makes an opaque adapter's unknown preservation contract disposable. */
const NativeSnapshotSchema = SnapshotSchema.extend({
  value: WorkspaceStateSchema,
});
const NativeIntentSchema = ExecutionIntentSchema.extend({
  source: NativeSnapshotSchema,
});
export const ExecutionArtifactDocumentSchema = z.union([
  NativeIntentSchema,
  NativeSnapshotSchema,
  CandidateSchema,
  CandidateReviewSchema,
  RetirementCaptureSchema.extend({ snapshot: NativeSnapshotSchema }),
  ProofSchema,
  LandingNoteResultSchema,
  LandingConvergenceResultSchema,
  EmergencyResolutionSchema,
  StartedChildSchema,
  z.strictObject({ token: RecordIdSchema }),
  z.literal(true),
]);

/** Unknown documents may contain references this engine cannot interpret. */
export function requireKnownExecutionArtifact(value: unknown): void {
  if (!ExecutionArtifactDocumentSchema.safeParse(value).success) {
    throw new Error(
      "An unknown recovery format or document prevents reclamation; preserve its artifacts for compatible reconciliation.",
    );
  }
}
