/**
 * The newest durable strict verdict standing over one committed revision.
 *
 * Every strict `done` settles a finished completion attempt in common
 * storage, so the store — not any per-worktree marker — is the one authority
 * for whether a revision's latest strict judgment is green or red. Landing
 * surfaces (the honored-Proof inspection, the landing queue, and an owner's
 * `accept --target`) consult this reader before treating earlier green
 * evidence as current: a revision whose newest strict verdict is red is
 * SUPERSEDED and must not land until a deliberate green rerun re-proves it.
 * A cancelled attempt carries no verdict and a report-mode review is
 * advisory, so neither supersedes nor restores anything.
 */

import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { finishedValidationAttempts } from "../validation/selection.ts";
import type { CompletionRecord } from "./records.ts";

/** How a revision's earlier green evidence stands against the store's newest
 * strict verdict. `unavailable` is fail-closed for every landing caller: an
 * unreadable verdict inventory never re-opens a landing fast path. */
export type StrictVerdictCurrency =
  | { readonly kind: "current" }
  | { readonly kind: "superseded"; readonly attempt_id: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The newest strict completion verdict over `head` among `records` (pure).
 * Candidates name the committed revision they prove, so every strict
 * completion attempt of every candidate at `head` competes; the newest
 * finished attempt that EXECUTED its bound validation demand (it carries
 * subjects — the same line {@link finishedValidationAttempts} draws) and
 * finished with a verdict decides. A refusal served inside the completion
 * session (a rerun guard, a served checkpoint) settles a failed attempt
 * without binding subjects and judges nothing, and a cancelled attempt
 * carries no verdict — neither supersedes nor restores. Superseding
 * deliberately does NOT require an adverse producer receipt: acceptance
 * fails closed on any executed strict run that finished failed — a
 * tree-drift or observation failure included — while the bare-`done`
 * sticky-red veto keeps its narrower judged-producer condition.
 */
export function strictVerdictOver(
  records: readonly CompletionRecord[],
  head: string,
): Extract<StrictVerdictCurrency, { kind: "current" | "superseded" }> {
  const candidates = new Set(
    records.flatMap((record) =>
      record.kind === "candidate" && record.data.head === head
        ? [record.id]
        : []
    ),
  );
  const newest = finishedValidationAttempts(records).find((attempt) =>
    attempt.data.mode === "strict" &&
    candidates.has(attempt.data.identity.candidate_id) &&
    attempt.data.state.kind === "finished" &&
    attempt.data.state.outcome !== "cancelled"
  );
  return newest !== undefined && newest.data.state.kind === "finished" &&
      newest.data.state.outcome === "failed"
    ? { kind: "superseded", attempt_id: newest.id }
    : { kind: "current" };
}

/**
 * Read the store's newest strict verdict over `head` at `root`. Only the
 * candidate and attempt families are observed — the verdict never needs
 * evidence or Proof bodies. Any unreadable, newer, or invalid reading in
 * those families returns `unavailable` with its reason, because a hidden
 * attempt could hide a red verdict; the caller decides the surface-specific
 * fail-closed consequence.
 */
export async function strictVerdictCurrency(
  root: string,
  head: string,
): Promise<StrictVerdictCurrency> {
  let observation: Awaited<ReturnType<typeof observeCompletionRecords>>;
  try {
    observation = await observeCompletionRecords(root, SYSTEM_CLOCK, [
      "candidate",
      "attempt",
    ]);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const records: CompletionRecord[] = [];
  for (const { selector, reading } of observation.records) {
    if (reading.kind === "recorded") {
      records.push(reading.record);
      continue;
    }
    if (reading.kind === "missing") continue;
    const detail = "version" in reading
      ? `${reading.kind} (version ${reading.version})`
      : `${reading.kind} (${reading.reason})`;
    return {
      kind: "unavailable",
      reason: `completion record ${selector.kind}/${selector.id} is ${detail}`,
    };
  }
  return strictVerdictOver(records, head);
}
