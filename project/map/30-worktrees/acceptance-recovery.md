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

Read the recorded outcome before retrying. Acceptance separates the ref transition, authority settlement, Proof-note publication, and checkout retirement. A later failure cannot make a completed transition disappear.

## What the transaction records

The common Git administration holds the exact source, immutable candidate, expected trunk, target, original executor, claim, complete Proof, and owner decisions. These records survive worktree removal. The publication marker and trunk ref move atomically; the receiving checkout is checked against the expected and target trees.

Long validation runs hold their execution environment. The active actor takes short common boundaries to claim and publish, then rechecks authority and the exact plan before applying the transition. A competing or superseded actor receives its current pending condition.

## How a retry reconciles it

A live claim is still owned; another actor waits. An expired or interrupted operation is reconciled from its durable landing record and marker. Recovery does not request fresh consent for a transition already recorded as landed, and cannot restore spent authority while leaving that transition in place.

If the main checkout contains unfamiliar data, recovery preserves it and reports the required reconciliation. A valid old or target checkout can converge to the recorded target. Proof-note publication uses retained evidence; it cannot manufacture a new claim from an incomplete historical marker.

Retirement runs separately after landing. It requires the recorded source release, positive ownership, current cleanliness, a matching resource inventory, and child quiescence under exclusion. Changed resources, branches, or files remain available for inspection. A note or retirement failure never runs the landing transaction again.

## Read the result before acting

Each `data.queue` row records its source, candidate, transition, authority settlement, note state, retirement result, and pending conditions. `state: landed` remains true when cleanup is retained or the note needs recovery. Earlier landed rows remain visible if a later prefix is blocked. `data.root` names the surviving main checkout.

Missing judgment, missing authority, missing or stale evidence, unavailable environments, failed validation, and incomplete recovery require different actions. Follow the named condition; do not replace it with a raw ref update or unverified cleanup.

## Where it lives in code

[Publication](../../../src/engine/landing_queue/publication.ts) owns exact transition and recovery. [Retirement](../../../src/engine/landing_queue/retirement.ts) owns disposable cleanup. The [active accept actor](../../../src/engine/landing_queue/public_accept.ts) coordinates them and preserves prefix outcomes. [Native publication tests](../../../tests/completion_native_publication_test.ts) and [retirement tests](../../../tests/completion_native_retirement_test.ts) exercise interruption and retained state.

The [legacy transaction reader](../../../src/engine/worktree/acceptance_transaction.ts) remains a recovery boundary for an already-recorded older operation. It is not an alternate path for creating new landing authority.
