# ADR 0116: Receipts vouch only for the pinned tree, and accept lands the validated sha

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` → `accept`, the gate-pass artifact → the receipt; the decision and reasoning are unchanged.

**Status**: accepted; hardens [ADR 0067](0067-accept-validates-the-landed-tree.md) and [ADR 0112](0112-standard-measurement-receipt.md)

## Context

The gate receipt (ADR 0067) is the vouch `accept` honors instead of re-running the gate, and the measurement receipt (ADR 0112) is its standard sibling. Both were stamped by reading HEAD and cleanliness **after** the validated work finished — for a real suite, minutes after the jobs started reading the tree. Nothing captured the tree identity before the run, so a commit made while the gate ran (by the agent itself, or its user in another terminal) produced a receipt naming a commit whose tree the gate never read: the vouch mechanism could certify untested code, and the fast path in `accept` would then land it without any gate run at all.

The slow path in `accept` had the same window one level up: it validated the tree at gate time but fast-forwarded the trunk to the **branch name**, which git resolves at merge time — landing any commit added during the (minutes-long) re-run. The adjacent races were already guarded (the trunk-moved fast-forward refusal, the off-trunk re-check of the main checkout); this axis was not.

## Decision

**A vouch may only name a tree identity pinned before the validated work began and re-verified at stamp time.**

- `pinValidatedTree` captures (HEAD, clean) as a `ValidatedTreePin` — a branded type only the receipt module can mint, so a caller cannot hand-roll a pin from a sha it happens to hold. Both stamp writers (`recordGateOutcome`, `recordStandardMeasurements`) **require** one: enrolling in the invariant is a compile-time obligation, not a convention.
- At stamp time the writer re-reads the tree. HEAD moved since the pin → no stamp (`skipped_head_moved` in `data.gate_receipt`, with a hint to re-run `done` on the final commit); dirty at pin time or now → no stamp (`skipped_dirty`, as before). A refused stamp leaves any prior vouch untouched — it is still truthful at its own sha — and the sha written is the **pinned** one, never a re-read.
- A head-moved refusal also suppresses the rendered review receipt: its git facts were gathered after the move, so its markdown would describe a tree the gate never read.
- `accept` carries the **validated sha** — the honored receipt's recorded sha, or the HEAD pinned around its own gate re-run (refusing if it moved or the tree went dirty) — and fast-forwards the trunk to **that sha**, never the branch name. Immediately before the merge it re-checks the branch tip still names the validated sha, so the branch deletion that follows only ever deletes a fully-merged branch.

The explicit no: this is pin-and-verify, not isolation. A tree dirtied and restored mid-run without moving HEAD (an edit made and reverted while jobs read files) is undetectable without snapshotting the tree, which no local git workflow does. The pin closes every commit-shaped race; it does not promise a filesystem transaction.

## Consequences

- A commit made during `done`, during a standards check, or during validation inside `accept` validation can no longer earn a vouch or reach the trunk untested — the failure mode becomes a refusal with a one-step recovery (re-run on the final commit) instead of a silent landing.
- The wire vocabulary grows one `gate_receipt` status (`skipped_head_moved`); result schemas and types regenerate from the one Zod source.
- Both stamp writers take a required pin, so any future vouch writer is forced through the same discipline by the type system.
