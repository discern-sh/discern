/** Project settled checkpoint facts onto gate results and Proof without re-evaluating judgment. */

import type {
  GateCheckpointsData,
  ProofCheckpointsData,
  ServedCheckpointData,
} from "../../shared/result_schemas.ts";
import { checkpointDropAccounts } from "../../shared/checkpoint_drops.ts";
import type {
  CheckpointPreflight,
  ServedCheckpoint,
} from "../checkpoints/preflight.ts";
import { relatedCheckpointData } from "../checkpoints/related.ts";

/** Project the one resolved question shape onto public snake-case fields. */
function checkpointQuestionData(
  value: {
    question: string;
    questionFile?: string;
    teach?: string;
    reference?: string;
  },
): Pick<
  ServedCheckpointData,
  "question" | "question_file" | "teach" | "reference"
> {
  return {
    question: value.question,
    ...(value.questionFile === undefined
      ? {}
      : { question_file: value.questionFile }),
    ...(value.teach === undefined ? {} : { teach: value.teach }),
    ...(value.reference === undefined ? {} : { reference: value.reference }),
  };
}

/** Project one served checkpoint onto the wire shape. */
function servedCheckpointData(served: ServedCheckpoint): ServedCheckpointData {
  return {
    id: served.id,
    mode: served.mode,
    ...checkpointQuestionData(served),
    matched: [...served.matched],
    ...(served.related.length === 0
      ? {}
      : { related: relatedCheckpointData(served.related) }),
  };
}

/** Project the pre-flight onto `data.checkpoints`; omit it when no checkpoint governed. */
export function gateCheckpointsData(
  preflight: CheckpointPreflight,
): GateCheckpointsData | undefined {
  const empty = preflight.outstanding.length === 0 &&
    preflight.declaredMet.length === 0 &&
    preflight.declaredUnmet.length === 0 &&
    preflight.advise.length === 0 &&
    preflight.drops.length === 0 &&
    preflight.mode === "strict";
  if (empty) {
    return undefined;
  }
  return {
    ...(preflight.policyCommit === undefined
      ? {}
      : { policy: preflight.policyCommit }),
    ...(preflight.outstanding.length === 0
      ? {}
      : { outstanding: preflight.outstanding.map(servedCheckpointData) }),
    ...(preflight.declaredMet.length === 0 ? {} : {
      declared_met: preflight.declaredMet.map((met) => ({
        id: met.id,
        ...checkpointQuestionData(met),
        declared_at: met.declaredAt,
        matched: [...met.matched],
        ...(met.related.length === 0
          ? {}
          : { related: relatedCheckpointData(met.related) }),
      })),
    }),
    ...(preflight.declaredUnmet.length === 0 ? {} : {
      declared_unmet: preflight.declaredUnmet.map((unmet) => ({
        id: unmet.id,
        ...checkpointQuestionData(unmet),
        why: unmet.why,
        declared_at: unmet.declaredAt,
        matched: [...unmet.matched],
        ...(unmet.related.length === 0
          ? {}
          : { related: relatedCheckpointData(unmet.related) }),
      })),
    }),
    ...(preflight.advise.length === 0
      ? {}
      : { advise: preflight.advise.map(servedCheckpointData) }),
    ...(preflight.mode === "strict" ? {} : {
      review: {
        enforcement: "reported" as const,
        status: preflight.unreviewed.length === 0
          ? "not_needed" as const
          : "unreviewed" as const,
        ...(preflight.unreviewed.length === 0 ? {} : {
          unreviewed: preflight.unreviewed.map(servedCheckpointData),
        }),
      },
    }),
    ...(preflight.drops.length === 0
      ? {}
      : { drops: preflight.drops.map((drop) => ({ ...drop })) }),
    ...(preflight.drops.length === 0
      ? {}
      : { advisories: checkpointDropAccounts(preflight.drops) }),
  };
}

/** The Proof's checkpoint block: the current conclusions plus the policy
 * identity, when checkpoints governed the run. */
export function proofCheckpointsData(
  preflight: CheckpointPreflight,
): ProofCheckpointsData | undefined {
  if (
    preflight.mode === "strict" &&
    preflight.declaredMet.length === 0 &&
    preflight.declaredUnmet.length === 0 &&
    preflight.drops.length === 0
  ) {
    return undefined;
  }
  return {
    ...(preflight.policyCommit === undefined
      ? {}
      : { policy: preflight.policyCommit }),
    declared_met: preflight.declaredMet.map((met) => ({
      id: met.id,
      ...checkpointQuestionData(met),
      declared_at: met.declaredAt,
      matched: [...met.matched],
      ...(met.related.length === 0
        ? {}
        : { related: relatedCheckpointData(met.related) }),
    })),
    declared_unmet: preflight.declaredUnmet.map((unmet) => ({
      id: unmet.id,
      ...checkpointQuestionData(unmet),
      why: unmet.why,
      declared_at: unmet.declaredAt,
      matched: [...unmet.matched],
      ...(unmet.related.length === 0
        ? {}
        : { related: relatedCheckpointData(unmet.related) }),
    })),
    ...(preflight.mode === "strict" ? {} : {
      review: {
        enforcement: "reported" as const,
        status: preflight.unreviewed.length === 0
          ? "not_needed" as const
          : "unreviewed" as const,
        ...(preflight.unreviewed.length === 0
          ? {}
          : { unreviewed: preflight.unreviewed.map(servedCheckpointData) }),
      },
    }),
    ...(preflight.drops.length === 0
      ? {}
      : { drops: preflight.drops.map((drop) => ({ ...drop })) }),
  };
}
