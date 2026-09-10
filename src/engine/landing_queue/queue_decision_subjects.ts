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
