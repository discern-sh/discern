# ADR 0378: Landing completion survives checkout retirement

**Status**: accepted on 2026-09-05; implemented by the complete completion and coordinated acceptance boundaries. Amends [ADR 0366](0366-landing-is-one-exact-repository-transaction.md), [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md), and [ADR 0215](0215-landing-receipts-travel-as-git-notes.md).

## Context

Acceptance currently holds its transaction through resource destruction, checkout removal, and branch deletion. Its journal lives with the worktree. Cooperative prefix advancement lets an executor land another effort's candidate, so landing cannot imply that the author's checkout is unused or that its local evidence may disappear.

## Decision

Landing and retirement have independently resumable outcomes. The landing transition retains exact candidate, Proof, authority, expected trunk, and actor evidence outside disposable checkout state. Authority settlement and recovery remain tied to the recorded ref transition.

Each predecessor has its own inspectable plan and authority check. Source authorship, authority, and executor identity are separate facts. An executor identity records the operation and originating effort; it implies no authenticated human identity beyond available evidence.

The landing boundary protects the ref transition and shared-checkout consistency. Long resource teardown does not hold that boundary. Git registration and branch cleanup retain the brief coordination and current-evidence checks their own effects require.

Automatic foreign retirement requires a recorded release, current ownership, applicable cleanliness, and exclusion of active use. Resource retirement honors its recorded ownership and frozen cleanup contract. A branch that moved or a checkout with uncertain state remains available for later owner-actor cleanup or confirmed prune.

A cleanup failure never makes a landed effort pending for another acceptance. Recovery cannot replay consumed consent. If A lands and B stops, the result identifies A as landed and explains B's pending state. Publication failures for a Proof note retain recoverable evidence without inventing a second landing.

## Consequences

- Source workspaces can remain after their approved candidates land.
- Retirement has observable pending and recovery states.
- Removing a checkout cannot erase the evidence needed to finish or explain the operation.
- Cooperative execution does not grant another agent permission to edit the source checkout.

## Alternatives considered

- Keeping acceptance open until teardown completes couples an already completed ref transition to slow or failed cleanup. Separate outcomes release the landing boundary and preserve an explicit retirement obligation.
- Removing another effort's checkout as soon as its candidate lands assumes that landing approval releases the workspace. Requiring recorded release and current ownership protects source work that may still be active.
