# ADR 0294: The merge-base governs checkpoint policy

**Status**: accepted; extends the trunk authority the standards limits already hold ([ADR 0133](0133-standards-join-the-gate.md)) to the checkpoint tables of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md)

## Context

A branch edits its own `discern.toml`. If the working tree's `[checkpoints]` tables governed the branch's own gate, deleting or weakening a checkpoint would be a one-line self-exemption — the same hole the standards never-loosen check closes for numeric limits. Unlike a limit, a criterion is prose: no order exists between two versions of judgment text, so no "never loosen" comparison can exist for checkpoints. Reading the live trunk tip instead would make gate outcomes change under an effort's feet whenever the trunk moved.

## Decision

**The policy that governs an effort is the `[checkpoints]` configuration at the effort's merge-base with the trunk — never the branch's own edits, never the live trunk tip.**

- The merge-base commit is the **policy identity**, recorded in the proof separately from declaration subjects. `discern update` advances the merge-base and with it the policy, so policy changes only together with a tree change and outcomes stay reproducible; an unrelated advance moves the identity without staling any declaration.
- Removing, weakening, or adding a checkpoint on a branch has no effect on that branch's own gate; the edit takes effect for other efforts only after it lands. `discern.toml` sits outside every configured scope, so such an edit already requires owner review at acceptance.
- No prose-strength comparison is attempted. Trunk authority makes it unnecessary: the governed definition is whatever the trunk last accepted.
- Governing resolution is deliberately LENIENT where the live loader is strict: the governing copy is history, so an entry that cannot be resolved (missing criterion, unknown scope, both selectors), a config that does not load, or a merge-base that cannot be resolved drops out with an advisory and the effort proceeds — checkpoints fail open, never wedge.
- The definition hash of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md) covers the RESOLVED definition rather than the merge-base commit, so the policy identity and the subjects move independently by construction.

## Consequences

- An agent cannot relax its own checkpoint obligations from inside an effort, and an owner reviewing a landing sees any policy edit in the diff of a file no standing grant covers.
- The governed criterion can lag the trunk tip until the next `update` — accepted: reproducibility of a running effort outranks freshness, and update is cheap and routine.
- The one soft edge is executable: the v1 `when` boundary ([ADR 0296](0296-when-delegates-trigger-conditions-under-a-v1-boundary.md)) lets a branch change files a governed command references. The policy identity proves the command text's source, not a dependency closure; that record keeps the gap explicit instead of implied closed.

## Alternatives considered

- **Govern from the live working tree.** Rejected: self-exemption in one edit, invisible until review.
- **Govern from the live trunk tip.** Rejected: a landing elsewhere would change an unrelated effort's gate mid-flight, breaking reproducibility and the rerun guard's premises.
- **A never-loosen comparison for criteria.** Rejected: prose is not ordered; any mechanical "strength" metric would be a fiction agents could satisfy textually.
