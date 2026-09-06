/** Frozen attempt artifacts supplement the canonical environment phase record. */
import { z } from "@zod/zod";
import { EnvironmentDeclarationSchema } from "../../shared/config_schema.ts";
import { AttemptSchema, EnvironmentSchema } from "../completion/environment.ts";
import { CandidateSchema } from "../completion/candidate.ts";
import { NameSchema, RecordIdSchema } from "../completion/identity.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { readExecutionDocument } from "./artifact_read.ts";
import { releasedSubject } from "./subjects.ts";
import { SnapshotSchema } from "./snapshot_schema.ts";
export const ExecutionIntentSchema = z.strictObject({
  format: z.literal("execution-intent-v1"),
  environment_id: RecordIdSchema,
  environment: EnvironmentSchema,
  candidate_id: RecordIdSchema,
  candidate: CandidateSchema,
  attempt: AttemptSchema,
  context: NameSchema,
  recipe: z.union([
    z.strictObject({ action: z.literal("source-tip"), declaration: z.null() }),
    z.strictObject({
      action: z.enum(["borrow", "provision", "reuse"]),
      declaration: EnvironmentDeclarationSchema,
    }),
  ]),
  source: SnapshotSchema,
});
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

/** A replacement caller needs the same candidate, release, and original bytes. */
export async function loadExecutionIntent(
  root: string,
  attemptId: string,
  environmentId: string,
): Promise<ExecutionIntent> {
  const intent = ExecutionIntentSchema.parse(
    await readExecutionDocument(root, attemptId, "intent"),
  );
  if (
    intent.attempt.identity.id !== attemptId ||
    intent.environment_id !== environmentId ||
    intent.attempt.environment_id !== environmentId ||
    intent.attempt.identity.candidate_id !== intent.candidate_id ||
    await sha256Hex(JSON.stringify(intent.source.value)) !==
      intent.source.digest
  ) {
    throw new Error(
      "Frozen execution intent does not match its attempt, environment, or source snapshot. Retain the checkout and restore the exact recorded artifact.",
    );
  }
  if (
    intent.environment.release.kind !== "released" ||
    intent.environment.release.subject !==
      await releasedSubject(intent.environment, intent.source)
  ) {
    throw new Error(
      "Execution intent does not match its frozen release subject. Preserve both records for reconciliation.",
    );
  }
  return intent;
}
