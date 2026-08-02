/** Human rendering for the run-level time spent waiting for a test-run slot. */

import type { Out } from "../output.ts";
import { elapsedDuration } from "../output.ts";

/** A receipt segment for a positive wait, absent for uncapped or immediate runs. */
export function slotWaitSegment(
  waitedMs: number | undefined,
): string | undefined {
  return waitedMs !== undefined && waitedMs > 0
    ? `waited ${elapsedDuration(waitedMs)} for a test-run slot`
    : undefined;
}

/** A standalone sentence for the same positive wait fact. */
export function slotWaitSentence(
  waitedMs: number | undefined,
): string | undefined {
  const segment = slotWaitSegment(waitedMs);
  return segment === undefined
    ? undefined
    : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}.`;
}

/** Render a positive wait as its own human-summary item. */
export function renderSlotWait(
  out: Out,
  waitedMs: number | undefined,
): void {
  const sentence = slotWaitSentence(waitedMs);
  if (sentence === undefined) {
    return;
  }
  out.group("slot-wait");
  out.info(sentence);
}
