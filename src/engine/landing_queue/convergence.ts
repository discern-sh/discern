/** Post-landing checkout results are recovery facts, separate from validation Proof. */
import type { z } from "@zod/zod";
import type { CompletionLanding } from "../completion/outcomes.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";

import { LandingConvergenceResultSchema } from "../execution/artifact_contracts.ts";
export { LandingConvergenceResultSchema } from "../execution/artifact_contracts.ts";
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

/** Every new integration waits until the previous ref transition and required checkout work are settled. */
export async function landingNeedsRecovery(
  root: string,
  landing: CompletionLanding,
): Promise<boolean> {
  if (landing.outcome.kind === "not-landed") return false;
  return landing.outcome.kind !== "landed" ||
    landing.authority_settlement !== "consumed" ||
    landing.note !== "published" ||
    (await readLandingConvergenceResult(root, landing))?.ok !== true;
}
