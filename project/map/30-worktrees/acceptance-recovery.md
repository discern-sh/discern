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

Main-checkout convergence runs after the exact transition and authority settlement, under checkout exclusion and outside the common publication lock. It materializes local agent artifacts, runs repository ensure commands, and checks smoke and tracked cleanliness. A retained successful convergence result is reused; a failed or cancelled one is retried on the same target before another effort lands. Cancellation stops project children and preserves the landed result.

Retirement runs separately after landing. It requires the recorded source release, positive ownership, current cleanliness, a matching resource inventory, and child quiescence under exclusion. Changed resources, branches, or files remain available for inspection. Native Git index cache refreshes alone do not change the released subject; the exact index remains in recovery snapshots. Ignored-file changes after release still prevent retirement. The optional comparison against setup is an advisory and does not decide retirement. [ADR 0382](../_adr/0382-release-checkout-semantics-independently-of-recovery-bytes.md) explains these boundaries. A note or retirement failure never runs the landing transaction again. Queue inspection after retirement uses surviving explicit paths, including when acceptance removed its invoking directory.

## Read the result before acting

Each `data.queue` row records its source, candidate, transition, authority settlement, note state, retirement result, and pending conditions. `state: landed` remains true when cleanup is retained or the note needs recovery. Monotonic `retirement_effects` distinguish worktree removal from branch deletion, including a failure between them. The bounded ignored-file comparison survives cleanup in the common capture; disabling that optional comparison suppresses its scan. Earlier landed rows remain visible if a later prefix is blocked. `data.root` names the surviving main checkout.

Missing judgment, missing authority, missing or stale evidence, unavailable environments, failed validation, and incomplete recovery require different actions. Follow the named condition; do not replace it with a raw ref update or unverified cleanup.

## Where it lives in code

[Publication](../../../src/engine/landing_queue/publication.ts) owns exact transition and recovery. [Retirement](../../../src/engine/landing_queue/retirement.ts) owns disposable cleanup. The [active accept actor](../../../src/engine/landing_queue/public_accept.ts) coordinates them. The [result reader](../../../src/engine/landing_queue/public_result.ts) projects each prefix from retained landing, authority, convergence and retirement facts, so a later stop preserves earlier outcomes. [Native publication tests](../../../tests/completion_native_publication_test.ts) and [retirement tests](../../../tests/completion_native_retirement_test.ts) exercise interruption and retained state.

The [legacy transaction reader](../../../src/engine/worktree/acceptance_transaction.ts) remains a recovery boundary for an already-recorded older operation. It is not an alternate path for creating new landing authority.

Branch retirement distinguishes changed ownership or current use from an unavailable Git operation. A lock or failed deletion retains a recovery result and its exact diagnostic; it does not claim the branch moved. The recorded checkout-removal fact survives, so a retry finishes only the outstanding branch cleanup.

## Work integrated outside ordinary acceptance

A retained strict Proof and verified ancestry can establish that an exact effort is already integrated while its historical governed acceptance remains unrecorded. Start `accept --reconcile --target <effort-id> --dry-run` from main. Review the returned candidate, Proof, trunk, and retirement state, then repeat with `--expected <expected_state>`.

This action records the observed integration and reconciles only its matching queue entry. It neither moves Git refs nor consumes approval. Retirement uses the same explicit release and ownership checks as ordinary acceptance. A retained checkout stays available; release it with `done --release-checkout`, then repeat reconciliation from main for eligible cleanup. Existing governed transition records instead continue through ordinary `accept --target <effort-id>` recovery.

A new `await --landed` can recognize the exact proven source already reachable from trunk. It does not write the integration observation or manufacture acceptance history. A fresh fork on trunk lacks a proven change distinct from its recorded predecessor and remains unmet.
