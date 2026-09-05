/** Explicit recovery releases queue capacity only after all execution environments returned. */
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { CompletionRecord } from "../completion/records.ts";
import { writeCompletionRecord } from "../completion/store.ts";
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
    for (const attempt of attempts) {
      if (
        attempt.data.state.kind === "claimed" &&
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
