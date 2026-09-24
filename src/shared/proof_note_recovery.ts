/**
 * The recovery routes for a landing whose Proof note was not recorded. A
 * landing keeps what a retry needs — the effort's checkout and acceptance
 * journal, or the setup branch and its gate Proof — so these sentences name
 * live commands. Step advisories, derived result advisories, and first
 * sentences all serve this one wording.
 */

/**
 * Whether a landing still owes its Proof note, judged from the note write's
 * result (`data.proof_note.write`): the write failed with a complete Proof in
 * hand, so a retry after repairing Git-notes storage can record it. Cleanup
 * keeps the retry's vehicle while this holds. A missing Proof leaves nothing
 * to retry.
 */
export function proofNoteOwed(
  write: { readonly status?: unknown } | undefined,
): boolean {
  return write?.status === "record_failed";
}

/** Advice when the Proof note's fetch transport did not converge. */
export const PROOF_NOTE_FETCH_REPAIR =
  "Repair the reported Git-notes fetch configuration; the landing itself does not need to be repeated.";

/** Advice when no complete Proof remains to record for a landed commit. */
export const PROOF_NOTE_MISSING =
  "No complete Proof remains for the landed commit, so no note can be recorded for it; the landing stands and must not be repeated.";

/** The retry for an ordinary landing's unrecorded note: acceptance again from
 * the checkout the landing kept, whose journal recovery records the note. */
export function acceptProofNoteRetry(worktree: string): string {
  return `Repair the reported Git-notes storage problem, then run \`discern accept\` from ${worktree}; it records the note without repeating the landing.`;
}

/** The close of a landing's first sentence when its note is owed: what stays,
 * and the one retry. */
export function acceptProofNoteOwed(worktree: string): string {
  return `but its Proof note was not recorded, so its checkout, branch, and resources stay until it is. ${
    acceptProofNoteRetry(worktree)
  }`;
}

/** {@link acceptProofNoteRetry} where the result names no checkout path. */
export const ACCEPT_PROOF_NOTE_RETRY = acceptProofNoteRetry(
  "the landed effort's kept worktree",
);

/** The retry for setup acceptance's unrecorded note: setup acceptance again
 * from the kept setup branch, whose retained gate Proof the note records. */
export function setupProofNoteRetry(branch: string, target: string): string {
  return `Repair the reported Git-notes storage problem, then run \`git checkout ${branch}\` and \`discern setup accept\`; it records the note without moving ${target} again.`;
}
