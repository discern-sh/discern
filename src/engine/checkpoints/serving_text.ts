/** Shared plain-text projection for checkpoint evidence served at judgment boundaries. */

import { RELATED_CHECKPOINT_KIND_LABELS } from "../../shared/checkpoints.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import type { RelatedCheckpointPath } from "./types.ts";

/** Checkpoint fields whose presentation is identical at gate and acceptance. */
export interface CheckpointServingEvidence {
  readonly matched: readonly string[];
  readonly related: readonly RelatedCheckpointPath[];
  readonly questionFile?: string;
  readonly teach?: string;
  readonly reference?: string;
}

/** Reusable fragments whose placement remains owned by the surrounding decision. */
export interface CheckpointServingText {
  readonly matched: string;
  readonly related: readonly string[];
  readonly questionSource?: string;
  readonly notes: readonly string[];
}

/** Escape and bound one checkpoint's shared evidence without choosing its layout. */
export function checkpointServingText(
  evidence: CheckpointServingEvidence,
): CheckpointServingText {
  const shown = evidence.matched.slice(0, 6).map(markdownCodeSpan).join(", ");
  const more = evidence.matched.length > 6
    ? `, +${evidence.matched.length - 6} more`
    : "";
  return {
    matched: `${shown}${more}`,
    related: evidence.related.map((relation) =>
      `  ${RELATED_CHECKPOINT_KIND_LABELS[relation.kind]}: ${
        markdownCodeSpan(relation.path)
      } resembles ${markdownCodeSpan(relation.forPath)}`
    ),
    ...(evidence.questionFile === undefined ? {} : {
      questionSource: `  Question source: ${
        markdownCodeSpan(evidence.questionFile)
      }`,
    }),
    notes: [
      ...(evidence.teach === undefined || evidence.teach.trim() === ""
        ? []
        : [`  Teach: ${evidence.teach.trim()}`]),
      ...(evidence.reference === undefined || evidence.reference.trim() === ""
        ? []
        : [
          `  Reference: ${markdownCodeSpan(evidence.reference.trim())}`,
        ]),
    ],
  };
}
