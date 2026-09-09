/** Explicit recovery releases queue capacity only after all execution environments returned. */
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { CompletionRecord } from "../completion/records.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import type {
  CompletionAttempt,
  CompletionRecovery,
} from "../completion/environment.ts";
import { REPOSITORY_QUEUE_ID } from "./repository.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";

/** A missing actor is reconciled from retained records; expiry never proves checkout return. */
export async function reconcileQueueWork(input: {
  readonly root: string;
  readonly trunk: string;
  readonly effort: string;
  readonly expected_stamp: string;
  readonly clock?: Clock;
  /** Exact terminal inner attempt returned under native checkout exclusion. */
  readonly returned_attempt?: string;
}): Promise<{ readonly kind: "released" | "replan" } | CompletionBlocker> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  return await withQueueLock(input.root, async () => {
    const queue = await requireQueue(input.root);
    if (queue.stamp !== input.expected_stamp) return { kind: "replan" };
    const entry = queue.record.data.entries.find((entry) =>
      entry.source.effort_id === input.effort
    );
    if (entry?.state !== "active" || entry.candidate_id === null) {
      return { kind: "replan" };
    }
    const observation = await observeQueue(input.root, input.trunk, clock);
    if (
      observation.records.some(({ reading }) =>
        reading.kind !== "recorded" && reading.kind !== "missing"
      )
    ) {
      return {
        kind: "environment-unavailable",
        reason: "Unreadable completion state prevents work recovery.",
      };
    }
    const records = observedRecords(observation);
    const attempts = records.filter((
      record,
    ): record is Extract<CompletionRecord, { kind: "attempt" }> =>
      record.kind === "attempt" &&
      record.data.identity.candidate_id === entry.candidate_id
    );
    const returned = attempts.find((attempt) =>
      attempt.id === input.returned_attempt
    );
    const returnedEnvironment = records.find((record) =>
      record.kind === "environment" &&
      record.id === returned?.data.environment_id
    );
    const recovered = returned?.data.state.kind === "finished" &&
      returnedEnvironment?.kind === "environment" &&
      returnedEnvironment.data.state.kind === "idle" &&
      returnedEnvironment.data.state.returned_attempt_id === returned.id &&
      returnedEnvironment.data.ownership.kind === "borrowed" &&
      returnedEnvironment.data.ownership.source.effort_id === input.effort;
    for (const attempt of attempts) {
      const recoveredOuter = recovered && attempt.data.subjects.length === 0 &&
        attempt.data.environment_id === returned.data.environment_id &&
        attempt.data.identity.executor.operation_id ===
          returned.data.identity.executor.operation_id &&
        attempt.data.identity.sequence < returned.data.identity.sequence;

      if (
        input.returned_attempt !== undefined &&
        attempt.data.state.kind !== "finished" && !recoveredOuter &&
        attempt.id !== returned?.id
      ) {
        return {
          kind: "environment-unavailable",
          reason:
            "An unrelated or newer attempt retains this reservation; recover its exact ownership separately.",
        };
      }
      if (
        !recoveredOuter &&
        (attempt.data.state.kind === "claimed" ||
          attempt.data.state.kind === "composing") &&
        attempt.data.state.claim.expires_at > clock.wallNow()
      ) {
        return {
          kind: "waiting-for-operation",
          attempt_id: attempt.id,
          expires_at: attempt.data.state.claim.expires_at,
        };
      }
      const environment = records.find((record) =>
        record.kind === "environment" &&
        record.id === attempt.data.environment_id
      );
      if (environment?.kind !== "environment") {
        if (attempt.data.subjects.length > 0) {
          return {
            kind: "environment-unavailable",
            reason: "A producing attempt has no readable environment return.",
          };
        }
        continue;
      }
      if (environment.data.state.kind === "recovery") {
        return {
          kind: "recovery-incomplete",
          record_id: environment.id,
          recovery: environment.data.state.recovery,
        };
      }
      if (environment.data.state.kind === "executing") {
        return {
          kind: "environment-unavailable",
          reason:
            "Recover the execution environment before releasing queue capacity.",
        };
      }
    }
    for (const { reading } of observation.records) {
      if (
        reading.kind !== "recorded" || reading.record.kind !== "attempt" ||
        reading.record.data.identity.candidate_id !== entry.candidate_id ||
        reading.record.data.state.kind === "finished"
      ) continue;
      const record = reading.record;
      const written = await writeCompletionRecord(
        input.root,
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
        reading.stamp,
        undefined,
        clock,
      );
      if (written.kind !== "written") return { kind: "replan" };
    }
    const latest = attempts.filter((attempt) =>
      attempt.data.state.kind === "finished"
    )
      .sort((a, b) => b.data.identity.sequence - a.data.identity.sequence)[0];
    const failed = latest?.data.state.kind === "finished" &&
      latest.data.state.outcome === "failed";
    const written = await replaceQueue(input.root, queue, {
      ...queue.record.data,
      entries: queue.record.data.entries.map((item) =>
        item !== entry ? item : {
          ...item,
          state: failed
            ? "failed"
            : item.authority_id === null
            ? "provisional"
            : "eligible",
        }
      ),
    }, clock);
    return { kind: written.kind === "written" ? "released" : "replan" };
  });
}

/** Close matching reservation publishers during takeover, retaining capacity until verified return. */
export async function closeExecutionReservations(
  root: string,
  interrupted: CompletionAttempt,
  recovery: CompletionRecovery,
  clock: Clock,
): Promise<void> {
  await withQueueLock(root, async () => {
    const queue = await readCompletionRecord(root, {
      kind: "queue",
      id: REPOSITORY_QUEUE_ID,
    });
    if (queue.kind === "missing") return;
    if (queue.kind !== "recorded" || queue.record.kind !== "queue") {
      throw new Error(
        "Queue ownership is unreadable; preserve the interrupted execution.",
      );
    }
    const observation = await observeQueue(
      root,
      queue.record.data.trunk,
      clock,
    );
    for (const { reading } of observation.records) {
      if (reading.kind === "missing") continue;
      if (reading.kind !== "recorded") {
        throw new Error(
          "Unreadable completion state prevents publication takeover.",
        );
      }
      const record = reading.record;
      if (
        record.kind !== "attempt" || record.data.state.kind === "finished" ||
        record.data.environment_id !== interrupted.environment_id ||
        record.data.identity.candidate_id !==
          interrupted.identity.candidate_id ||
        JSON.stringify(record.data.identity.executor) !==
          JSON.stringify(interrupted.identity.executor) ||
        record.data.identity.sequence >= interrupted.identity.sequence ||
        record.data.subjects.length !== 0
      ) continue;
      const written = await writeCompletionRecord(
        root,
        {
          ...record,
          revision: record.revision + 1,
          data: { ...record.data, state: { kind: "recovery", recovery } },
        },
        reading.stamp,
        undefined,
        clock,
      );
      if (written.kind !== "written") {
        throw new Error(
          `Reservation publication takeover refused (${written.kind}); preserve the checkout and retry recovery.`,
        );
      }
    }
  });
}
