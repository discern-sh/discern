/**
 * The **observed-result seam** — a one-slot, process-local mailbox carrying the
 * invocation's final {@link DiscernResult} from wherever it is rendered to the
 * logbook recorder, without threading a parameter through every verb. A
 * separate accumulator carries ids for advisory lines that were delivered
 * outside an envelope; it never invents an envelope to hold them.
 *
 * The CLI has no single point where a verb's envelope surfaces: `emitResult`
 * sees every `--json` run, and the gate entry points hold their result in both
 * output modes — each calls {@link observeResult}. The logbook's per-invocation
 * recorder calls {@link takeObservedResult} exactly once at verb completion to
 * lift per-step timings and diagnostic classes; the take clears the slot, so a
 * result can never leak into a later invocation (the MCP server, one process
 * serving many calls, drains it per call for the same reason).
 *
 * Pure state, no I/O — it lives in `shared/` so `emit.ts` (shared) can feed it
 * without inverting the shared→engine layering.
 */

import { type FiredHint, firedHintsFromTexts } from "./hints.ts";
import type { DiscernResult } from "./result.ts";
import { evaluateResultCompletion } from "./result_completion.ts";

/** The envelope plus its local-only hint identities. */
export interface ObservedResult {
  result: DiscernResult;
  hintIds: string[];
}

let observed: ObservedResult | undefined;

/** Report an invocation's final result envelope (latest call wins). */
export function observeResult(
  result: DiscernResult,
  firedHints?: readonly FiredHint[],
): DiscernResult {
  const completed = evaluateResultCompletion(result);
  // Human-mode entry points keep rendering the object they just observed.
  // Normalize that same object before returning so their verdict cannot lag
  // behind the JSON/MCP completion boundary. Evaluation never upgrades a
  // failed result or removes effect evidence; it only adds typed advisories or
  // downgrades a lying success with its classified failure.
  const mutable = result as DiscernResult & {
    ok: boolean;
    advisories?: DiscernResult["advisories"];
    error?: DiscernResult["error"];
    message?: string;
  };
  mutable.ok = completed.ok;
  if (completed.advisories !== undefined) {
    mutable.advisories = completed.advisories;
  }
  if (completed.error !== undefined) mutable.error = completed.error;
  if (completed.message !== undefined) mutable.message = completed.message;
  const resolvedHints = firedHints ?? firedHintsFromTexts(completed.hints);
  observed = {
    result,
    hintIds: [...new Set(resolvedHints.map((hint) => hint.id))],
  };
  return result;
}

/** Take (and clear) the observed envelope, or undefined when none surfaced. */
export function takeObservedResult(): ObservedResult | undefined {
  const result = observed;
  observed = undefined;
  return result;
}

const supplementalHintIds = new Set<string>();

/**
 * Record hints that were delivered outside a result envelope. This is the
 * narrow exception for a real output channel such as the session-start
 * `ctx.log` line; generating a hint without delivering it does not belong here.
 */
export function observeSupplementalHints(
  firedHints: readonly FiredHint[],
): void {
  for (const hint of firedHints) {
    supplementalHintIds.add(hint.id);
  }
}

/** Take and clear every supplemental delivered-hint id, preserving insertion order. */
export function takeSupplementalHintIds(): string[] {
  const ids = [...supplementalHintIds];
  supplementalHintIds.clear();
  return ids;
}

const shownTipIds = new Set<string>();

/**
 * Record a desk tip's delivery. Tips are envelope-less by design — the desk
 * is the one surface that shows them — so their ids follow the supplemental
 * accumulator pattern above: the CLI interceptor drains this at invocation
 * completion into the verb event's `tip_ids`, and no result envelope is
 * synthesized to carry them. Call it only when the tip was actually rendered.
 */
export function observeShownTip(id: string): void {
  shownTipIds.add(id);
}

/** Take and clear every shown-tip id, preserving insertion order. */
export function takeShownTipIds(): string[] {
  const ids = [...shownTipIds];
  shownTipIds.clear();
  return ids;
}

let observedTarget: string | undefined;

/**
 * Report the invocation's TARGET — the object a verb acted on when it has one
 * (a `help` topic, a `map` page slug). The same one-slot mailbox pattern as the
 * envelope above, for verbs whose target is a positional the generic recording
 * wrapper cannot see. A slug or doc path only, never free text — it lands in
 * the local logbook, whose bar is metadata safe to read aloud.
 */
export function observeVerbTarget(target: string): void {
  observedTarget = target;
}

/** Take (and clear) the observed target, or undefined when none was reported. */
export function takeVerbTarget(): string | undefined {
  const target = observedTarget;
  observedTarget = undefined;
  return target;
}

// ── checkpoint observations ─────────────────────────────────────────────────

/** One checkpoint serving observed during an invocation: the checkpoint id
 * plus the definition hash and subject fingerprint it was served with, when
 * they exist (an advise serving has no open question and so no fingerprints). */
export type CheckpointServingObservation = {
  id: string;
  definition?: string;
  subject?: string;
};

/** One recorded declaration, reduced to observation metadata. The conclusion,
 * fingerprints, whether a relevant revision replaced the subject between the
 * serving and this declaration, and the elapsed time from serving to
 * declaration. The unmet rationale is durable Proof evidence and NEVER
 * appears here — this shape is what the metadata-only logbook records. */
export type CheckpointDeclarationObservation = {
  id: string;
  conclusion: "met" | "unmet";
  /** True when the subject was reopened by a relevant revision in the same
   * invocation that declared — the serving's subject was revised before the
   * conclusion bound to it. */
  revised: boolean;
  definition?: string;
  subject?: string;
  /** Milliseconds from the last serving (open or reopen) to the declaration. */
  elapsed_ms?: number;
};

/** One openQuestion still awaiting a conclusion when its effort ended. */
export type CheckpointAbandonedObservation = {
  id: string;
};

/**
 * Everything the checkpoint machinery observed during one invocation —
 * accumulated here at the moment each fact becomes true (the gate pre-flight,
 * the acceptance transition) and drained by the logbook recorder into the
 * invocation's event. Ids, conclusions, fingerprints, and timing only; the
 * unmet rationale never enters (the metadata-only bar).
 */
export type CheckpointObservations = {
  /** OpenQuestions opened this invocation (the checkpoint fired). */
  fired?: CheckpointServingObservation[];
  /** OpenQuestions reopened this invocation (a relevant change replaced the subject). */
  reopened?: CheckpointServingObservation[];
  /** Declarations newly recorded this invocation. */
  declared?: CheckpointDeclarationObservation[];
  /** Advise-mode servings (no openQuestion exists; the id is the observation). */
  advise?: CheckpointServingObservation[];
  /** Owner-authorized variances a completed landing carried. */
  variances?: CheckpointServingObservation[];
  /** OpenQuestions awaiting a conclusion when the effort ended. */
  abandoned?: CheckpointAbandonedObservation[];
};

let checkpointObservations: CheckpointObservations | undefined;

/** The two lists joined, or the existing one when nothing was added. */
function appended<T>(
  existing: T[] | undefined,
  added: readonly T[] | undefined,
): T[] | undefined {
  if (added === undefined || added.length === 0) {
    return existing;
  }
  return [...(existing ?? []), ...added];
}

/** Append one group of checkpoint observations to the invocation's record. */
export function observeCheckpointActivity(
  partial: CheckpointObservations,
): void {
  const merged: CheckpointObservations = checkpointObservations ?? {};
  const fired = appended(merged.fired, partial.fired);
  if (fired !== undefined) merged.fired = fired;
  const reopened = appended(merged.reopened, partial.reopened);
  if (reopened !== undefined) merged.reopened = reopened;
  const declared = appended(merged.declared, partial.declared);
  if (declared !== undefined) merged.declared = declared;
  // Advice has no subject fingerprint: repeated preflights deliver one id in
  // this invocation's result, even when composition requires re-evaluation.
  const advise = appended(merged.advise, partial.advise);
  if (advise !== undefined) {
    merged.advise = [
      ...new Map(advise.map((entry) => [entry.id, entry])).values(),
    ];
  }
  const variances = appended(merged.variances, partial.variances);
  if (variances !== undefined) merged.variances = variances;
  const abandoned = appended(merged.abandoned, partial.abandoned);
  if (abandoned !== undefined) merged.abandoned = abandoned;
  checkpointObservations = merged;
}

/** Take (and clear) the accumulated checkpoint observations, or undefined
 * when nothing was observed. The recorder drains this exactly once at verb
 * completion (and discards stale state at verb start), so an observation can
 * never leak into a later invocation. */
export function takeCheckpointActivity(): CheckpointObservations | undefined {
  const observations = checkpointObservations;
  checkpointObservations = undefined;
  if (observations === undefined) {
    return undefined;
  }
  return Object.values(observations).some((list) => list.length > 0)
    ? observations
    : undefined;
}
