# ADR 0262: Receipt-eligible runs stop at the pre-group strand checkpoint

> **Amendment ([ADR 0368](0368-local-durable-formats-declare-forward-skew.md)).** The pin carry-forward that the alternatives below cite no longer exists: a pin commit now needs its own `done`. The rejection of carrying Proof across a strand-absorbing commit stands on its own reasoning.

**Status**: accepted; extends [ADR 0047](0047-fix-stage-strand-detection.md) and [ADR 0148](0148-strand-detection-covers-every-gate-stage.md), the remedial complement of [ADR 0261](0261-prepare-runs-the-generated-regenerations.md); reads the tree pin from [ADR 0116](0116-receipts-vouch-only-for-the-pinned-tree.md)

## Context

Strand detection (ADR 0047, widened by ADR 0148) reported at the **end** of an otherwise-green run: the gate paid for standards, check∥test, and scope gates, then failed `tree_drift` over strands the fix or build group had left long before. For one class of run that tail is provably wasted. A `done` that begins on a clean, committed tree is seeking a receipt — the vouch `accept` honors — and a receipt is stamped only over a tree that is still clean at the end (ADR 0067/0116). The moment a pre-group dirties a committed-clean tracked file, the receipt is forfeit and the run's verdict is `tree_drift` no matter what the remaining stages find. Everything after that moment costs wall clock and, under the fleet test-run cap (ADR 0252), a test slot another worktree wanted.

ADR 0261 recorded the field pressure — three delegated streams in one day paying a doubled suite each for build-stage drift — and built the **prevention** half: `prepare` now runs the `[generated]` regenerations, so the finish order `prepare` → commit → `done` cannot drift on fix- or build-stage output. Its alternatives section deferred the **remedial** half, sketched as replaying a tree-drift-failed run's green verdict. The backlog carried that sketch as "verified-tree replay", pending a design discussion. This record is that discussion's outcome.

Dirty-start runs put a boundary on the fix. Agents run `done` on a dirty tree mid-iteration precisely to hear everything the gate has to say; those runs never had a receipt at stake, and cutting them short would trade wanted feedback for an unwanted saving.

## Decision

**A receipt-eligible `done` run checks for tracked strands as soon as every fix/build pre-group has passed, and fails `tree_drift` there instead of running the standards, check∥test, and scope-gate work.** A run that starts dirty keeps the full run and the end-of-run detection, unchanged.

- **Eligibility is the validated tree pin, never the strand snapshot.** The run is receipt-eligible when the pin captured at gate start has a readable HEAD and full cleanliness (`treePin.head !== undefined && treePin.clean`). The pin counts untracked files; the strand machinery tracks only tracked paths — so an untracked-dirty start, whose tracked-dirty snapshot is empty, does not qualify for the checkpoint and keeps its full run.
- **One checkpoint after all pre-groups, never between them.** A later build may consume or restore a fixer's edit, and convergence edits belong in one report. The check is free at that point: it reads the per-group snapshots the gate already took.
- **One strand algorithm.** The checkpoint and the final pass share `strandedByStage` and a single failure routine, so the diagnostic, the `failed_stage: "tree_drift"` label, and the fail-open behavior on an unreadable snapshot are identical at either site, and a run can never be judged twice.
- **Failure precedence is unchanged.** A failed pre-group command, a merge or precondition refusal, and `generated_drift` all keep their earlier verdicts; the checkpoint runs only on an otherwise-green tree.
- **The result stays complete.** Scope classification still runs after the pre-groups (the aborted run's `scopes_changed` is accurate), and every standards, check, test, and scope-gate step that never ran serializes as skipped, as it does for any earlier stage failure.

The explicit noes, each considered for this change and rejected: no content- or tree-keyed replay of green verdicts, no receipt carry-forward across the strand-absorbing commit, no engine identity or binary hashing, no attestation machinery, no `--confirmed`-style toggle or configuration switch, no auto-commit of gate output, and no change to the untracked-output policy or to dirty-start semantics.

## Consequences

- The tree-drift failure ADR 0261 could not prevent (a finish order that skips `prepare`, or a mutating build job outside `[generated]`) now costs the pre-groups plus a diagnostic instead of a full gate. The commit-and-re-run loop the diagnostic prescribes is unchanged; only its first lap got cheap.
- Under the fleet test-run cap, a doomed run no longer queues for — or holds — a test slot.
- Dirty-start runs pay what they always paid and hear everything they always heard. The two-run worst case survives for them by design: full feedback is what running dirty asks for.
- Strands from the check∥test or scope-gate stages still surface only at the end of a full run; those stages run after the checkpoint, so nothing earlier can see them.
- The "verified-tree replay" exploration leaves the backlog. The checkpoint removes the bulk of the waste replay was sketched to refund, with no cached verdict to keep correct.

## Alternatives considered

- **Verified-tree replay** (the deferred sketch in ADR 0261): record the verified tree's hash plus config identity on a tree-drift failure; when the next `done` starts on a clean HEAD whose tree matches, replay the green verdict and stamp the receipt without re-running the suite. Rejected: a gate verdict is not a pure function of the tree bytes — the trunk can move (the never-loosen comparison and merge check read it live), the engine and environment can change between runs, and test flake means "same tree" does not guarantee "same outcome" — so the replayed receipt would vouch for work the jobs never re-earned, and every one of those freshness conditions becomes cache-invalidation surface. The checkpoint deletes most of the same waste (the doomed post-pre-group tail) with nothing to invalidate.
- **Carry the receipt forward across the strand-absorbing commit**, the way `standards --pin` carries it (ADR 0106). Rejected: the pin carry is sound because the pin commit provably changes `[standards]` limits alone, and only to values the held measurements satisfy. A commit that absorbs arbitrary gate output has no such proof — the strands are the diff between the verified tree and the committed one.
- **Check after each pre-group instead of after all of them.** Rejected: a build that consumes or restores a fixer's edit would abort a run whose finished tree is clean (a false positive ADR 0148 already refuses at the final pass), and an agent fixing convergence wants the full pre-group picture in one diagnostic.
- **Apply the early abort to dirty starts too.** Rejected: those runs cannot earn a receipt, so the abort saves nothing the agent asked to keep, and it would repeal the full-feedback contract that makes running `done` dirty useful mid-iteration.
