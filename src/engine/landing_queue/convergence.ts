/** Post-landing checkout results are recovery facts, separate from validation Proof. */
import { z } from "@zod/zod";
import {
  DiagnosticSchema,
  StepResultJsonSchema,
} from "../../shared/result_schemas.ts";
import type { CompletionLanding } from "../completion/outcomes.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";

export const LandingConvergenceResultSchema = z.strictObject({
  ok: z.boolean(),
  steps: z.array(StepResultJsonSchema),
  diagnostics: z.array(DiagnosticSchema),
  hints: z.array(z.string()),
});
export type LandingConvergenceResult = z.infer<
  typeof LandingConvergenceResultSchema
>;
export type LandingConverger = (
  root: string,
  signal: AbortSignal,
) => Promise<LandingConvergenceResult>;

/** The retained result must belong to this exact candidate and landing attempt. */
export async function readLandingConvergenceResult(
  root: string,
  landing: CompletionLanding,
): Promise<LandingConvergenceResult | undefined> {
  const artifact = landing.convergence_result;
  if (artifact === undefined) return undefined;
  if (
    artifact.attempt_id !== landing.attempt_id ||
    artifact.candidate_id !== landing.candidate_id
  ) {
    throw new Error(
      "Checkout convergence results belong to another landing attempt or candidate.",
    );
  }
  return LandingConvergenceResultSchema.parse(
    await readEnvironmentArtifact(root, artifact),
  );
}
