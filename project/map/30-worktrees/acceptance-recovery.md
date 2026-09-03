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

_A retry reconciles durable evidence before it changes authority, refs, or checkout files._

Acceptance moves the trunk ref and then converges its checkout. A process can end between those boundaries. discern therefore records the transition before either one and treats recovery as part of the original acceptance ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

## What the transaction records

The common-repository lock and this checkout's lock cover applied acceptance from evidence validation through recovery, compare-and-swap, checkout convergence, cleanup, Proof-note handling, and reporting. discern acquires common before checkout. A concurrent common-repository mutation refuses immediately, states that the call made no change, and tells the caller to retry after the active operation finishes. It cannot read an active journal as abandoned state ([ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)).

Before authority or refs move, the complete v1 Git-admin journal records the transition. It includes the worktree branch, once-resolved trunk, expected and target commits, receiving checkout, effort-claim participation, verified consent, authorized variances, and approved Standard limit proposals. Current-conversation consent is represented only by its source; the command's one boolean attestation does not acquire an attester identity or free-form reason. Both decision arrays are present even when empty. The journal binds consent and proposal approval to this transition. The trunk update and a per-worktree marker ref then move in one Git transaction. Rollback restores the trunk and removes the marker together.

The marker is durable evidence that the transition happened. It keeps one-shot authority spent even if another actor later returns the trunk to its expected commit or its reflog expires. A missing marker shows that discern's transaction did not commit.

## How a retry reconciles it

A retry inspects the journal and current authority without changing the journal, claim, refs, index, or checkout. Recovery requires one of these forms of evidence:

- consent bound to the recorded transition;
- a currently verified standing or effort grant;
- `--confirmed` consent from the current conversation.

A journal with Standard limit proposals always requires conversation consent bound to that transaction. A standing or effort grant cannot recover the narrower approval. Recovery validates the recorded proposal set before using it. Malformed, duplicate, or mismatched records leave the journal and refs unchanged.

A malformed or non-canonical journal proves no authority and remains untouched for inspection. Recovery never fills missing consent or decision fields from another source.

Before the trunk transition, recovery restores a claimed effort grant only when no marker exists, clears the journal, and checks authority again before any fresh landing. Journal-bound consent cannot authorize that fresh transition.

After the transition, recovery consumes the claim and converges the main checkout only when its index and tracked files still match the recorded old or new tree. Changed local data stays untouched, with the journal preserved and an inspection remedy in the result. While the worktree still holds its honored Proof, recovery records the same Proof note on the landed commit; unavailable evidence is disclosed rather than invented. A reconciled landing stops at `discern worktree prune`; it never crosses the authority boundary again.

## Read the result before acting

Every applied acceptance result may carry `data.landing`:

| Field                | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `recovery_performed` | This call changed or reconciled an interrupted transaction.    |
| `trunk_landed`       | The trunk reached the accepted commit and was not rolled back. |
| `worktree_removed`   | The linked checkout and its Git registration were removed.     |
| `branch_deleted`     | The merged local branch was deleted.                           |

A later failure after any of those effects returns `error: "partial_acceptance"` and the main-checkout path in `data.root`. Read both fields before choosing a command: the worktree may already be gone. MCP re-aims at the surviving root when cleanup removed its previous working directory.

Checkout-local artifact materialization, repository ensure, smoke, tracked-clean, or branch-deletion failures cannot undo the trunk move. Acceptance reports them, consumes the grant, and continues the remaining cleanup. Tracked refresh work must converge in the branch before landing, so it never runs on this side of the transition.

## Where it lives in code

| Concern                  | Source                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Journal and recovery     | [`acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts)                                                  |
| Ref transition           | [`git.ts`](../../../src/engine/worktree/git.ts)                                                                                        |
| Effort-claim cleanup     | [`effort_grant_cleanup.ts`](../../../src/engine/worktree/effort_grant_cleanup.ts)                                                      |
| Result state             | [`accept_landing_state.ts`](../../../src/shared/accept_landing_state.ts), [`result_schemas.ts`](../../../src/shared/result_schemas.ts) |
| Acceptance orchestration | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                                                                            |
