/**
 * One run's attempt over its candidate: reserved with the next repository
 * sequence, bound to the demand it will execute, and settled with an outcome.
 * Every transition is a compare-and-swap on the attempt record under the
 * common publication lock, so two runs never share a sequence or a claim.
 */
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import {
  type IntervalHandle,
  type Scheduler,
  SYSTEM_SCHEDULER,
} from "../../shared/scheduler.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import {
  ATTEMPT_CLAIM_LEASE_MS,
  type CompletionAttempt,
  effectiveClaimExpiry,
} from "./attempt.ts";
export { ATTEMPT_CLAIM_LEASE_MS } from "./attempt.ts";
import { applicabilitySubject } from "./evidence.ts";
import { type Executor, newAttemptIdentity } from "./identity.ts";
import { readOperationJournal } from "./operation_journal.ts";
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

/** Renew well before expiry without coupling ownership to any project timeout. */
export const ATTEMPT_CLAIM_RENEW_INTERVAL_MS = 20_000;

export type AttemptOwnerState = "running" | "gone" | "unknown";

export interface AttemptRecoveryOptions {
  readonly clock?: Clock;
  readonly ownerState?: (
    attempt: CompletionAttempt,
  ) => Promise<AttemptOwnerState>;
}

/** A missing journal is uncertainty; only an exact recorded owner can be declared gone. */
async function journalOwnerState(
  root: string,
  attempt: CompletionAttempt,
): Promise<AttemptOwnerState> {
  const handle = attempt.identity.executor.operation_handle;
  if (handle === undefined) return "unknown";
  const reading = await readOperationJournal(root, handle);
  if (reading.kind !== "found" || reading.handle !== handle) return "unknown";
  return reading.executor;
}

/** Reserve the next repository-wide sequence and publish the planning claim. */
export async function reserveAttempt(
  root: string,
  input: {
    readonly candidate_id: string;
    readonly executor: Executor;
    readonly rerun_of: string | null;
    readonly mode: "strict" | "report";
  },
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<ReservedAttempt> {
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
          renewed_at: now,
          expires_at: now + ATTEMPT_CLAIM_LEASE_MS,
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

/** Extend one still-current claim without changing its fencing token. */
export async function renewAttemptClaim(
  root: string,
  fence: PublicationFence,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionWriteOutcome> {
  const current = await readCompletionRecord(root, {
    kind: "attempt",
    id: fence.attempt_id,
  });
  if (current.kind !== "recorded" || current.record.kind !== "attempt") {
    return { kind: "unavailable", reason: "the attempt record is unreadable" };
  }
  const state = current.record.data.state;
  const now = clock.wallNow();
  if (
    state.kind === "finished" || state.claim.token !== fence.token ||
    effectiveClaimExpiry(state.claim, ATTEMPT_CLAIM_LEASE_MS) <= now
  ) {
    return {
      kind: "claim-lost",
      reason: "The attempt claim was lost, expired, or superseded.",
    };
  }
  return await writeCompletionRecord(
    root,
    {
      ...current.record,
      revision: current.record.revision + 1,
      data: {
        ...current.record.data,
        state: {
          ...state,
          claim: {
            ...state.claim,
            renewed_at: now,
            expires_at: now + ATTEMPT_CLAIM_LEASE_MS,
          },
        },
      },
    },
    current.stamp,
    fence,
    clock,
  );
}

/** Keep a live run's claim current; lease loss aborts its remaining work. */
export async function withAttemptClaim<T>(
  root: string,
  fence: PublicationFence,
  parentSignal: AbortSignal,
  run: (
    signal: AbortSignal,
    settle: (
      outcome: "passed" | "failed" | "cancelled",
    ) => Promise<void>,
  ) => Promise<T>,
  timing: { readonly scheduler?: Scheduler; readonly clock?: Clock } = {},
): Promise<T> {
  const scheduler = timing.scheduler ?? SYSTEM_SCHEDULER;
  const clock = timing.clock ?? SYSTEM_CLOCK;
  const lost = new AbortController();
  let renewals = Promise.resolve();
  let timer: IntervalHandle | undefined;
  let settlement: Promise<void> | undefined;
  const renew = (): void => {
    renewals = renewals.then(async () => {
      if (lost.signal.aborted) return;
      try {
        const outcome = await renewAttemptClaim(root, fence, clock);
        if (outcome.kind !== "written") {
          lost.abort(
            new Error(
              `Completion claim renewal ${outcome.kind}: ${
                "reason" in outcome
                  ? outcome.reason
                  : `record version ${outcome.version}`
              }`,
            ),
          );
        }
      } catch (error) {
        lost.abort(error);
      }
    });
  };
  const stopRenewing = async (): Promise<void> => {
    if (timer !== undefined) {
      scheduler.cancelInterval(timer);
      timer = undefined;
    }
    await renewals;
  };
  const settle = (
    outcome: "passed" | "failed" | "cancelled",
  ): Promise<void> => {
    settlement ??= (async () => {
      await stopRenewing();
      const written = await settleAttempt(root, fence, outcome, clock);
      if (written.kind !== "written") {
        throw new Error(
          `Completion attempt settlement ${written.kind}: ${
            "reason" in written
              ? written.reason
              : `record version ${written.version}`
          }`,
        );
      }
    })();
    return settlement;
  };
  timer = scheduler.scheduleInterval(
    renew,
    ATTEMPT_CLAIM_RENEW_INTERVAL_MS,
  );
  const signal = AbortSignal.any([parentSignal, lost.signal]);
  try {
    return await run(signal, settle);
  } finally {
    await stopRenewing();
    if (settlement === undefined) {
      await settle(signal.aborted ? "cancelled" : "failed");
    } else {
      await settlement;
    }
  }
}

/** Cancel every dead or expired claim with CAS before a replacement is reserved. */
export async function recoverAbandonedAttempts(
  root: string,
  options: AttemptRecoveryOptions,
): Promise<string[]> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const observation = await observeCompletionRecords(root, clock, ["attempt"]);
  const recovered: string[] = [];
  for (const entry of observation.records) {
    if (
      entry.reading.kind !== "recorded" ||
      entry.reading.record.kind !== "attempt"
    ) continue;
    const observed = entry.reading.record;
    if (observed.data.state.kind === "finished") continue;
    const owner = await (options.ownerState === undefined
      ? journalOwnerState(root, observed.data)
      : options.ownerState(observed.data));
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: observed.id,
    });
    if (
      current.kind !== "recorded" || current.record.kind !== "attempt" ||
      current.record.data.state.kind === "finished" ||
      current.record.data.state.claim.token !== observed.data.state.claim.token
    ) {
      continue;
    }
    const state = current.record.data.state;
    if (
      owner !== "gone" &&
      effectiveClaimExpiry(state.claim, ATTEMPT_CLAIM_LEASE_MS) >
        clock.wallNow()
    ) {
      continue;
    }
    const written = await writeCompletionRecord(
      root,
      {
        ...current.record,
        revision: current.record.revision + 1,
        data: {
          ...current.record.data,
          state: {
            kind: "finished",
            outcome: "cancelled",
            finished_at: clock.wallNow(),
          },
        },
      },
      current.stamp,
      undefined,
      clock,
    );
    if (written.kind === "written") {
      recovered.push(current.record.id);
    } else if (written.kind !== "conflict" && written.kind !== "claim-lost") {
      throw new Error(
        `Abandoned attempt recovery ${written.kind}: ${
          "reason" in written
            ? written.reason
            : `record version ${written.version}`
        }`,
      );
    }
  }
  return recovered;
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
      effectiveClaimExpiry(attempt.record.data.state.claim) <= clock.wallNow()
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
