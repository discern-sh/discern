---
title: Interrupted landing recovery
description: How discern reconciles an interrupted acceptance without replaying authority or overwriting changed checkout data.
order: 130
aliases:
  - acceptance recovery
  - interrupted acceptance
  - partial acceptance
---

# Recover an interrupted landing

Read the recorded outcome before retrying. Acceptance separates the ref transition, Proof-note recording, main-checkout convergence, and worktree cleanup. A later failure cannot make a completed transition disappear.

## What the transaction records

Before claiming effort authority or changing the trunk ref, acceptance writes one worktree-scoped journal under the worktree's Git administration: the submitted commit, the expected trunk, the consent source, and any variances and standard approvals. It then advances the trunk from the expected commit to the submitted commit and creates the marker ref in one Git ref transaction. The operation lock serializes the apply path from recovery through cleanup; a concurrent apply refuses immediately ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)).

## How a retry reconciles it

A retry reads the journal and the current trunk before the usual dirty-checkout gates. When the trunk names the landed target, the transition is complete: recovery finishes the remaining steps and never requests fresh consent or lands again. When the trunk still names the expected commit, the attempt rolls back and the result reports what stood in the way. The trunk ref, not checkout convergence, decides whether an effort grant was spent: a failed transition restores the grant; a transition that remains advanced consumes it and the submission.

If the main checkout contains unfamiliar data, recovery preserves it and reports the required reconciliation. A valid old or target checkout can converge to the recorded target. Proof-note recording uses the worktree's honored evidence; after worktree removal, recovery verifies the landed SHA and can remove a still-merged branch from the main checkout, but it cannot manufacture a note from an incomplete marker.

Main-checkout convergence runs after the transition, under checkout exclusion. It materializes local agent artifacts, runs repository ensure commands, and checks smoke and tracked cleanliness. A failed convergence is reported and retried on the same target; it cannot roll the trunk back.

Cleanup runs last. The worktree, its resources, and its branch go when the branch holds nothing beyond the landed submission. A branch with later commits stays, with `discern done` then `discern accept` as the route; a removal that cannot complete stays, with `discern worktree prune` as the route. A note or cleanup failure never runs the landing transaction again.

## Read the result before acting

The selected effort's `data.queue` row records its submission, transition, consent, note state, checkout outcome, and pending conditions. `state: landed` remains true when cleanup is pending or the note needs recovery. `data.root` names the surviving main checkout, including when acceptance removed its invoking directory.

Missing judgment, missing authority, missing or stale evidence, a moved trunk, and incomplete recovery require different actions. Follow the named condition; do not replace it with a raw ref update or unverified cleanup.

## Where it lives in code

[`acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts) owns the journal, the compare-and-swap, and recovery. [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts) owns the surrounding plan: preconditions, convergence, and cleanup. [`submission.ts`](../../../src/engine/worktree/submission.ts) owns the submission the transaction consumes. [`engine_worktree_test.ts`](../../../tests/engine_worktree_test.ts) exercises interruption and retained state.

Branch cleanup distinguishes changed ownership or current use from an unavailable Git operation. A lock or failed deletion retains a recovery result and its exact diagnostic; it does not claim the branch moved. The recorded checkout-removal fact survives, so a retry finishes only the outstanding branch cleanup.
