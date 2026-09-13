---
title: Landing authority
description: How conversation consent and recorded grants decide whether a submitted commit returns for review or lands directly.
order: 120
aliases:
  - landing authority
  - standing grant
  - effort grant
  - pre-authorized landing
---

# Landing authority

_discern verifies landing authority before moving the trunk._

A green [Proof](../20-quality-gate/the-proof.md) records that an exact clean commit passed the declared gate. A submission records that the effort's agent asked to land that commit. Landing permission comes from conversation consent or a recorded grant ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

A Proof that contains a standard limit proposal also needs separate owner approval for each current standard/value/reason tuple. Landing authority does not cover that narrower decision ([ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

## Authority sources

| Source         | Evidence                                                                                               | Lifetime                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Conversation   | `discern accept --confirmed` attests to acceptance in this conversation.                               | The submitted commit.                                                           |
| Standing grant | The trunk's `[acceptance].pre_authorized` lists granted [scopes](../00-orientation/glossary.md#scope). | Every covered landing.                                                          |
| Effort grant   | The desk's `Pre-authorize landing once green` action records permission for the effort's branch.       | Until the landing consumes it, the owner revokes it, or the worktree goes away. |

`--confirmed` attests to the owner's instruction for the selected landing. Standing authority comes from the trunk's committed `[acceptance]`. The worktree branch cannot supply it.

The desk asks `Allow <branch> to land once green without a further conversation?` and stores the grant git-side, outside any branch-writable tree. The grant binds to the effort, so any later green `done` on that branch is covered once its agent submits it; a review fix after the grant needs no second visit to the desk. A green `done` covered by a grant routes the agent straight to `discern_accept`. The grant never covers a checkpoint variance, a standard limit proposal, or an emergency ([ADR 0389](../_adr/0389-the-workspace-contract.md)).

Fresh setup's standing-grant example names `docs`, whose seed contains the map and deferred-work ledger. The separate `instructions` seed contains the project brief, instruction sources, authored skills, and materialized skill directories; it stays outside that example and reaches the owner for review. Upgrade leaves existing named scopes unchanged, so owners of earlier installs split their scope manually to adopt this boundary ([ADR 0209](../_adr/0209-fresh-seed-grants-cover-pure-documentation.md)).

## How discern resolves coverage

`start` reports possible standing scopes. `status` and green `done` classify the final paths: every path must match a known granted scope. Unknown grants and unmatched paths stay uncovered. Exactness comes from the submission, which names one commit; a later commit needs its own submission before any grant applies to it. An integrated landing classifies the exact composed diff — the integration worktree's proven tree against the pinned trunk — and rechecks authority at the transaction boundary, so a grant revoked while the combined check ran refuses before the trunk moves, and regeneration that leaves the granted scopes fails closed to the conversation ([ADR 0391](../_adr/0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md)).

When a grant exists, `data.landing_authority` carries the result:

| Field             | Meaning                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | `authorized` or `conversation-required`.                                                                                                          |
| `source`          | `standing-grant` or `effort-grant`.                                                                                                               |
| `scopes`          | Standing scopes covering the tree.                                                                                                                |
| `standing_scopes` | Known grants, including prospective or partial matches.                                                                                           |
| `uncovered`       | Paths that still need conversation review. `[generated.<name>]`-owned paths carry `generated: true`: counted by authority, collapsed in displays. |
| `warnings`        | Untrusted evidence, such as an invalid recorded grant.                                                                                            |

Without grant evidence, the branch returns for [conversation review](hand-work-back.md). `accept` records the source and any scopes in its result and Proof ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

Each submission needs its own current authority. A caller's `--confirmed` applies only to the selected submission. A green run its agent never submitted is landed by nobody but the owner, explicitly: from its worktree with `--target` and conversational consent, or from the desk.

`accept --target <effort-id>` selects the same effort from its worktree or the main checkout; the main checkout requires a target. Recorded conversation consent survives an interrupted call while its submitted commit remains unchanged.

`accept --dry-run` shows the landing queue, each submission with honored Proof that has not landed with pre-authorized ones first, and the selected effort's recorded authority and pending decisions, without changing anything. Ordinary grants cannot approve a checkpoint variance, a standard proposal, an emergency exception, a push, or a deployment. An interrupted call does not widen any source. [Interrupted landing recovery](acceptance-recovery.md) explains how a journal binds consent to one transition and how a retry completes or rolls it back.

## Approve a Standard limit proposal

`discern accept` checks standard limit proposals before applying landing authority. The live worktree proposal record must equal the proposal set in the honored Proof. A mismatch, stale record, reason change, or revocation refuses without moving the trunk.

The read-only refusal names each standard, old and proposed limits, measurement, delta, reason, responsible paths, and an approval token. The token is a 64-character lowercase hexadecimal digest of the exact standard, value, and reason. It prevents an approval command copied for one tuple from approving a changed tuple; it grants no authority by itself. Relay those facts to the owner. After the owner approves the current tuples in this conversation, run the complete command returned by discern:

```sh
discern accept --confirmed --approve-standard <token>
```

Repeat the flag for every proposal. The token set must equal the current proposal set. `--confirmed` records current conversation consent. Each token identifies the approved standard/value/reason tuple. Standing grants, effort grants, generic conversation consent, checkpoint variances, and earlier tokens do not supply this approval.

If the owner declines, leave acceptance stopped. Restore the trunk limit in the branch, commit the restoration, and run `discern done` under ordinary enforcement. Acceptance never changes the proposed limit after Proof.

## Where it lives in code

| Concern                   | Source                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution and vocabulary | [`landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts), [`consent.ts`](../../../src/shared/consent.ts)                             |
| Standing grants           | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                                              |
| Effort grants             | [`effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts), [`effort_grant_writer.ts`](../../../src/engine/worktree/effort_grant_writer.ts)      |
| Submission record         | [`submission.ts`](../../../src/engine/worktree/submission.ts), [`engine_submission_test.ts`](../../../tests/engine_submission_test.ts)                  |
| Standard limit approval   | [`standard_proposal_state.ts`](../../../src/engine/gate/standard_proposal_state.ts), [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)        |
| Results and surface guard | [`result_schemas.ts`](../../../src/shared/result_schemas.ts), [`engine_lifecycle_authority_test.ts`](../../../tests/engine_lifecycle_authority_test.ts) |

## Current state & gotchas

- Standing authority is pinned to its trunk commit; concurrent advances refuse.
- Landing consumes the grant and the submission. Drop and park remove both with the worktree; prune reaps abandoned state.
- Uncertainty returns to conversation review; it never widens authority.
- Approval of a Standard limit proposal binds one acceptance call to the current proposal set. It is not a standing source of landing authority.

## Emergency authority

[Emergency integration](emergency-integration.md) has its own exact, expiring confirmation exchange. Conversation landing consent and recorded grants cannot authorize it. The resulting exception claim remains separate from ordinary Proof and source authority.
