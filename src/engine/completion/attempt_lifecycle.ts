/**
 * One run's attempt over its candidate: reserved with the next repository
 * sequence, bound to the demand it will execute, and settled with an outcome.
 * Every transition reads the attempt record and compare-and-swaps it inside
 * one common publication, so two runs never share a sequence or a claim and
 * no transition lands between another's read and write. Ownership is read
 * from that record alone: a lapsed lease lets another run retire the attempt,
 * and only the retirement ends the claim.
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
  AttemptClaimLost,
  attemptHoldsClaim,
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
import type { CompletionRecord } from "./records.ts";
import {
  type CompletionWriteOutcome,
  type CompletionWriteRefusal,
  FENCE_REFUSALS,
  type PublicationFence,
  readCompletionRecord,
  unreadableAttempt,
  withinCompletionPublication,
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

/** The attempt record as the store holds it, ready for a compare-and-swap. */
interface RecordedAttempt {
  readonly record: Extract<CompletionRecord, { readonly kind: "attempt" }>;
  readonly stamp: string;
}

/**
 * Read the attempt record and decide its successor inside one publication:
 * `next` sees the record as it stands, and nothing lands between that read
 * and the compare-and-swap `next` makes.
 */
async function transitionAttempt<T>(
  root: string,
  attemptId: string,
  next: (current: RecordedAttempt) => Promise<T>,
): Promise<T | CompletionWriteRefusal> {
  return await withinCompletionPublication(root, async () => {
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: attemptId,
    });
    if (current.kind !== "recorded" || current.record.kind !== "attempt") {
      return unreadableAttempt(attemptId);
    }
    return await next({ record: current.record, stamp: current.stamp });
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
  return await transitionAttempt(
    root,
    fence.attempt_id,
    async ({ record, stamp }) => {
      const attempt = record.data;
      if (!attemptHoldsClaim(attempt, fence.token)) {
        return FENCE_REFUSALS["claim-not-held"];
      }
      return await writeCompletionRecord(
        root,
        {
          ...record,
          revision: record.revision + 1,
          data: {
            ...attempt,
            state: {
              ...attempt.state,
              claim: { ...attempt.state.claim, ...claimLease(clock.wallNow()) },
            },
          },
        },
        stamp,
        fence,
      );
    },
  );
}

/** One thrown value as the sentence a diagnostic prints. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One failed write outcome as the sentence a diagnostic prints. */
function writeFailureReason(outcome: CompletionWriteRefusal): string {
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
export function claimLossIsProven(outcome: CompletionWriteRefusal): boolean {
  return outcome.kind === "claim-lost";
}

/**
 * Close the run's attempt with its outcome. A pass may carry its Proof, which
 * is then published in the transition that settles the attempt, so no
 * retirement can land between them. Resolves with why the attempt did not
 * settle as asked: another run retired it, or its Proof was refused and the
 * attempt settled failed. Any other settlement failure is raised.
 */
export type SettleAttempt = (
  outcome: "passed" | "failed" | "cancelled",
  proof?: CompletionRecord,
) => Promise<CompletionWriteRefusal | undefined>;

/**
 * How a claimed run ended. A retired run's outcome is the retirement,
 * whatever it returned or raised: another run closed its attempt, so nothing
 * it chose can be recorded. `value` is what it returned, if anything.
 */
export type ClaimedRun<T> =
  | { readonly kind: "settled"; readonly value: T }
  | { readonly kind: "retired"; readonly value: T | undefined };

/**
 * Keep a live run's claim current; a proven loss aborts its remaining work.
 * Renewal runs on the event loop, so anything that stalls the loop — a
 * terminal that stops reading synchronous narration, a sleeping machine —
 * lets the lease lapse. That is deliberate: a run that is not progressing
 * should not keep others from retiring it. When the loop resumes, the overdue
 * renewal re-reads the record and either renews or learns of the retirement.
 *
 * Whichever step learns of a retirement — a renewal, a fenced write, a
 * comparison, or settlement itself — the run ends `retired`. Settlement
 * always re-reads the record, so a retirement any earlier step found without
 * reporting it is found there too.
 */
export async function withAttemptClaim<T>(
  root: string,
  fence: PublicationFence,
  parentSignal: AbortSignal,
  run: (signal: AbortSignal, settle: SettleAttempt) => Promise<T>,
  timing: { readonly scheduler?: Scheduler; readonly clock?: Clock } = {},
): Promise<ClaimedRun<T>> {
  const scheduler = timing.scheduler ?? SYSTEM_SCHEDULER;
  const clock = timing.clock ?? SYSTEM_CLOCK;
  const lost = new AbortController();
  let renewals = Promise.resolve();
  let timer: IntervalHandle | undefined;
  let settlement: Promise<CompletionWriteRefusal | undefined> | undefined;
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
  const settle: SettleAttempt = (outcome, proof) => {
    settlement ??= (async () => {
      await stopRenewing();
      const settled = await settleAttempt(root, fence, outcome, clock, proof);
      if (settled.attempt.kind === "written") return settled.proof;
      if (claimLossIsProven(settled.attempt)) {
        // The run that retired this attempt already closed it.
        loseClaim();
        return settled.attempt;
      }
      throw new Error(
        `Completion attempt settlement ${settled.attempt.kind}: ${
          writeFailureReason(settled.attempt)
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
  let unsettled: { readonly failure: unknown } | undefined;
  try {
    await (settlement ?? settle(signal.aborted ? "cancelled" : "failed"));
  } catch (error) {
    unsettled = { failure: error };
  }
  if (lost.signal.reason instanceof AttemptClaimLost) {
    return {
      kind: "retired",
      value: completion.ok ? completion.value : undefined,
    };
  }
  if (unsettled !== undefined) {
    // A failed settlement is never the reason the run ended; it is a second
    // failure beside one the run already has. Both are raised together so the
    // run's own reason leads and neither is lost. A run that ended by
    // awaiting that same settlement has one failure, raised once.
    const error = unsettled.failure;
    if (completion.ok || completion.failure === error) throw error;
    throw new AggregateError(
      [completion.failure, error],
      `${errorMessage(completion.failure)} Its attempt also failed to settle: ${
        errorMessage(error)
      }`,
      { cause: error },
    );
  }
  if (completion.ok) return { kind: "settled", value: completion.value };
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
    const token = observed.data.state.claim.token;
    const owner = await (options.ownerState === undefined
      ? journalOwnerState(root, observed.data)
      : options.ownerState(observed.data));
    // Decide on the record as it stands after the owner probe, inside the
    // publication that retires it: a renewal or settlement that landed first
    // keeps the attempt, and none can land between this read and the write.
    const retired = await transitionAttempt(
      root,
      observed.id,
      async ({ record, stamp }) => {
        if (
          !attemptHoldsClaim(record.data, token) ||
          owner !== "gone" &&
            !claimTakeoverPermitted(record.data.state.claim, clock.wallNow())
        ) {
          return undefined;
        }
        return await writeCompletionRecord(
          root,
          {
            ...record,
            revision: record.revision + 1,
            data: {
              ...record.data,
              state: {
                kind: "finished",
                outcome: "cancelled",
                finished_at: clock.wallNow(),
              },
            },
          },
          stamp,
        );
      },
    );
    // Every unapplied outcome leaves the claim exactly as it was: another
    // owner moved it, the lock was busy, or the store could not be written.
    // None of them can be repaired here, and none of them may escape the
    // result envelope, so the claim stays for the next run to retire. A claim
    // that still blocks is reported as its own pending cause, carrying the
    // attempt id and the effective expiry that explain it.
    if (retired?.kind === "written") {
      recovered.push(observed.id);
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

/** What one settlement transition did to the attempt, and to its Proof. */
export interface AttemptSettlement {
  /** The attempt's own transition, or why it did not land. */
  readonly attempt: CompletionWriteOutcome;
  /** Why the Proof published with a pass was refused; the attempt then settled failed. */
  readonly proof?: CompletionWriteRefusal;
}

/**
 * Finish the attempt through its own fence; a finished attempt never reopens.
 * The record is read and written in one publication, so settlement succeeds
 * after any stall during which nobody retired the attempt. A pass's `proof`
 * is published inside the same transition, before the attempt finishes.
 */
export async function settleAttempt(
  root: string,
  fence: PublicationFence,
  outcome: "passed" | "failed" | "cancelled",
  clock: Clock = SYSTEM_CLOCK,
  proof?: CompletionRecord,
): Promise<AttemptSettlement> {
  const settled = await transitionAttempt(
    root,
    fence.attempt_id,
    async ({ record, stamp }): Promise<AttemptSettlement> => {
      if (!attemptHoldsClaim(record.data, fence.token)) {
        return { attempt: FENCE_REFUSALS["claim-not-held"] };
      }
      const published = proof === undefined
        ? undefined
        : await writeCompletionRecord(root, proof, null, fence);
      const refused = published?.kind === "written" ? undefined : published;
      const attempt = await writeCompletionRecord(
        root,
        {
          ...record,
          revision: record.revision + 1,
          data: {
            ...record.data,
            state: {
              kind: "finished",
              outcome: refused === undefined ? outcome : "failed",
              finished_at: clock.wallNow(),
            },
          },
        },
        stamp,
        fence,
      );
      return refused === undefined ? { attempt } : { attempt, proof: refused };
    },
  );
  return "attempt" in settled ? settled : { attempt: settled };
}
