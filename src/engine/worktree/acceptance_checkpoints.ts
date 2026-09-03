/**
 * The acceptance side of the checkpoint contract: verify every required
 * declaration is present and current, then hold any current declared-unmet
 * conclusion behind the owner's **variance** decision.
 *
 * A variance is owner authorization to land ONE current declared-unmet
 * checkpoint without changing it — bound to the exact declaration (checkpoint
 * id, definition hash, subject fingerprint, rationale) and the commit it
 * lands with, never to future efforts. Standing and effort grants never cover
 * one: any unmet conclusion forces current-conversation landing consent, so
 * the owner receives the question, the evidence, the agent's rationale, and
 * one complete decision (`--confirmed` plus one `--variance <id>` per unmet
 * checkpoint) before anything lands.
 *
 * The inspection reads the governing merge-base policy and the open question store
 * only — never re-running triggers or `when` commands. That is sound because
 * acceptance consumes the Proof: an honored gate proof binds to the same
 * declaration evidence (so the store mirrors the validated run), and a stale
 * proof routes through a fresh gate run whose own interlock re-reconciles.
 * The pre-effects decision here is re-verified after gate validation, so a
 * conclusion that changes mid-acceptance can never land under an
 * authorization given for different evidence.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { AuthorizedVarianceData } from "../../shared/result_schemas.ts";
import {
  type CheckpointDrop,
  policyCheckpointDrop,
} from "../../shared/checkpoint_drops.ts";
import {
  declarationIsCurrent,
  type OpenQuestion,
  readOpenQuestions,
} from "../checkpoints/open_questions.ts";
import { loadGoverningPolicy } from "../checkpoints/policy.ts";
import type { RelatedCheckpointPath } from "../checkpoints/types.ts";

/** One standing declared-unmet conclusion, with everything the owner's
 * decision moment must serve. */
export interface StandingUnmetConclusion {
  id: string;
  question: string;
  questionFile?: string;
  teach?: string;
  reference?: string;
  /** The matched paths the openQuestion recorded — the subject's evidence. */
  matched: readonly string[];
  related: readonly RelatedCheckpointPath[];
  /** The agent's rationale — opaque evidence, rendered only through
   * escaping boundaries. */
  why: string;
  declaredAt: string;
  definitionHash: string;
  subject: string;
}

/** The checkpoint state acceptance verifies before any effect. */
export interface AcceptanceCheckpointState {
  /** Governing stop checkpoints whose conclusion is missing or stale —
   * a precondition failure that routes back to `done`. */
  stale: string[];
  /** Current declared-unmet conclusions — each needs an owner variance. */
  unmet: StandingUnmetConclusion[];
  /** Current declared-met conclusions (ids only; nothing to decide). */
  met: string[];
  /** Typed checkpoint drops preserved into acceptance review. */
  drops: CheckpointDrop[];
}

/**
 * Inspect the checkpoint state at `root` for acceptance. Read-only: the
 * governing policy plus the open question store; an unavailable store FAILS OPEN
 * (empty state, one advisory) — acceptance must never wedge on state nobody
 * can read.
 */
export async function inspectAcceptanceCheckpoints(
  root: string,
  config: DiscernConfig,
): Promise<AcceptanceCheckpointState> {
  const state: AcceptanceCheckpointState = {
    stale: [],
    unmet: [],
    met: [],
    drops: [],
  };
  const policy = await loadGoverningPolicy(root, config);
  state.drops.push(...policy.drops);
  const stops = new Map(
    policy.checkpoints.filter((c) => c.mode === "stop").map(
      (c) => [c.id, c] as const,
    ),
  );
  const read = await readOpenQuestions(root);
  if (read.status === "unavailable" || read.status === "newer") {
    state.drops.push(policyCheckpointDrop(
      "open_question_store_unreadable",
      `the checkpoint open-question record could not be read (${read.reason}); earlier active questions are unknown.`,
      policy.policyCommit,
    ));
    return state;
  }
  if (read.status === "invalid") {
    state.drops.push(policyCheckpointDrop(
      "open_question_store_corrupt",
      "the checkpoint open-question record did not parse; earlier active questions are unknown.",
      policy.policyCommit,
    ));
  }
  if (stops.size === 0) {
    return state;
  }
  const openQuestions: Record<string, OpenQuestion> = read.status === "ok"
    ? read.openQuestions
    : {};
  for (const [id, def] of stops) {
    const openQuestion = openQuestions[id];
    if (openQuestion === undefined) {
      continue; // never fired for this effort — nothing to verify
    }
    const declaration = openQuestion.declaration;
    if (declaration === undefined || !declarationIsCurrent(openQuestion)) {
      state.stale.push(id);
      continue;
    }
    if (declaration.conclusion === "met") {
      state.met.push(id);
      continue;
    }
    state.unmet.push({
      id,
      question: def.question,
      ...(def.questionFile === undefined
        ? {}
        : { questionFile: def.questionFile }),
      ...(def.teach === undefined ? {} : { teach: def.teach }),
      ...(def.reference === undefined ? {} : { reference: def.reference }),
      matched: openQuestion.matchedPaths,
      related: openQuestion.relatedPaths,
      why: declaration.why,
      declaredAt: declaration.declaredAt,
      definitionHash: declaration.definitionHash,
      subject: declaration.subject,
    });
  }
  state.stale.sort();
  state.met.sort();
  state.unmet.sort((a, b) => a.id.localeCompare(b.id));
  return state;
}

/** Project a standing conclusion onto its authorized-variance binding. */
export function varianceBinding(
  unmet: StandingUnmetConclusion,
): AuthorizedVarianceData {
  return {
    checkpoint: unmet.id,
    definition_hash: unmet.definitionHash,
    subject: unmet.subject,
    why: unmet.why,
  };
}

/** How the variance interlock resolved for one acceptance invocation. */
export type VarianceInterlockResolution =
  | {
    /** A required declaration is missing or stale: route back to `done`. */
    kind: "declarations-stale";
    ids: string[];
  }
  | {
    /** A named variance id is unknown, declared met, or has nothing to vary —
     * an error, distinct from the awaiting refusal. */
    kind: "invalid-variances";
    message: string;
  }
  | {
    /** Unmet conclusions stand without the complete owner decision. */
    kind: "awaiting";
    unmet: StandingUnmetConclusion[];
    /** The ids still missing from the request (equal to every unmet id when
     * `--confirmed` itself is absent). */
    missing: string[];
    confirmed: boolean;
  }
  | {
    /** Every unmet conclusion is covered (or none stands): the landing may
     * proceed, carrying the exact authorized set (possibly empty). */
    kind: "authorized";
    variances: AuthorizedVarianceData[];
  };

/**
 * Decide the variance interlock (pure). The id set must be EXACT: missing ids
 * refuse with the awaiting contract; extra, unknown, or declared-met ids are
 * errors; `--variance` without `--confirmed` cannot land, and `--confirmed`
 * with unmet conclusions but missing variance ids cannot either.
 */
export function resolveVarianceInterlock(
  state: AcceptanceCheckpointState,
  request: { confirmed: boolean; varianceIds: readonly string[] },
): VarianceInterlockResolution {
  if (state.stale.length > 0) {
    return { kind: "declarations-stale", ids: [...state.stale] };
  }
  const unmetIds = new Set(state.unmet.map((u) => u.id));
  const requested = [...new Set(request.varianceIds)];
  const invalid = requested.filter((id) => !unmetIds.has(id));
  if (invalid.length > 0) {
    const active = [...unmetIds].sort();
    const met = new Set(state.met);
    const detail = invalid.map((id) =>
      met.has(id)
        ? `'${id}' is declared met — a variance covers only a declared-unmet conclusion`
        : `'${id}' names no current declared-unmet checkpoint here`
    ).join("; ");
    return {
      kind: "invalid-variances",
      message: `${detail}. ${
        active.length === 0
          ? "No declared-unmet conclusion stands, so no variance is needed"
          : `The current declared-unmet set is: ${active.join(", ")}`
      }.`,
    };
  }
  if (unmetIds.size === 0) {
    return { kind: "authorized", variances: [] };
  }
  const covered = new Set(requested);
  const missing = [...unmetIds].filter((id) => !covered.has(id)).sort();
  if (!request.confirmed || missing.length > 0) {
    return {
      kind: "awaiting",
      unmet: [...state.unmet],
      missing: request.confirmed ? missing : [...unmetIds].sort(),
      confirmed: request.confirmed,
    };
  }
  return {
    kind: "authorized",
    variances: state.unmet.map(varianceBinding),
  };
}
