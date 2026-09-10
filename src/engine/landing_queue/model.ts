/** Stable ordering is durable policy; observation never promotes or repairs work. */
import { QUEUE_DECISION_SUBJECT } from "./queue_decision_subjects.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { SourceRevision } from "../completion/identity.ts";
import {
  RecordIdSchema,
  SourceRevisionSchema,
} from "../completion/identity.ts";
import { type CompletionQueue, QueueSchema } from "../completion/outcomes.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";

export type QueueEntry = CompletionQueue["entries"][number];
export type QueueChange =
  | { readonly kind: "changed"; readonly queue: CompletionQueue }
  | CompletionBlocker;

/** Compare every source coordinate after canonical schema normalization. */
export function sameSource(
  left: SourceRevision,
  right: SourceRevision,
): boolean {
  return JSON.stringify(SourceRevisionSchema.parse(left)) ===
    JSON.stringify(SourceRevisionSchema.parse(right));
}

/** Landed/withdrawn entries retain their old rank, so later approvals never reuse it.
 * `includeHeld` lists held efforts in their sorted position for read-only
 * projections; the landing walk never receives them. */
export function orderedEntries(
  queue: CompletionQueue,
  options: { includeHeld?: boolean } = {},
): QueueEntry[] {
  return queue.entries.filter((entry) =>
    entry.state !== "withdrawn" && entry.state !== "landed" &&
    (options.includeHeld === true || !entry.held)
  ).sort((a, b) => {
    if (a.eligible_order !== null && b.eligible_order !== null) {
      return a.eligible_order - b.eligible_order;
    }
    if (a.eligible_order !== null) return -1;
    if (b.eligible_order !== null) return 1;
    return a.provisional_order - b.provisional_order;
  });
}

/** The requested landing includes every earlier chosen entry and no later peer. */
export function landingPrefix(
  queue: CompletionQueue,
  effort: string,
): QueueEntry[] {
  const entries = orderedEntries(queue);
  return entries.slice(
    0,
    entries.findIndex((entry) => entry.source.effort_id === effort) + 1,
  );
}

/** Source dependency cycles and missing members require a corrected source snapshot. */
export function dependencyBlocker(
  queue: CompletionQueue,
): CompletionBlocker | undefined {
  const entries = new Map(
    queue.entries.map((entry) => [entry.source.effort_id, entry]),
  );
  const visited = new Map<string, boolean>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    const known = visited.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return false;
    const entry = entries.get(id);
    visiting.add(id);
    const valid = entry !== undefined && entry.state !== "withdrawn" &&
      (entry.state === "landed" || entry.dependencies.every(visit));
    visiting.delete(id);
    visited.set(id, valid);
    return valid;
  };
  const invalid = queue.entries.filter((entry) =>
    entry.state !== "withdrawn" && entry.state !== "landed" &&
    !visit(entry.source.effort_id)
  );
  return invalid.length === 0 ? undefined : {
    kind: "missing-authority",
    sources: invalid.map((entry) => entry.source),
  };
}

/** Reserve selection before validation. A row without current complete Proof is not admission.
 * A landed entry for the same effort is history: the effort's next cycle
 * replaces it with a fresh provisional entry, and the durable landing record
 * keeps what landed. An unlanded entry with a different source still routes
 * through the explicit source-replacement decision. */
export function selectSource(
  queue: CompletionQueue,
  source: SourceRevision,
  dependencies: readonly string[],
): QueueChange {
  const existing = queue.entries.find((entry) =>
    entry.source.effort_id === source.effort_id
  );
  if (existing !== undefined && existing.state !== "landed") {
    if (
      sameSource(existing.source, source) &&
      JSON.stringify(existing.dependencies) === JSON.stringify(dependencies)
    ) {
      return { kind: "changed", queue };
    }
    return {
      kind: "stale-evidence",
      evidence_ids: [],
      reason: "source-replaced",
    };
  }
  if (
    existing !== undefined && sameSource(existing.source, source)
  ) {
    return { kind: "changed", queue };
  }
  const next = QueueSchema.parse({
    ...queue,
    entries: [...queue.entries.filter((entry) => entry !== existing), {
      source,
      dependencies: [...new Set(dependencies)],
      provisional_order: Math.max(
        -1,
        ...queue.entries.map((entry) => entry.provisional_order),
      ) + 1,
      eligible_order: null,
      approval_batch: null,
      candidate_id: null,
      authority_id: null,
      state: "provisional",
      invalidation: null,
    }],
  });
  return dependencyBlocker(next) ?? { kind: "changed", queue: next };
}

/** One owner batch is one snapshot replacement, ordered by reservation, not message timing. */
export function approveBatch(
  queue: CompletionQueue,
  batch: string,
  approvals: ReadonlyMap<string, string>,
  ready: ReadonlySet<string>,
): QueueChange {
  RecordIdSchema.parse(batch);
  for (const id of approvals.values()) RecordIdSchema.parse(id);
  const members = queue.entries.filter((entry) =>
    approvals.has(entry.source.effort_id)
  );
  if (
    members.length !== approvals.size ||
    members.some((entry) =>
      entry.state === "withdrawn" || entry.state === "landed"
    )
  ) {
    return {
      kind: "missing-judgment",
      subjects: [QUEUE_DECISION_SUBJECT["approval-batch-members"]],
    };
  }
  const covered = new Set(
    queue.entries.filter((entry) =>
      entry.authority_id !== null && entry.state !== "withdrawn"
    ).map((entry) => entry.source.effort_id),
  );
  approvals.forEach((_value, id) => covered.add(id));
  const missing = members.flatMap((entry) =>
    entry.dependencies.filter((id) => !covered.has(id))
  );
  if (missing.length > 0) {
    return {
      kind: "missing-authority",
      sources: queue.entries.filter((entry) =>
        missing.includes(entry.source.effort_id)
      ).map((entry) => entry.source),
    };
  }
  const ranks = new Map<string, number>();
  let rank = Math.max(
    -1,
    ...queue.entries.map((entry) => entry.eligible_order ?? -1),
  );
  const pending = members.filter((entry) =>
    entry.eligible_order === null &&
    !entry.held && entry.state !== "failed" && ready.has(entry.source.effort_id)
  )
    .sort((a, b) => a.provisional_order - b.provisional_order);
  while (pending.length > 0) {
    const index = pending.findIndex((entry) =>
      entry.dependencies.every((dep) =>
        !pending.some((other) => other.source.effort_id === dep)
      )
    );
    if (index < 0) {
      return {
        kind: "missing-judgment",
        subjects: [QUEUE_DECISION_SUBJECT["source-dependency-cycle"]],
      };
    }
    const [entry] = pending.splice(index, 1);
    if (entry !== undefined) ranks.set(entry.source.effort_id, ++rank);
  }
  return {
    kind: "changed",
    queue: QueueSchema.parse({
      ...queue,
      entries: queue.entries.map((entry) => {
        const authority = approvals.get(entry.source.effort_id);
        if (authority === undefined) return entry;
        return {
          ...entry,
          authority_id: authority,
          revoked_grant: undefined,
          invalidation: entry.invalidation === "authority-revoked"
            ? null
            : entry.invalidation,
          eligible_order: entry.eligible_order ??
            ranks.get(entry.source.effort_id) ?? null,
          approval_batch: entry.approval_batch ?? batch,
          state: entry.state === "failed" || entry.state === "active"
            ? entry.state
            : entry.eligible_order !== null || ranks.has(entry.source.effort_id)
            ? "eligible"
            : "provisional",
        };
      }),
    }),
  };
}

/** Explicit owner ordering binds both the displayed old order and the requested replacement. */
export function reprioritize(
  queue: CompletionQueue,
  decision: {
    readonly id: string;
    readonly expected: readonly string[];
    readonly order: readonly string[];
  },
): QueueChange {
  RecordIdSchema.parse(decision.id);
  const eligible = orderedEntries(queue).filter((entry) =>
    entry.eligible_order !== null
  );
  const current = eligible.map((entry) => entry.source.effort_id);
  const wanted = [...decision.order];
  if (
    JSON.stringify(current) !== JSON.stringify(decision.expected) ||
    new Set(wanted).size !== current.length ||
    wanted.some((id) => !current.includes(id))
  ) {
    return {
      kind: "missing-judgment",
      subjects: [QUEUE_DECISION_SUBJECT["queue-order-changed"]],
    };
  }
  if (
    eligible.some((entry) =>
      entry.dependencies.some((dep) =>
        wanted.includes(dep) &&
        wanted.indexOf(dep) > wanted.indexOf(entry.source.effort_id)
      )
    )
  ) {
    return {
      kind: "missing-judgment",
      subjects: [QUEUE_DECISION_SUBJECT["source-dependency-order"]],
    };
  }
  const first = Math.min(...eligible.map((entry) => entry.eligible_order ?? 0));
  return {
    kind: "changed",
    queue: QueueSchema.parse({
      ...queue,
      entries: queue.entries.map((entry) => {
        const index = wanted.indexOf(entry.source.effort_id);
        if (index < 0) return entry;
        return {
          ...entry,
          eligible_order: first + index,
          approval_batch: decision.id,
        };
      }),
    }),
  };
}

/** A prefix is concrete only after its predecessor has an immutable candidate. */
export function expectedPredecessor(
  queue: CompletionQueue,
  effort: string,
  candidates: ReadonlyMap<string, Candidate>,
): Candidate["expected_predecessor"] | CompletionBlocker {
  const ordered = orderedEntries(queue);
  const index = ordered.findIndex((entry) => entry.source.effort_id === effort);
  if (index < 0) {
    return {
      kind: "missing-judgment",
      subjects: [QUEUE_DECISION_SUBJECT["effort-not-selected"]],
    };
  }
  if (index === 0) return { head: queue.trunk, candidate_id: null };
  const previous = ordered[index - 1];
  const candidate =
    previous?.candidate_id === null || previous?.candidate_id === undefined
      ? undefined
      : candidates.get(previous.candidate_id);
  if (candidate === undefined || previous === undefined) {
    return { kind: "missing-evidence", requirements: [] };
  }
  return { head: candidate.head, candidate_id: previous.candidate_id };
}
