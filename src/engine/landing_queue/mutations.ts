import { emitCompletionEvent } from "../completion/events.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { resolveIdentity } from "../worktree/identity.ts";
/** Owner/source actions change one queue snapshot and fence only affected attempts. */
import type { Executor, SourceRevision } from "../completion/identity.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
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
  requireQueue,
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
  }
  | { readonly kind: "trunk-moved" };

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
    const current = await requireQueue(input.root);
    if (current.stamp !== input.expected_stamp) return { kind: "replan" };
    const observation = await observeQueue(input.root, input.trunk, clock);
    if (
      observation.records.some(({ reading }) =>
        reading.kind !== "recorded" && reading.kind !== "missing"
      )
    ) {
      return {
        kind: "environment-unavailable",
        reason:
          "Unreadable completion state prevents dependency invalidation. Reconcile its record before changing queue order.",
      };
    }
    const records = observedRecords(observation);
    const candidates = new Map(
      records.filter((record) => record.kind === "candidate").map((
        record,
      ) => [record.id, record.data]),
    );
    let queue = current.record.data;
    let invalidation: QueueInvalidation | null = null;
    const change = input.mutation;
    let planned: QueueChange | null = null;
    switch (change.kind) {
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
        planned = approveBatch(queue, change.batch, change.approvals);
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
              record.data.candidate_id === entry.candidate_id &&
              sameSource(record.data.source, entry.source)
            )
            ? { ...entry, state: "landed" }
            : entry
        );
        invalidation = reconcilePredecessors(
          { ...queue, entries },
          candidates,
          observation.trunk,
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
        change.kind === "reprioritize"
          ? "reprioritized"
          : "predecessor-changed",
      );
    }
    if (invalidation !== null) queue = invalidation.queue;
    const affected = new Set(invalidation?.candidate_ids ?? []);
    for (const { reading } of observation.records) {
      if (reading.kind !== "recorded" || reading.record.kind !== "attempt") {
        continue;
      }
      const attempt = reading.record;
      if (
        !affected.has(attempt.data.identity.candidate_id) ||
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
              kind: "recovery",
              recovery: {
                phase: "publish",
                reason:
                  `Candidate invalidated by ${change.kind}; reconcile owned execution before another attempt.`,
                children_quiescent: false,
                drift: {
                  kind: "uncaptured",
                  reason:
                    "The environment executor retains capture and return ownership.",
                },
                retained_paths: [],
                frozen_cleanup: [],
              },
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
