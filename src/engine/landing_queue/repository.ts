import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** One repository queue at the registered family coordinate; revisions reserve attempt order. */
import type { CompletionRecord } from "../completion/records.ts";
import type { CompletionQueue } from "../completion/outcomes.ts";
import type {
  CompletionObservation,
  EnvironmentPlan,
} from "../completion/protocol.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import type { CompletionWriteOutcome } from "../completion/store.ts";
import {
  type AttemptIdentity,
  type Executor,
  newAttemptIdentity,
} from "../completion/identity.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { runGit } from "../../shared/subprocess.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";

/** Fixed UUID selects the singleton within each repository's existing queue family. */
export const REPOSITORY_QUEUE_ID = "1d9c8f62-8f22-4a25-a307-0f5786378591";
export type QueueRecord = Extract<CompletionRecord, { kind: "queue" }>;
export type RecordedQueue = {
  readonly record: QueueRecord;
  readonly stamp: string;
};

/** Canonicalize before acquiring locks, matching the completion store's nested boundary. */
export async function withQueueLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  return await withCompletionPublication(await Deno.realPath(root), operation);
}

/** Refuse unsupported or missing bytes without creating replacement state. */
export async function requireQueue(root: string): Promise<RecordedQueue> {
  const reading = await readCompletionRecord(root, {
    kind: "queue",
    id: REPOSITORY_QUEUE_ID,
  });
  if (reading.kind !== "recorded" || reading.record.kind !== "queue") {
    throw new Error(
      `Repository queue is ${reading.kind}; preserve its bytes and reconcile before continuing.`,
    );
  }
  return { record: reading.record, stamp: reading.stamp };
}

/** Missing state can be initialized; unsupported or damaged state cannot be replaced. */
export async function initializeQueue(
  root: string,
  trunk: string,
): Promise<CompletionWriteOutcome> {
  return await writeCompletionRecord(root, {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "queue",
    id: REPOSITORY_QUEUE_ID,
    revision: 1,
    data: { trunk, entries: [] },
  }, null);
}

/** Compare the observed stamp and retain the previous queue revision. */
export async function replaceQueue(
  root: string,
  current: RecordedQueue,
  queue: CompletionQueue,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionWriteOutcome> {
  return await writeCompletionRecord(
    root,
    {
      ...current.record,
      revision: current.record.revision + 1,
      data: queue,
    },
    current.stamp,
    undefined,
    clock,
  );
}

/** The validation inventory's checkout HEAD is deliberately replaced with configured trunk. */
export async function observeQueue(
  root: string,
  trunkRef: string,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionObservation> {
  const observation = await observeCompletionRecords(root, clock);
  const trunk = await runGit(
    ["rev-parse", "--verify", `${trunkRef}^{commit}`],
    { cwd: root },
  );
  if (!trunk.success) {
    throw new Error("The configured trunk cannot be observed.");
  }
  return { ...observation, trunk: trunk.stdout.trim() };
}

/** EnvironmentExecutor callback: each successful CAS consumes one never-reused sequence. */
export async function reserveQueueAttempt(
  root: string,
  plan: Pick<EnvironmentPlan, "candidate_id">,
  executor: Executor,
  rerunOf: string | null = null,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<AttemptIdentity> {
  return await withQueueLock(root, async () => {
    const current = await requireQueue(root);
    const outcome = await replaceQueue(
      root,
      current,
      current.record.data,
      clock,
    );
    if (outcome.kind !== "written") {
      throw new Error(
        `Attempt reservation ${outcome.kind}; observe and replan.`,
      );
    }
    return newAttemptIdentity(
      {
        candidate_id: plan.candidate_id,
        executor,
        sequence: current.record.revision + 1,
        rerun_of: rerunOf,
      },
      clock,
      entropy,
    );
  });
}

/** Project validated envelopes while preserving unreadable readings in the original observation. */
export function observedRecords(
  observation: CompletionObservation,
): CompletionRecord[] {
  return observation.records.flatMap(({ reading }) =>
    reading.kind === "recorded" ? [reading.record] : []
  );
}
