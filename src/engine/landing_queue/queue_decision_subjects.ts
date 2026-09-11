/**
 * Queue-decision judgment subjects, defined once: the token a refusal records
 * and the plain sentence every owner-facing surface shows for it. Producers
 * reference the tokens through {@link QUEUE_DECISION_SUBJECT} and the
 * acceptance projection translates through the same table, so a new subject
 * cannot reach a first paragraph as a raw token.
 */

export const QUEUE_DECISION_REASONS = {
  "effort-held":
    "The owner put this effort on hold. Resume it with discern accept resume --target <effort-id>, then retry acceptance.",
  "effort-withdrawn":
    "This effort was withdrawn from the queue. A fresh discern done from its worktree re-enrols it.",
  "effort-not-selected":
    "This effort has no place in the queue yet. Run discern done from its clean committed worktree to enrol it.",
  "approval-batch-members":
    "The approval covers an effort that is not in the queue, or one already landed or withdrawn. Review the batch and approve the current efforts.",
  "source-dependency-cycle":
    "The recorded source dependencies form a cycle; correct the declared dependencies before approval.",
  "source-dependency-order":
    "The requested order puts an effort before one it builds on; keep each recorded source dependency ahead of its dependent.",
  "queue-order-changed":
    "The queue changed since the displayed order; preview the decision again and use its fresh token.",
} as const satisfies Readonly<Record<string, string>>;

export type QueueDecisionSubject = keyof typeof QUEUE_DECISION_REASONS;

/** The tokens by name, so producers cannot drift from the reason table. */
export const QUEUE_DECISION_SUBJECT = Object.fromEntries(
  Object.keys(QUEUE_DECISION_REASONS).map((token) => [token, token]),
) as { readonly [Token in QueueDecisionSubject]: Token };

/** The plain sentence for one recorded subject, when the table knows it. */
export function queueDecisionReason(subject: string): string | undefined {
  return (QUEUE_DECISION_REASONS as Readonly<Record<string, string>>)[subject];
}

const CONFLICT_PREFIX = "conflict:";
const AUTHORED_PREFIX = "authored:";

/** A composition conflict names the file it could not merge. */
export function conflictSubject(file: string): string {
  return `${CONFLICT_PREFIX}${file}`;
}

/** Composition changed an authored file no generator owns. */
export function authoredSubject(file: string): string {
  return `${AUTHORED_PREFIX}${file}`;
}

/** The one sentence for judgment subjects composition recorded: the files
 * that conflicted with work already on the trunk, or the authored files it
 * changed. Undefined when no subject is one of those. */
export function compositionJudgmentReason(
  subjects: readonly string[],
): string | undefined {
  const conflicts = subjects.filter((subject) =>
    subject.startsWith(CONFLICT_PREFIX)
  ).map((subject) => subject.slice(CONFLICT_PREFIX.length));
  const authored = subjects.filter((subject) =>
    subject.startsWith(AUTHORED_PREFIX)
  ).map((subject) => subject.slice(AUTHORED_PREFIX.length));
  if (conflicts.length === 0 && authored.length === 0) return undefined;
  const parts = [
    ...(conflicts.length === 0 ? [] : [
      `Its changes conflict with work already on the trunk in ${
        conflicts.join(", ")
      }`,
    ]),
    ...(authored.length === 0 ? [] : [
      `composing it changed authored files no generator owns (${
        authored.join(", ")
      })`,
    ]),
  ];
  return `${
    parts.join("; ")
  }. Run discern update in its worktree, resolve what it reports, then discern done.`;
}
