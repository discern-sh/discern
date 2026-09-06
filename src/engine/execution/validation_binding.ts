/** Composition binds its immutable result before producers start in the same lease. */
import { CandidateSchema } from "../completion/candidate.ts";
import { applicabilitySubject } from "../completion/evidence.ts";
import {
  type ClaimedExecution,
  type ValidationPlan,
  validationPurpose,
} from "../completion/protocol.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { saveEnvironmentArtifact } from "./artifacts.ts";
import { artifactPath } from "./artifact_read.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";

/** Recovery reads only a result published by this attempt for the same exact source. */
export async function restoreValidationBinding(
  root: string,
  execution: ClaimedExecution,
): Promise<ClaimedExecution> {
  const raw = await readTextIfExists(
    await artifactPath(
      root,
      execution.fence.attempt_id,
      "environment/validation-candidate.json",
    ),
  );
  if (raw === undefined) return execution;
  const candidate = CandidateSchema.parse(JSON.parse(raw));
  const recorded = await readCompletionRecord(root, {
    kind: "candidate",
    id: execution.candidate_id,
  });
  if (
    recorded.kind !== "recorded" || recorded.record.kind !== "candidate" ||
    (candidate.attempt_id !== execution.fence.attempt_id &&
      JSON.stringify(candidate) !== JSON.stringify(execution.candidate)) ||
    JSON.stringify(candidate.source) !==
      JSON.stringify(execution.candidate.source) ||
    JSON.stringify(candidate) !== JSON.stringify(recorded.record.data)
  ) {
    throw new Error(
      "The composed validation subject is unavailable or changed; preserve its environment.",
    );
  }
  return { ...execution, candidate };
}

/** Retain the composed identity before judgment can stop validation and request restoration. */
export async function retainExecutionCandidate(
  root: string,
  execution: ClaimedExecution,
  candidate: ClaimedExecution["candidate"],
  context: string,
): Promise<ClaimedExecution> {
  await saveEnvironmentArtifact(
    root,
    {
      attempt_id: execution.fence.attempt_id,
      candidate_id: execution.candidate_id,
      context,
    },
    "validation-candidate",
    candidate,
  );
  return await restoreValidationBinding(root, execution);
}

/** Only a live empty composition claim can enroll a complete validation demand once. */
export async function bindExecutionValidation(
  root: string,
  execution: ClaimedExecution,
  plan: ValidationPlan,
  clock: Clock = SYSTEM_CLOCK,
): Promise<ClaimedExecution> {
  if (
    plan.candidate_id !== execution.candidate_id ||
    plan.blockers.length !== 0 ||
    JSON.stringify(plan.candidate.source) !==
      JSON.stringify(execution.candidate.source)
  ) {
    throw new Error(
      "Validation binding differs from the claimed composition source.",
    );
  }
  return await withCompletionPublication(root, async () => {
    const attempt = await readCompletionRecord(root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    const environment = await readCompletionRecord(root, {
      kind: "environment",
      id: execution.environment_id,
    });
    if (
      attempt.kind !== "recorded" || attempt.record.kind !== "attempt" ||
      attempt.record.data.subjects.length !== 0 ||
      attempt.record.data.state.kind !== "composing" ||
      attempt.record.data.state.claim.token !== execution.fence.token ||
      attempt.record.data.state.claim.expires_at <= clock.wallNow() ||
      environment.kind !== "recorded" ||
      environment.record.kind !== "environment" ||
      environment.record.data.state.kind !== "executing" ||
      environment.record.data.state.phase !== "validate" ||
      environment.record.data.state.claim.token !== execution.fence.token
    ) {
      throw new Error(
        "Composition claim is no longer eligible to bind validation.",
      );
    }
    const bound = await retainExecutionCandidate(
      root,
      execution,
      plan.candidate,
      plan.demand.context,
    );
    const updated = {
      ...attempt.record.data,
      state: {
        kind: "claimed" as const,
        claim: attempt.record.data.state.claim,
      },
      mode: plan.demand.mode,
      purpose: validationPurpose(plan.demand),
      subjects: [
        ...new Set(
          await Promise.all(
            plan.producers.flatMap((producer) =>
              producer.evidence_subjects.map(applicabilitySubject)
            ),
          ),
        ),
      ],
    };
    const written = await writeCompletionRecord(
      root,
      {
        ...attempt.record,
        revision: attempt.record.revision + 1,
        data: updated,
      },
      attempt.stamp,
      undefined,
      clock,
    );
    if (written.kind !== "written") {
      throw new Error(
        `Validation binding publication ${written.kind}; retain the composed environment.`,
      );
    }
    return { ...bound, attempt: updated, environment: environment.record.data };
  });
}
