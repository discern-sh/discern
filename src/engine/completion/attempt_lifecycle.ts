/**
 * One run's attempt over its candidate: reserved with the next repository
 * sequence, bound to the demand it will execute, and settled with an outcome.
 * Every transition is a compare-and-swap on the attempt record under the
 * common publication lock, so two runs never share a sequence or a claim.
 * Ownership is read from that record alone: a lapsed lease lets another run
 * retire the attempt, and only the retirement ends the claim.
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
  attemptHoldsClaim,
  CLAIM_NOT_HELD,
  claimLease,
  claimTakeoverPermitted,
  type CompletionAttempt,
} from "./attempt.ts";
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
          ...claimLease(now),
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
    );
    if (written.kind !== "written") {
      throw new Error(
        `Attempt reservation ${written.kind}; observe the records and run again.`,
      );
    }
    return { attempt, fence: { attempt_id: identity.id, token } };
  });
}

/**
 * Extend the claim the attempt record still names, whether or not its lease
 * lapsed meanwhile: a stalled owner that nobody retired resumes its lease.
 */
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
  const attempt = current.record.data;
  if (!attemptHoldsClaim(attempt, fence.token)) {
    return { kind: "claim-lost", reason: CLAIM_NOT_HELD };
  }
  return await writeCompletionRecord(
    root,
    {
      ...current.record,
      revision: current.record.revision + 1,
      data: {
        ...attempt,
        state: {
          ...attempt.state,
          claim: { ...attempt.state.claim, ...claimLease(clock.wallNow()) },
        },
      },
    },
    current.stamp,
    fence,
  );
}

/** One thrown value as the sentence a diagnostic prints. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One failed write outcome as the sentence a diagnostic prints. */
function writeFailureReason(
  outcome: Exclude<CompletionWriteOutcome, { readonly kind: "written" }>,
): string {
  return "reason" in outcome
    ? outcome.reason
    : `record version ${outcome.version}`;
}

/**
 * Only the attempt record itself proves a claim is gone. A busy lock, a lost
 * compare-and-swap race, and an unreadable store are conditions that clear, so
 * a renewal retries them on its next interval rather than cancelling a healthy
 * run; nor does the lease running out, which only lets another run retire it.
 */
export function claimLossIsProven(
  outcome: Exclude<CompletionWriteOutcome, { readonly kind: "written" }>,
): boolean {
  return outcome.kind === "claim-lost";
}

/** The abort reason a run receives once its attempt record proves the claim gone. */
export class AttemptClaimLost extends Error {
  constructor() {
    super(
      "Another discern run closed this completion attempt after it stopped renewing its claim, so its results were not recorded. Run the command again.",
    );
    this.name = "AttemptClaimLost";
  }
}

/** The claim-loss explanation behind a run's cancellation, when that is why it stopped. */
export function attemptClaimLossReason(
  signal: AbortSignal,
): string | undefined {
  return signal.aborted && signal.reason instanceof AttemptClaimLost
    ? signal.reason.message
    : undefined;
}

/**
 * Keep a live run's claim current; a proven loss aborts its remaining work.
 * Renewal runs on the event loop, so anything that stalls the loop — a
 * terminal that stops reading synchronous narration, a sleeping machine —
 * lets the lease lapse. That is deliberate: a run that is not progressing
 * should not keep others from retiring it. When the loop resumes, the overdue
 * renewal re-reads the record and either renews or learns of the retirement.
 */
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
  const loseClaim = (): void => {
    if (!lost.signal.aborted) lost.abort(new AttemptClaimLost());
  };
  // Only a record proving the claim gone ends the run. Any other failure
  // leaves the claim where it was, and the next interval retries.
  const renew = (): void => {
    renewals = renewals.then(async () => {
      if (lost.signal.aborted) return;
      try {
        const outcome = await renewAttemptClaim(root, fence, clock);
        if (outcome.kind !== "written" && claimLossIsProven(outcome)) {
          loseClaim();
        }
      } catch (error) {
        // The store reports every condition it meets as an outcome, so a
        // throw is a defect: the run stops on it rather than renewing blind.
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
      if (written.kind === "written") return;
      if (claimLossIsProven(written)) {
        // The run that retired this attempt already closed it. A run that is
        // not reporting a pass has nothing left to record; a pass cannot be.
        loseClaim();
        if (outcome !== "passed") return;
      }
      throw new Error(
        `Completion attempt settlement ${written.kind}: ${
          writeFailureReason(written)
        }`,
      );
    })();
    return settlement;
  };
  timer = scheduler.scheduleInterval(
    renew,
    ATTEMPT_CLAIM_RENEW_INTERVAL_MS,
  );
  const signal = AbortSignal.any([parentSignal, lost.signal]);
  let completion:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly failure: unknown };
  try {
    completion = { ok: true, value: await run(signal, settle) };
  } catch (error) {
    completion = { ok: false, failure: error };
  }
  await stopRenewing();
  try {
    await (settlement ?? settle(signal.aborted ? "cancelled" : "failed"));
  } catch (error) {
    // A failed settlement is never the reason the run ended; it is a second
    // failure beside one the run already has. Both are raised together so the
    // run's own reason leads and neither is lost. A run that ended by
    // awaiting that same settlement has one failure, raised once.
    if (completion.ok || completion.failure === error) throw error;
    throw new AggregateError(
      [completion.failure, error],
      `${errorMessage(completion.failure)} Its attempt also failed to settle: ${
        errorMessage(error)
      }`,
      { cause: error },
    );
  }
  if (completion.ok) return completion.value;
  throw completion.failure;
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
      !attemptHoldsClaim(current.record.data, observed.data.state.claim.token)
    ) {
      continue;
    }
    // Re-read after the owner probe: a renewal that landed meanwhile keeps
    // the claim, and the compare-and-swap below loses to one landing later.
    if (
      owner !== "gone" &&
      !claimTakeoverPermitted(current.record.data.state.claim, clock.wallNow())
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
    );
    // Every unapplied outcome leaves the claim exactly as it was: another
    // owner moved it, the lock was busy, or the store could not be written.
    // None of them can be repaired here, and none of them may escape the
    // result envelope, so the claim stays for the next run to retire. A claim
    // that still blocks is reported as its own pending cause, carrying the
    // attempt id and the effective expiry that explain it.
    if (written.kind === "written") {
      recovered.push(current.record.id);
    }
  }
  return recovered;
}

/** Bind the planned demand once: the planning claim becomes the claimed attempt. */
export async function bindAttemptDemand(
  root: string,
  execution: ClaimedExecution,
  plan: ValidationPlan,
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
      !attemptHoldsClaim(attempt.record.data, execution.fence.token) ||
      attempt.record.data.state.kind !== "planning"
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
    );
    if (written.kind !== "written") {
      throw new Error(
        `Validation binding publication ${written.kind}; run again.`,
      );
    }
    return { ...execution, attempt: updated };
  });
}

/**
 * Finish the attempt through its own fence; a finished attempt never reopens.
 * The record is re-validated under the publication lock, so settlement
 * succeeds after any stall during which nobody retired the attempt.
 */
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
  if (!attemptHoldsClaim(current.record.data, fence.token)) {
    return { kind: "claim-lost", reason: CLAIM_NOT_HELD };
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
  );
}
