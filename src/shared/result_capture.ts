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

/** The envelope plus its local-only hint identities. */
export interface ObservedResult {
  result: DiscernResult;
  hintIds: string[];
}

let observed: ObservedResult | undefined;

/** Report an invocation's final result envelope (latest call wins). */
export function observeResult(
  result: DiscernResult,
  firedHints: readonly FiredHint[] = firedHintsFromTexts(result.hints),
): void {
  observed = {
    result,
    hintIds: [...new Set(firedHints.map((hint) => hint.id))],
  };
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
