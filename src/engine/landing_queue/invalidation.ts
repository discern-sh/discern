/** Invalidation follows recorded source and candidate edges, never a queue counter. */
import type { Candidate } from "../completion/candidate.ts";
import type {
  CompletionQueue,
  InvalidationReason,
} from "../completion/outcomes.ts";
import type { SourceRevision } from "../completion/identity.ts";
import { expectedPredecessor, sameSource } from "./model.ts";

export interface QueueInvalidation {
  readonly queue: CompletionQueue;
  readonly candidate_ids: readonly string[];
  readonly efforts: readonly string[];
  readonly reason: InvalidationReason;
}

/** Ordering causes can cease while independent source, policy, or evidence failures remain. */
function orderingInvalidation(reason: InvalidationReason | null): boolean {
  return reason === "predecessor-changed" || reason === "reprioritized" ||
    reason === "external-trunk";
}

/** Retain candidate links and failed state as evidence until replacement selection. */
export function invalidateDependents(
  queue: CompletionQueue,
  candidates: ReadonlyMap<string, Candidate>,
  roots: readonly string[],
  reason: InvalidationReason,
): QueueInvalidation {
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    const ids = new Set(
      queue.entries.filter((entry) => affected.has(entry.source.effort_id))
        .flatMap((entry) =>
          entry.candidate_id === null ? [] : [entry.candidate_id]
        ),
    );
    for (const entry of queue.entries) {
      if (entry.state === "landed" || affected.has(entry.source.effort_id)) {
        continue;
      }
      const candidate = entry.candidate_id === null
        ? undefined
        : candidates.get(entry.candidate_id);
      if (
        entry.dependencies.some((id) => affected.has(id)) ||
        (candidate?.expected_predecessor.candidate_id !== null &&
          candidate?.expected_predecessor.candidate_id !== undefined &&
          ids.has(candidate.expected_predecessor.candidate_id))
      ) {
        affected.add(entry.source.effort_id);
        changed = true;
      }
    }
  }
  const entries = queue.entries.map((entry) => {
    if (!affected.has(entry.source.effort_id) || entry.state === "landed") {
      return entry;
    }
    return {
      ...entry,
      invalidation:
        orderingInvalidation(reason) && entry.invalidation !== null &&
          !orderingInvalidation(entry.invalidation)
          ? entry.invalidation
          : reason,
      state: entry.state === "active"
        ? entry.authority_id === null
          ? "provisional" as const
          : "eligible" as const
        : entry.state,
    };
  });
  return {
    queue: { ...queue, entries },
    efforts: [...affected],
    candidate_ids: entries.filter((entry) =>
      affected.has(entry.source.effort_id)
    )
      .flatMap((entry) =>
        entry.candidate_id === null ? [] : [entry.candidate_id]
      ),
    reason,
  };
}

/** Replace source approval only through the source owner's new committed revision. */
export function replaceSource(
  queue: CompletionQueue,
  candidates: ReadonlyMap<string, Candidate>,
  source: SourceRevision,
  dependencies: readonly string[],
): QueueInvalidation {
  const existing = queue.entries.find((entry) =>
    entry.source.effort_id === source.effort_id
  );
  if (existing === undefined || existing.state === "landed") {
    throw new Error("Source replacement requires an existing unlanded effort.");
  }
  if (sameSource(existing.source, source)) {
    throw new Error("Source replacement requires a new committed revision.");
  }
  const invalidated = invalidateDependents(queue, candidates, [
    source.effort_id,
  ], "source-replaced");
  return {
    ...invalidated,
    queue: {
      ...invalidated.queue,
      entries: invalidated.queue.entries.map((entry) =>
        entry.source.effort_id !== source.effort_id ? entry : {
          ...entry,
          source,
          dependencies: [...dependencies],
          authority_id: null,
          revoked_grant: undefined,
          eligible_order: null,
          approval_batch: null,
          state: "provisional",
        }
      ),
    },
  };
}

/** Revocation/withdrawal cannot erase red evidence or consume consent. */
export function removeEligibility(
  queue: CompletionQueue,
  candidates: ReadonlyMap<string, Candidate>,
  effort: string,
  reason: "withdrawn" | "authority-revoked" | "candidate-failed",
  revokedGrant: string | null = null,
): QueueInvalidation {
  const invalidated = invalidateDependents(queue, candidates, [effort], reason);
  return {
    ...invalidated,
    queue: {
      ...invalidated.queue,
      entries: invalidated.queue.entries.map((entry) => {
        if (
          entry.source.effort_id !== effort || entry.state === "landed"
        ) return entry;
        if (reason === "candidate-failed") {
          return {
            ...entry,
            state: "failed",
            eligible_order: null,
            approval_batch: null,
          };
        }
        return {
          ...entry,
          ...(reason === "authority-revoked"
            ? { revoked_grant: revokedGrant }
            : {}),
          authority_id: null,
          eligible_order: null,
          approval_batch: null,
          state: reason === "withdrawn" ? "withdrawn" : "provisional",
        };
      }),
    },
  };
}

/** A known landing preserves a correctly predicted successor; external movement does not. */
export function reconcilePredecessors(
  queue: CompletionQueue,
  candidates: ReadonlyMap<string, Candidate>,
  trunk: string,
  reason: "reprioritized" | "external-trunk" | "predecessor-changed",
): QueueInvalidation {
  const next = { ...queue, trunk };
  next.entries = next.entries.map((entry) => {
    if (
      entry.state === "landed" || entry.state === "withdrawn" ||
      entry.state === "active" || entry.state === "failed" ||
      entry.candidate_id === null || !orderingInvalidation(entry.invalidation)
    ) return entry;
    const candidate = candidates.get(entry.candidate_id);
    if (
      candidate === undefined || !sameSource(entry.source, candidate.source)
    ) return entry;
    const predecessor =
      entry.eligible_order === null && candidate.head === candidate.source.head
        ? { head: trunk, candidate_id: null }
        : expectedPredecessor(next, entry.source.effort_id, candidates);
    return !("kind" in predecessor) &&
        predecessor.head === candidate.expected_predecessor.head
      ? { ...entry, invalidation: null }
      : entry;
  });
  const roots = next.entries.filter((entry) => {
    if (
      entry.state === "landed" || entry.state === "withdrawn" ||
      entry.candidate_id === null
    ) return false;
    const candidate = candidates.get(entry.candidate_id);
    if (
      entry.eligible_order === null &&
      candidate?.head === candidate?.source.head &&
      candidate?.expected_predecessor.head === next.trunk
    ) return false;
    const predecessor = expectedPredecessor(
      next,
      entry.source.effort_id,
      candidates,
    );
    return candidate !== undefined && ("kind" in predecessor ||
      predecessor.head !== candidate.expected_predecessor.head);
  }).map((entry) => entry.source.effort_id);
  return invalidateDependents(next, candidates, roots, reason);
}
