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

One operating-system lock covers recovery through cleanup. A concurrent `discern accept` refuses immediately without reading an active journal as abandoned state.

Before authority or refs move, a versioned Git-admin journal records the worktree branch, trunk, expected and target commits, receiving checkout, effort-claim participation, and any verified consent. That consent is bound to this exact transition. The trunk update and a per-worktree marker ref then move in one Git transaction; rollback restores the trunk and removes the marker together.

The marker is durable evidence that the transition happened. It keeps one-shot authority spent even if another actor later returns the trunk to its expected commit or its reflog expires. A missing marker shows that discern's transaction did not commit.

## How a retry reconciles it

A retry inspects the journal and current authority without changing the journal, claim, refs, index, or checkout. Recovery requires one of these forms of evidence:

- consent bound to the recorded transition;
- a currently verified standing or effort grant;
- `--confirmed` consent from the current conversation.

A legacy effort journal can prove authority through its matching claim. Legacy conversation and standing-grant journals contain no bound consent, so they remain untouched until current authority exists.

Before the trunk transition, recovery restores a claimed effort grant only when no marker exists, clears the journal, and checks authority again before any fresh landing. Journal-bound consent cannot authorize that fresh transition.

After the transition, recovery consumes the claim and converges the main checkout only when its index and tracked files still match the recorded old or new tree. Changed local data stays untouched, with the journal preserved and an inspection remedy in the result. A reconciled landing stops at `discern worktree prune`; it never crosses the authority boundary again.

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
