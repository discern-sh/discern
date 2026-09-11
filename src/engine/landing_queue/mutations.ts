import {
  completionRecordBlocker,
  readCompatibleCompletionRecord,
} from "../completion/compatibility.ts";
import { emitCompletionEvent } from "../completion/events.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { resolveIdentity } from "../worktree/identity.ts";
/** Owner/source actions change one queue snapshot and fence only affected attempts. */
import type { Executor, SourceRevision } from "../completion/identity.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { CompletionQueue } from "../completion/outcomes.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { withQueueLock } from "./repository.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import {
  approveBatch,
  type QueueChange,
  reprioritize,
  sameSource,
  selectSource,
} from "./model.ts";
import {
  invalidateDependents,
  type QueueInvalidation,
  reconcilePredecessors,
  removeEligibility,
  replaceSource,
} from "./invalidation.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  REPOSITORY_QUEUE_ID,
} from "./repository.ts";

export type QueueMutation =
  | {
    readonly kind: "select" | "source-replaced";
    readonly source: SourceRevision;
    readonly dependencies: readonly string[];
  }
  | {
    readonly kind: "approve";
    readonly batch: string;
    readonly approvals: ReadonlyMap<string, string>;
  }
  | {
    readonly kind: "reprioritize";
    readonly decision: Parameters<typeof reprioritize>[1];
  }
  | {
    readonly kind:
      | "withdrawn"
      | "authority-revoked"
      | "candidate-failed"
      | "policy-changed"
      | "judgment-changed";
    readonly effort: string;
    readonly grant_id?: string | null;
  }
  | { readonly kind: "hold" | "resume"; readonly effort: string }
  | {
    readonly kind: "integrated";
    readonly id: string;
    readonly effort: string;
  }
  | { readonly kind: "trunk-moved" };

/** An entry authored on the trunk branch itself has nothing to land: the
 * trunk checkout checking itself before admission settled such entries. Every
 * mutation first settles such an entry as a finished cycle instead of leaving
 * it waiting forever to be withdrawn. An entry mid-claim keeps its state, and
 * `except` names the effort a selection is about to handle. */
export function settleTrunkEntries(
  queue: CompletionQueue,
  trunk: string,
  except?: string,
): CompletionQueue {
  const trunkBranch = `refs/heads/${trunk}`;
  return {
    ...queue,
    entries: queue.entries.map((entry) =>
      entry.source.branch === trunkBranch &&
        entry.source.effort_id !== except &&
        entry.state !== "active" && entry.state !== "landed" &&
        entry.state !== "withdrawn"
        ? { ...entry, state: "landed" as const, invalidation: null }
        : entry
    ),
  };
}

/** Plan every queue mutation from the same immutable observation used at publication. */
export function planQueueMutation(
  initial: CompletionQueue,
  records: readonly CompletionRecord[],
  trunk: string,
  mutation: QueueMutation,
): {
  readonly kind: "changed";
  readonly queue: CompletionQueue;
  readonly invalidation: QueueInvalidation | null;
} | CompletionBlocker {
  const candidates = new Map(
    records.filter((record) => record.kind === "candidate").map((
      record,
    ) => [record.id, record.data]),
  );
  let queue = initial;
  let invalidation: QueueInvalidation | null = null;
  const change = mutation;
  let planned: QueueChange | null = null;
  switch (change.kind) {
    case "integrated": {
      const entry = queue.entries.find((entry) =>
        entry.source.effort_id === change.effort
      );
      const integration = records.find((record) =>
        record.kind === "integration" && record.id === change.id
      );
      if (
        entry === undefined || integration?.kind !== "integration" ||
        !sameSource(entry.source, integration.data.source) ||
        entry.candidate_id !== integration.data.candidate_id
      ) {
        return {
          kind: "missing-judgment",
          subjects: ["external-integration-subject"],
        };
      }
      invalidation = reconcilePredecessors(
        {
          ...queue,
          entries: queue.entries.map((entry) =>
            entry.source.effort_id === change.effort
              ? { ...entry, state: "landed" }
              : entry
          ),
        },
        candidates,
        trunk,
        "external-trunk",
      );
      break;
    }
    case "hold":
    case "resume": {
      const entry = queue.entries.find((entry) =>
        entry.source.effort_id === change.effort
      );
      if (
        entry === undefined || entry.state === "landed" ||
        entry.state === "withdrawn"
      ) return { kind: "missing-judgment", subjects: ["queue-control-target"] };
      planned = {
        kind: "changed",
        queue: {
          ...queue,
          entries: queue.entries.map((entry) =>
            entry.source.effort_id !== change.effort
              ? entry
              : { ...entry, held: change.kind === "hold" }
          ),
        },
      };
      break;
    }
    case "select":
      planned = selectSource(queue, change.source, change.dependencies);
      break;
    case "approve": {
      const missing = queue.entries.filter((entry) => {
        const id = change.approvals.get(entry.source.effort_id);
        if (id === undefined) return false;
        const authority = records.find((record) =>
          record.kind === "authority" && record.id === id
        );
        return authority?.kind !== "authority" ||
          authority.data.state.kind !== "granted" ||
          !authority.data.sources.some((source) =>
            sameSource(source, entry.source)
          );
      });
      if (missing.length > 0) {
        return {
          kind: "missing-authority",
          sources: missing.map((entry) => entry.source),
        };
      }
      const ready = new Set(
        queue.entries.filter((entry) => {
          const candidate = entry.candidate_id === null
            ? undefined
            : candidates.get(entry.candidate_id);
          return candidate !== undefined &&
            sameSource(candidate.source, entry.source) &&
            records.some((record) =>
              record.kind === "proof" && record.data.mode === "strict" &&
              record.data.candidate_id === entry.candidate_id &&
              record.data.head === candidate.head &&
              record.data.policy === candidate.policy &&
              record.data.requirement_set === candidate.requirement_set
            );
        }).map((entry) => entry.source.effort_id),
      );
      planned = approveBatch(queue, change.batch, change.approvals, ready);
      break;
    }
    case "reprioritize":
      planned = reprioritize(queue, change.decision);
      break;
    case "source-replaced":
      invalidation = replaceSource(
        queue,
        candidates,
        change.source,
        change.dependencies,
      );
      break;
    case "withdrawn":
    case "authority-revoked":
    case "candidate-failed":
      invalidation = removeEligibility(
        queue,
        candidates,
        change.effort,
        change.kind,
        change.grant_id ?? null,
      );
      break;
    case "policy-changed":
    case "judgment-changed":
      invalidation = invalidateDependents(
        queue,
        candidates,
        [change.effort],
        change.kind,
      );
      break;
    case "trunk-moved": {
      const landed = records.filter((record) =>
        record.kind === "landing" && record.data.outcome.kind === "landed"
      );
      const entries: CompletionQueue["entries"] = queue.entries.map((entry) =>
        landed.some((record) =>
            record.kind === "landing" &&
            (record.data.candidate_id === entry.candidate_id ||
              record.data.claim.kind === "exception") &&
            sameSource(record.data.source, entry.source)
          )
          ? { ...entry, state: "landed" }
          : entry
      );
      invalidation = reconcilePredecessors(
        { ...queue, entries },
        candidates,
        trunk,
        "external-trunk",
      );
      break;
    }
  }
  if (planned !== null) {
    if (planned.kind !== "changed") return planned;
    queue = planned.queue;
    invalidation = reconcilePredecessors(
      queue,
      candidates,
      queue.trunk,
      change.kind === "reprioritize" ? "reprioritized" : "predecessor-changed",
    );
  }
  if (invalidation !== null) queue = invalidation.queue;
  return { kind: "changed", queue, invalidation };
}

/** All effects are record IO. Cancellation retains the environment's required recovery. */
export async function mutateQueue(input: {
  readonly root: string;
  readonly trunk: string;
  readonly expected_stamp: string;
  readonly mutation: QueueMutation;
  readonly clock?: Clock;
  readonly executor?: Executor;
}): Promise<
  | {
    readonly kind: "changed";
    readonly invalidation: QueueInvalidation | null;
  }
  | CompletionBlocker
  | { readonly kind: "replan" }
> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const actor = input.executor ??
    {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort: (await resolveIdentity(input.root, input.root)).id,
      started_at: clock.wallNow(),
    };
  return await withQueueLock(input.root, async () => {
    const compatible = await readCompatibleCompletionRecord(input.root, {
      kind: "queue",
      id: REPOSITORY_QUEUE_ID,
    });
    if (compatible.kind !== "recorded") return compatible;
    if (compatible.record.kind !== "queue") {
      throw new Error("Queue coordinate returned another family.");
    }
    const current = { record: compatible.record, stamp: compatible.stamp };
    if (current.stamp !== input.expected_stamp) return { kind: "replan" };
    const observation = await observeQueue(input.root, input.trunk, clock);
    const unreadable = completionRecordBlocker(observation);
    if (unreadable !== undefined) return unreadable;
    const records = observedRecords(observation);
    const planned = planQueueMutation(
      settleTrunkEntries(
        current.record.data,
        input.trunk,
        input.mutation.kind === "select"
          ? input.mutation.source.effort_id
          : undefined,
      ),
      records,
      observation.trunk,
      input.mutation,
    );
    if (planned.kind !== "changed") return planned;
    if (JSON.stringify(planned.queue) === JSON.stringify(current.record.data)) {
      return { kind: "changed", invalidation: null };
    }
    const { queue, invalidation } = planned;
    const candidates = new Map(
      records.filter((record) => record.kind === "candidate").map((
        record,
      ) => [record.id, record.data]),
    );
    const affected = new Set(invalidation?.candidate_ids ?? []);
    // Environment attempts own producer truth and return effects. Queue movement
    // revokes admission only; it cannot cancel or fail those immutable subjects.
    const executing = new Set(records.flatMap((record) => {
      if (record.kind !== "environment") return [];
      const state = record.data.state;
      return state.kind === "executing" || state.kind === "recovery"
        ? [state.attempt_id]
        : state.kind === "idle" && state.returned_attempt_id !== undefined
        ? [state.returned_attempt_id]
        : [];
    }));
    for (const { reading } of observation.records) {
      if (reading.kind !== "recorded" || reading.record.kind !== "attempt") {
        continue;
      }
      const attempt = reading.record;
      if (
        !affected.has(attempt.data.identity.candidate_id) ||
        executing.has(attempt.id) || attempt.data.subjects.length > 0 ||
        attempt.data.state.kind !== "claimed"
      ) continue;
      const fenced = await writeCompletionRecord(
        input.root,
        {
          ...attempt,
          revision: attempt.revision + 1,
          data: {
            ...attempt.data,
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
      if (fenced.kind !== "written") return { kind: "replan" };
    }
    const written = await replaceQueue(input.root, current, queue, clock);
    if (written.kind !== "written") return { kind: "replan" };
    if (input.mutation.kind === "withdrawn") {
      const effort = input.mutation.effort;
      const entry = current.record.data.entries.find((entry) =>
        entry.source.effort_id === effort
      );
      if (entry !== undefined && entry.state !== "withdrawn") {
        emitCompletionEvent({
          id: `${current.record.id}:${
            current.record.revision + 1
          }:withdrawn:${effort}`,
          at: clock.wallNow(),
          effort_id: effort,
          source_head: entry.source.head,
          candidate_id: entry.candidate_id,
          environment_id: null,
          attempt_id: null,
          executor_operation: actor.operation_id,
          fact: {
            kind: "withdrawn",
            admission: entry.eligible_order !== null
              ? "after-green"
              : records.some((record) =>
                  record.kind === "proof" && record.data.mode === "strict" &&
                  record.data.candidate_id === entry.candidate_id
                )
              ? "after-green"
              : entry.candidate_id === null
              ? "before-green"
              : "unknown",
          },
        });
      }
    }
    for (const id of invalidation?.candidate_ids ?? []) {
      const candidate = candidates.get(id);
      if (candidate === undefined || invalidation === null) continue;
      const entry = current.record.data.entries.find((entry) =>
        entry.candidate_id === id
      );
      emitCompletionEvent({
        id: `${current.record.id}:${
          current.record.revision + 1
        }:invalidated:${id}`,
        effort_id: candidate.source.effort_id,
        source_head: candidate.source.head,
        candidate_id: id,
        environment_id: null,
        attempt_id: null,
        executor_operation: actor.operation_id,
        at: clock.wallNow(),
        fact: {
          kind: "invalidated",
          reason: invalidation.reason,
          affected_candidate_ids: invalidation.candidate_ids,
          eligible_prediction: entry !== undefined &&
            entry.eligible_order !== null &&
            records.some((record) =>
              record.kind === "proof" && record.data.candidate_id === id &&
              record.data.mode === "strict"
            ) &&
            candidate.expected_predecessor.candidate_id !== null,
        },
      });
    }
    return { kind: "changed", invalidation };
  });
}
