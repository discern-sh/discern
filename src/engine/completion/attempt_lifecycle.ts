/**
 * One run's attempt over its candidate: reserved with the next repository
 * sequence, bound to the demand it will execute, and settled with an outcome.
 * Every transition is a compare-and-swap on the attempt record under the
 * common publication lock, so two runs never share a sequence or a claim.
 */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import type { CompletionAttempt } from "./attempt.ts";
import { applicabilitySubject } from "./evidence.ts";
import { type Executor, newAttemptIdentity } from "./identity.ts";
import {
  type ClaimedExecution,
  type ValidationPlan,
  validationPurpose,
} from "./protocol.ts";
import {
  type CompletionWriteOutcome,
  type PublicationFence,
  readCompletionRecord,
  writeCompletionRecord,
} from "./store.ts";

export interface ReservedAttempt {
  readonly attempt: CompletionAttempt;
  readonly fence: PublicationFence;
}

/** The lease covers every configured producer, extraction, and the gate's own budget. */
export async function attemptLease(config: DiscernConfig): Promise<number> {
  const graph = await configuredValidation(config, Object.keys(config.scopes));
  const seconds = (timeout: number | undefined): number => {
    const value = timeout ?? config.gate.timeout;
    return value > 0 ? value : 86_400;
  };
  const producers = Object.values(graph.producers).reduce(
    (total, producer) => total + seconds(producer.timeout),
    0,
  );
  const extraction = graph.obligations.reduce(
    (total, obligation) =>
      total +
      (obligation.input.extract === undefined ? 0 : seconds(
        graph.timeouts.get(`standards.${obligation.requirement.id}`)?.seconds,
      )),
    0,
  );
  const procedures = 2 * Math.max(1, config.gate.timeout);
  return 60_000 + (producers + extraction + procedures) * 1000;
}

/** Reserve the next repository-wide sequence and publish the planning claim. */
export async function reserveAttempt(
  root: string,
  input: {
    readonly candidate_id: string;
    readonly executor: Executor;
    readonly rerun_of: string | null;
    readonly mode: "strict" | "report";
    readonly lease_ms: number;
  },
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<ReservedAttempt> {
  if (!Number.isSafeInteger(input.lease_ms) || input.lease_ms <= 0) {
    throw new TypeError("An attempt requires a finite positive lease.");
  }
  return await withCompletionPublication(root, async () => {
    const observation = await observeCompletionRecords(root, clock, [
      "attempt",
    ]);
    let sequence = 0;
    for (const { reading } of observation.records) {
      if (reading.kind === "recorded" && reading.record.kind === "attempt") {
        sequence = Math.max(sequence, reading.record.data.identity.sequence);
      }
    }
    const identity = newAttemptIdentity(
      {
        candidate_id: input.candidate_id,
        executor: input.executor,
        sequence: sequence + 1,
        rerun_of: input.rerun_of,
      },
      clock,
      entropy,
    );
    const now = clock.wallNow();
    const token = entropy.uuid();
    const attempt: CompletionAttempt = {
      identity,
      subjects: [],
      mode: input.mode,
      purpose: "completion",
      state: {
        kind: "planning",
        claim: {
          token,
          executor: input.executor,
          acquired_at: now,
          expires_at: now + input.lease_ms,
        },
      },
    };
    const written = await writeCompletionRecord(
      root,
      {
        version: ON_DISK_FORMATS.completionRecord.version,
        kind: "attempt",
        id: identity.id,
        revision: 1,
        data: attempt,
      },
      null,
      undefined,
      clock,
    );
    if (written.kind !== "written") {
      throw new Error(
        `Attempt reservation ${written.kind}; observe the records and run again.`,
      );
    }
    return { attempt, fence: { attempt_id: identity.id, token } };
  });
}

/** Bind the planned demand once: the planning claim becomes the claimed attempt. */
export async function bindAttemptDemand(
  root: string,
  execution: ClaimedExecution,
  plan: ValidationPlan,
  clock: Clock = SYSTEM_CLOCK,
): Promise<ClaimedExecution> {
  if (
    plan.candidate_id !== execution.candidate_id ||
    plan.blockers.length !== 0 ||
    JSON.stringify(plan.candidate) !== JSON.stringify(execution.candidate)
  ) {
    throw new Error("Validation binding differs from the claimed candidate.");
  }
  return await withCompletionPublication(root, async () => {
    const attempt = await readCompletionRecord(root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    if (
      attempt.kind !== "recorded" || attempt.record.kind !== "attempt" ||
      attempt.record.data.state.kind !== "planning" ||
      attempt.record.data.state.claim.token !== execution.fence.token ||
      attempt.record.data.state.claim.expires_at <= clock.wallNow()
    ) {
      throw new Error(
        "The attempt is no longer eligible to bind validation; run again.",
      );
    }
    const updated: CompletionAttempt = {
      ...attempt.record.data,
      state: {
        kind: "claimed",
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
        `Validation binding publication ${written.kind}; run again.`,
      );
    }
    return { ...execution, attempt: updated };
  });
}

/** Finish the attempt through its own fence; a finished attempt never reopens. */
export async function settleAttempt(
  root: string,
  fence: PublicationFence,
  outcome: "passed" | "failed" | "cancelled",
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionWriteOutcome> {
  const current = await readCompletionRecord(root, {
    kind: "attempt",
    id: fence.attempt_id,
  });
  if (current.kind !== "recorded" || current.record.kind !== "attempt") {
    return { kind: "unavailable", reason: "the attempt record is unreadable" };
  }
  if (current.record.data.state.kind === "finished") {
    return {
      kind: "claim-lost",
      reason: "A finished attempt has no live publication claim.",
    };
  }
  return await writeCompletionRecord(
    root,
    {
      ...current.record,
      revision: current.record.revision + 1,
      data: {
        ...current.record.data,
        state: { kind: "finished", outcome, finished_at: clock.wallNow() },
      },
    },
    current.stamp,
    fence,
    clock,
  );
}
