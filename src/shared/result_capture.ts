/**
 * The **observed-result seam** — a one-slot, process-local mailbox carrying the
 * invocation's final {@link DiscernResult} from wherever it is rendered to the
 * logbook recorder, without threading a parameter through every verb.
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

import type { DiscernResult } from "./result.ts";

let observed: DiscernResult | undefined;

/** Report an invocation's final result envelope (latest call wins). */
export function observeResult(result: DiscernResult): void {
  observed = result;
}

/** Take (and clear) the observed envelope, or undefined when none surfaced. */
export function takeObservedResult(): DiscernResult | undefined {
  const result = observed;
  observed = undefined;
  return result;
}
