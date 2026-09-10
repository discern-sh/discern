import { executionRecoveryCommand } from "../../shared/execution_recovery.ts";
import {
  completionRecordBlocker,
  readCompatibleCompletionRecord,
} from "../completion/compatibility.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Short work claims fence publication while environment leases own checkout effects. */
import type { Candidate } from "../completion/candidate.ts";
import type { CompletionPolicy } from "../../shared/config_schema.ts";
import type { CompletionAttempt } from "../completion/environment.ts";
import { finishedValidationAttempts } from "../validation/selection.ts";
import type { Executor } from "../completion/identity.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
} from "../completion/protocol.ts";
import type {
  CompletionWriteOutcome,
  PublicationFence,
} from "../completion/store.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import { withQueueLock } from "./repository.ts";
import { expectedPredecessor, orderedEntries, sameSource } from "./model.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  REPOSITORY_QUEUE_ID,
  requireQueue,
  reserveQueueAttempt,
} from "./repository.ts";

export interface QueueWorkClaim {
  readonly fence: PublicationFence;
  readonly attempt: CompletionAttempt;
  readonly effort: string;
}

/** Invalidated work occupies capacity until its execution environment has returned. */
export function retainedExecutionCount(
  entries: ReturnType<typeof orderedEntries>,
  observation: CompletionObservation,
): number {
  const active = new Set(
    entries.filter((entry) => entry.state === "active").map((entry) =>
      entry.candidate_id
    ),
  );
  const records = observedRecords(observation);
  return records.filter((record) => {
    if (record.kind !== "environment") return false;
    const state = record.data.state;
    if (state.kind !== "executing" && state.kind !== "recovery") return false;
    const attempt = records.find((item) =>
      item.kind === "attempt" && item.id === state.attempt_id
    );
    return attempt?.kind !== "attempt" ||
      !active.has(attempt.data.identity.candidate_id);
  }).length;
}

/** The one queue slot the effort landing next keeps whenever a later effort asks. */
export const HEAD_RESERVED_SLOTS = 1;

/**
 * Queue slots a later effort may hold while the head effort keeps its
 * reservation: the enforcing arithmetic and the configuration facts setup and
 * doctor describe both read this, so they cannot drift apart.
 */
export function nonHeadWorkSlots(policy: CompletionPolicy): number {
  return policy.concurrency - HEAD_RESERVED_SLOTS;
}

/** Capacity counts unresolved rows too: a crashed claim gap cannot silently free a slot. */
export function workCapacity(
  entries: ReturnType<typeof orderedEntries>,
  effort: string,
  policy: CompletionPolicy,
  sourceTip = false,
  retainedExecutions = 0,
  /** Why early validation cannot run here, when the environment it would
   * use has not been proved; the head effort's own validation is unaffected. */
  unproven?: CompletionBlocker,
): CompletionBlocker | undefined {
  const index = entries.findIndex((entry) => entry.source.effort_id === effort);
  if (index < 0) {
    return { kind: "missing-judgment", subjects: ["effort-not-selected"] };
  }
  const active = entries.filter((entry) => entry.state === "active");
  if (active.some((entry) => entry.source.effort_id === effort)) {
    return {
      kind: "environment-unavailable",
      reason:
        "This candidate already has a work reservation; inspect its attempt or reconcile the claim gap.",
    };
  }
  const headActive = entries[0]?.state === "active";
  const reserved = index > 0 && !headActive &&
      (!sourceTip || entries[0]?.authority_id !== null)
    ? HEAD_RESERVED_SLOTS
    : 0;
  const depth = !sourceTip && index > policy.lookahead;
  // Inside lookahead but not at the head: this would be early validation in a
  // temporary environment, which needs a declaration setup has proved.
  if (!depth && index > 0 && !sourceTip && unproven !== undefined) {
    return unproven;
  }
  if (
    depth || active.length + retainedExecutions >= policy.concurrency - reserved
  ) {
    const holders = active.map((entry) => displayBranch(entry.source.branch));
    return {
      kind: "capacity-unavailable",
      transient: false,
      capacity: {
        setting: depth ? "completion.lookahead" : "completion.concurrency",
        limit: depth ? policy.lookahead : policy.concurrency,
        occupied: active.length + retainedExecutions,
        reserved,
        blockers: active.flatMap((entry) =>
          entry.candidate_id === null ? [] : [entry.candidate_id]
        ),
        wake_condition: depth
          ? "The selected effort moves inside speculative lookahead after a predecessor lands or is withdrawn."
          : "An active queue reservation and any associated execution return release a slot.",
      },
      reason: depth
        ? "This effort is waiting for its turn: completion.lookahead binds, so efforts ahead of it must land or be withdrawn before it can validate early. Complete the preceding effort, then retry discern done."
        : `Every validation slot is taken${
          holders.length === 0 ? "" : ` (held by ${holders.join(", ")})`
        }${
          reserved > 0
            ? ", with one slot reserved for the next effort to land"
            : ""
        }: completion.concurrency binds. A running validation finishing or returning its slot frees one; then retry discern done.`,
    };
  }
  return undefined;
}

/** The selected ID exists before composition/validation; green admission happens separately. */
export async function claimQueueWork(input: {
  readonly root: string;
  /** Omission permits a fresh lock-held observation only with a checked candidate. */
  readonly expected_stamp?: string;
  readonly effort: string;
  readonly candidate_id: string;
  readonly environment_id: string;
  readonly executor: Executor;
  readonly policy: CompletionPolicy;
  readonly lease_ms: number;
  readonly rerun_of: string | null;
  readonly mode?: "strict" | "report";
  /** An exact source-tip candidate permits ordinary author validation without speculation. */
  readonly candidate?: Candidate;
  /** Present when the environment this candidate would use is not proved for early validation. */
  readonly unproven?: CompletionBlocker;
  readonly clock?: Clock;
  readonly entropy?: SecureEntropy;
  readonly afterReservation?: () => Promise<void>;
}): Promise<QueueWorkClaim | CompletionBlocker | { readonly kind: "replan" }> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const entropy = input.entropy ?? SYSTEM_SECURE_ENTROPY;
  if (!Number.isSafeInteger(input.lease_ms) || input.lease_ms <= 0) {
    throw new TypeError("A work claim requires a finite positive lease.");
  }
  return await withQueueLock(input.root, async () => {
    const compatible = await readCompatibleCompletionRecord(input.root, {
      kind: "queue",
      id: REPOSITORY_QUEUE_ID,
    });
    if (compatible.kind !== "recorded") return compatible;
    if (compatible.record.kind !== "queue") {
      throw new Error("Queue coordinate returned another family.");
    }
    let current = { record: compatible.record, stamp: compatible.stamp };
    if (
      input.expected_stamp === undefined
        ? input.candidate === undefined
        : current.stamp !== input.expected_stamp
    ) return { kind: "replan" };
    const entries = orderedEntries(current.record.data);
    const observation = await observeQueue(input.root, "HEAD", clock);
    const unreadable = completionRecordBlocker(observation);
    if (unreadable !== undefined) return unreadable;
    const proposed = input.candidate;
    const sourceTip = proposed !== undefined &&
      proposed.head === proposed.source.head &&
      proposed.expected_predecessor.head === current.record.data.trunk &&
      entries.some((entry) =>
        entry.source.effort_id === input.effort &&
        sameSource(entry.source, proposed.source)
      );
    if (proposed !== undefined) {
      const selected = entries.find((entry) =>
        entry.source.effort_id === input.effort
      );
      const candidates = new Map(
        observedRecords(observation).filter((r) => r.kind === "candidate").map((
          r,
        ) => [r.id, r.data]),
      );
      const predecessor = expectedPredecessor(
        current.record.data,
        input.effort,
        candidates,
      );
      if (
        selected === undefined ||
        !sameSource(selected.source, proposed.source) ||
        (!sourceTip &&
          ("kind" in predecessor ||
            predecessor.head !== proposed.expected_predecessor.head))
      ) return { kind: "replan" };
    }
    const blocked = workCapacity(
      entries,
      input.effort,
      input.policy,
      sourceTip,
      retainedExecutionCount(entries, observation),
      input.unproven,
    );
    if (blocked?.kind === "capacity-unavailable") {
      return queueCapacityBlocker(blocked, entries, observation);
    }
    if (blocked !== undefined) return blocked;
    const entry = entries.find((item) =>
      item.source.effort_id === input.effort
    );
    if (entry === undefined) return { kind: "replan" };
    if (entry.state === "failed" && input.rerun_of === null) {
      return {
        kind: "validation-failed",
        evidence_ids: [],
        reason:
          "The selected candidate has a failed validation attempt. Resolve its failure, then use discern done --rerun for a deliberate retry.",
      };
    }
    if (input.rerun_of !== null) {
      const previous = await readCompletionRecord(input.root, {
        kind: "attempt",
        id: input.rerun_of,
      });
      if (
        previous.kind !== "recorded" || previous.record.kind !== "attempt" ||
        finishedValidationAttempts([previous.record]).length !== 1
      ) return { kind: "replan" };
    }
    const identity = await reserveQueueAttempt(
      input.root,
      input,
      input.executor,
      input.rerun_of,
      clock,
      entropy,
    );
    current = await requireQueue(input.root);
    const now = clock.wallNow();
    const attempt: CompletionAttempt = {
      identity,
      environment_id: input.environment_id,
      subjects: [],
      mode: input.mode ?? "strict",
      purpose: "completion",
      state: {
        kind: "claimed",
        claim: {
          token: entropy.uuid(),
          executor: input.executor,
          acquired_at: now,
          expires_at: now + input.lease_ms,
        },
      },
    };
    const selected = await replaceQueue(input.root, current, {
      ...current.record.data,
      entries: current.record.data.entries.map((item) =>
        item.source.effort_id === input.effort
          ? {
            ...item,
            candidate_id: input.candidate_id,
            state: "active",
            invalidation: null,
          }
          : item
      ),
    }, clock);
    if (selected.kind !== "written") return { kind: "replan" };
    await input.afterReservation?.();
    const written = await writeCompletionRecord(
      input.root,
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
        `Work claim publication ${written.kind}; reconcile the reserved candidate before retrying.`,
      );
    }
    if (attempt.state.kind !== "claimed") {
      throw new Error("Work claim was not established.");
    }
    return {
      effort: input.effort,
      attempt,
      fence: { attempt_id: identity.id, token: attempt.state.claim.token },
    };
  });
}

/** Recheck the candidate pointer and source independently of unrelated queue revisions. */
export async function checkQueueClaim(
  root: string,
  claim: QueueWorkClaim,
  candidate: Candidate,
  clock: Clock = SYSTEM_CLOCK,
): Promise<boolean> {
  const current = await requireQueue(root);
  const entry = current.record.data.entries.find((item) =>
    item.source.effort_id === claim.effort
  );
  const reading = await readCompletionRecord(root, {
    kind: "attempt",
    id: claim.fence.attempt_id,
  });
  return entry !== undefined && entry.state === "active" &&
    entry.invalidation === null &&
    entry.candidate_id === claim.attempt.identity.candidate_id &&
    sameSource(entry.source, candidate.source) &&
    reading.kind === "recorded" && reading.record.kind === "attempt" &&
    reading.record.data.state.kind === "claimed" &&
    reading.record.data.state.claim.token === claim.fence.token &&
    reading.record.data.state.claim.expires_at > clock.wallNow();
}

/** Write through the original fence; expiry and takeover never receive replacement authority. */
async function writeQueueClaimSettlement(
  root: string,
  claim: QueueWorkClaim,
  outcome: "passed" | "failed" | "cancelled",
  clock: Clock,
): Promise<CompletionWriteOutcome> {
  const current = await readCompletionRecord(root, {
    kind: "attempt",
    id: claim.fence.attempt_id,
  });
  if (current.kind !== "recorded" || current.record.kind !== "attempt") {
    throw new Error("Queue claim is unavailable.");
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
    claim.fence,
    clock,
  );
}

/** Queue claims own no checkout effects; their terminal record does not imply environment return. */
export async function settleQueueClaim(
  root: string,
  claim: QueueWorkClaim,
  outcome: "passed" | "failed" | "cancelled",
  clock: Clock = SYSTEM_CLOCK,
): Promise<void> {
  const written = await writeQueueClaimSettlement(root, claim, outcome, clock);
  if (written.kind !== "written") {
    throw new Error(
      `Queue claim settlement ${written.kind}; preserve the attempt for recovery.`,
    );
  }
}

/** Cancellation leaves an expired or superseded claim intact and preserves the caller's original refusal. */
export async function cancelQueueClaim(
  root: string,
  claim: QueueWorkClaim,
  clock: Clock = SYSTEM_CLOCK,
): Promise<boolean> {
  const written = await writeQueueClaimSettlement(
    root,
    claim,
    "cancelled",
    clock,
  );
  if (written.kind === "claim-lost") return false;
  if (written.kind !== "written") {
    throw new Error(
      `Queue claim cancellation ${written.kind}; preserve the attempt for recovery.`,
    );
  }
  return true;
}

/** Return capacity after an unavailable environment or incomplete demand, with no checkout effects. */
export async function releaseQueueClaim(
  root: string,
  claim: QueueWorkClaim,
  candidate: Candidate,
  clock: Clock = SYSTEM_CLOCK,
): Promise<boolean> {
  return await withQueueLock(root, async () => {
    if (!await checkQueueClaim(root, claim, candidate, clock)) return false;
    await settleQueueClaim(root, claim, "cancelled", clock);
    const queue = await requireQueue(root);
    const written = await replaceQueue(root, queue, {
      ...queue.record.data,
      entries: queue.record.data.entries.map((entry) =>
        entry.source.effort_id !== claim.effort ? entry : {
          ...entry,
          state: entry.authority_id === null ? "provisional" : "eligible",
        }
      ),
    }, clock);
    return written.kind === "written";
  });
}

/** Assembly follows producer settlement with its own newer live publication attempt. */
export async function claimQueueAssembly(
  root: string,
  claim: QueueWorkClaim,
  candidate: Candidate,
  leaseMs: number,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<QueueWorkClaim> {
  return await withQueueLock(root, async () => {
    if (!await checkQueueClaim(root, claim, candidate, clock)) {
      throw new Error("Assembly cannot inherit a superseded queue claim.");
    }
    const identity = await reserveQueueAttempt(
      root,
      { candidate_id: claim.attempt.identity.candidate_id },
      claim.attempt.identity.executor,
      null,
      clock,
      entropy,
    );
    const now = clock.wallNow();
    const token = entropy.uuid();
    const attempt: CompletionAttempt = {
      ...claim.attempt,
      identity,
      state: {
        kind: "claimed",
        claim: {
          token,
          executor: identity.executor,
          acquired_at: now,
          expires_at: now + leaseMs,
        },
      },
    };
    await settleQueueClaim(root, claim, "passed", clock);
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
        `Assembly claim ${written.kind}; reconcile the reserved candidate.`,
      );
    }
    return {
      effort: claim.effort,
      attempt,
      fence: { attempt_id: identity.id, token },
    };
  });
}

/** Reserve one short publication actor without turning a green entry into validation work. */
export async function claimLandingAttempt(input: {
  readonly root: string;
  readonly candidate_id: string;
  readonly executor: Executor;
  readonly lease_ms: number;
  readonly clock?: Clock;
  readonly entropy?: SecureEntropy;
}): Promise<QueueWorkClaim | CompletionBlocker> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const entropy = input.entropy ?? SYSTEM_SECURE_ENTROPY;
  if (!Number.isSafeInteger(input.lease_ms) || input.lease_ms <= 0) {
    throw new Error("Landing needs a bounded publication lease.");
  }
  return await withQueueLock(input.root, async () => {
    const queue = await requireQueue(input.root);
    const entry = queue.record.data.entries.find((item) =>
      item.candidate_id === input.candidate_id
    );
    if (
      entry === undefined || entry.state === "landed" ||
      entry.state === "withdrawn"
    ) return { kind: "missing-evidence", requirements: [] };
    if (entry.authority_id === null) {
      return { kind: "missing-authority", sources: [entry.source] };
    }
    const records = observedRecords(
      await observeQueue(input.root, "HEAD", clock),
    );
    const active = records.find((record) =>
      record.kind === "attempt" &&
      record.data.identity.candidate_id === input.candidate_id &&
      record.data.state.kind === "claimed" &&
      record.data.state.claim.expires_at > clock.wallNow()
    );
    if (active?.kind === "attempt" && active.data.state.kind === "claimed") {
      return {
        kind: "waiting-for-operation",
        attempt_id: active.id,
        expires_at: active.data.state.claim.expires_at,
      };
    }
    const proof = records.find((record) =>
      record.kind === "proof" &&
      record.data.candidate_id === input.candidate_id &&
      record.data.mode === "strict"
    );
    const owner = proof?.kind === "proof"
      ? records.find((record) =>
        record.kind === "attempt" && record.id === proof.data.attempt_id
      )
      : undefined;
    if (owner?.kind !== "attempt" || owner.data.state.kind !== "finished") {
      return { kind: "missing-evidence", requirements: [] };
    }
    const identity = await reserveQueueAttempt(
      input.root,
      input,
      input.executor,
      null,
      clock,
      entropy,
    );
    const token = entropy.uuid();
    const now = clock.wallNow();
    const attempt: CompletionAttempt = {
      identity,
      environment_id: owner.data.environment_id,
      subjects: [],
      purpose: "completion",
      mode: "strict",
      state: {
        kind: "claimed",
        claim: {
          token,
          executor: identity.executor,
          acquired_at: now,
          expires_at: now + input.lease_ms,
        },
      },
    };
    const written = await writeCompletionRecord(
      input.root,
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
        `Landing actor publication ${written.kind}; observe the queue again.`,
      );
    }
    return {
      attempt,
      fence: { attempt_id: identity.id, token },
      effort: entry.source.effort_id,
    };
  });
}

/** Unexpired reservations can change; these recorded claims are not liveness observations. */
export function queueCapacityBlocker(
  blocked: Extract<CompletionBlocker, { kind: "capacity-unavailable" }>,
  entries: ReturnType<typeof orderedEntries>,
  observation: CompletionObservation,
): CompletionBlocker {
  const records = observedRecords(observation);
  const owners: string[] = [];
  for (const record of records) {
    if (record.kind !== "environment") continue;
    const state = record.data.state;
    if (state.kind === "recovery") {
      return {
        kind: "recovery-incomplete",
        record_id: record.id,
        recovery: state.recovery,
      };
    }
    if (state.kind !== "executing") continue;
    if (state.claim.expires_at <= observation.observed_at) {
      return {
        kind: "environment-unavailable",
        reason:
          `Environment ${record.id} has an expired execution and still occupies capacity. Run ${
            executionRecoveryCommand(record.id)
          } from its owning worktree before retrying.`,
      };
    }
    owners.push(state.attempt_id);
  }
  for (const entry of entries.filter((entry) => entry.state === "active")) {
    const actor = records.find((record) =>
      record.kind === "attempt" &&
      record.data.identity.candidate_id === entry.candidate_id &&
      record.data.state.kind === "claimed" &&
      record.data.state.claim.expires_at > observation.observed_at
    );
    if (actor === undefined) {
      return {
        kind: "environment-unavailable",
        reason:
          `Queue reservation for ${entry.source.effort_id} has no unexpired recorded claim. Reconcile its recorded attempt and execution through discern done --recover <environment-id> before retrying.`,
      };
    }
    owners.push(actor.id);
  }
  // A producer finishing cannot move a lookahead position; that requires landing.
  const transient = blocked.capacity.setting === "completion.concurrency" &&
    owners.length > 0 &&
    blocked.capacity.limit > blocked.capacity.reserved;
  return {
    ...blocked,
    transient,
    capacity: { ...blocked.capacity, blockers: [...new Set(owners)] },
  };
}
