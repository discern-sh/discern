---
title: Interrupted landing recovery
description: How discern completes or rolls back an interrupted acceptance without replaying authority or overwriting changed checkout data.
order: 130
aliases:
  - acceptance recovery
  - interrupted acceptance
  - partial acceptance
---

# Recover an interrupted landing

Read the recorded outcome before retrying. Acceptance separates the ref transition, Proof-note recording, main-checkout convergence, and worktree cleanup. A later failure cannot make a completed transition disappear.

## What the transaction records

Before claiming effort authority or changing the trunk ref, acceptance writes one worktree-scoped journal under the worktree's Git administration: the target commit, the expected trunk, the consent source, any variances and standard approvals, and — as optional version-1 fields — the exact submission id it consumes, the complete Proof pointer for the target, and the integration worktree it owns when the landing composed a moved trunk. It then advances the trunk from the expected commit to the target in one Git ref transaction with the marker ref. An integration landing's copy also has its own record in common Git administration, written as cleanup intent before any setup effect ([`integration_record.ts`](../../../src/engine/worktree/integration_record.ts)). The operation lock serializes the apply path from recovery through cleanup; a concurrent apply refuses immediately ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)).

## How a retry completes or rolls it back

A retry reads the journal and the current trunk before the usual dirty-checkout gates. When the trunk names the landed target, the transition is complete: recovery finishes the remaining steps and never requests fresh consent or lands again. When the trunk still names the expected commit, the attempt rolls back and the result reports what stood in the way. The trunk ref, not checkout convergence, decides whether an effort grant was spent: a failed transition restores the grant; a transition that remains advanced consumes it and the submission.

If the main checkout contains unfamiliar data, recovery preserves it and reports what must be resolved. A valid old or target checkout can converge to the recorded target. Proof-note recording reads the journal's own Proof pointer from common storage — an integrated landing's Proof never lived in the author worktree's gate marker — falling back to the worktree's honored evidence for journals without one. Without either, recovery reports the missing Proof and cannot manufacture a note. Submission consumption is compare-and-clear on the recorded id, so a replacement submission recorded before the retry survives settling the older snapshot. A proven pre-CAS rollback or a durable landing also settles the recorded integration copy — worktree, resources, branch, and record; the ambiguous arms keep it for inspection, and a copy whose owner process died is an interrupted integration `discern worktree prune` reclaims. A live landing's copy is never pruned.

Main-checkout convergence runs after the transition, under checkout exclusion. It materializes local agent artifacts, runs repository ensure commands, and checks smoke and tracked cleanliness. A failed convergence is reported and retried on the same target; it cannot roll the trunk back.

Cleanup runs last, in the landing and in the retry that recovers it. The worktree, its resources, and its branch go when the branch holds nothing beyond the landed submission. A retry records the note, retires the journal, and then applies the same cleanup rule. A branch with later commits stays, with `discern done` then `discern accept` as the route; a removal that cannot complete stays, with `discern worktree prune` as the route. A note or cleanup failure never runs the landing transaction again.

A retry that settles a recorded landing returns a completed landing result with `data.landing.recovery_performed` set. It lands nothing new, so an explicit `--target` does not walk the queue after it. A retry that stops before the landing settles — a preserved checkout, an unconsumed claim, a journal it could not retire — returns `partial_acceptance` and keeps the journal.

## Read the result before acting

`data.landing` records the exact effects: whether recovery ran, whether the trunk landed, and whether the worktree and branch were removed. `data.landings` lists each landing the call attempted, and `data.proof_note.write` reports the status and reason of the note write. `data.queue` lists only submissions that have not landed, so a landed effort leaves it. `data.root` names the surviving main checkout, including when acceptance removed its invoking directory.

Missing judgment, missing authority, missing or stale evidence, a moved trunk, and incomplete recovery require different actions. Follow the named condition; do not replace it with a raw ref update or unverified cleanup.

## Where it lives in code

[`acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts) owns the journal, the compare-and-swap, and recovery. [`accept.ts`](../../../src/engine/worktree/accept.ts) owns the surrounding landing and settles a recovered one; [`accept_cleanup.ts`](../../../src/engine/worktree/accept_cleanup.ts) decides what cleanup removes. [`submission.ts`](../../../src/engine/worktree/submission.ts) owns the submission the transaction consumes. [`engine_accept_authority_test.ts`](../../../tests/engine_accept_authority_test.ts) exercises interruption and retained state.

Branch cleanup distinguishes changed ownership or current use from an unavailable Git operation. A lock or failed deletion retains a recovery result and its exact diagnostic; it does not claim the branch moved. The recorded checkout-removal fact survives, so a retry finishes only the outstanding branch cleanup.
