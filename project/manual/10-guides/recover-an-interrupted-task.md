---
id: guide-recover-an-interrupted-task
title: "Recover an interrupted task"
description: "Resume a partially completed or deliberately dropped task from durable state without widening cleanup."
order: 80
publish: true
kind: guide
aliases:
  - "guide-recover-an-interrupted-task"
  - "Recover an interrupted landing"
  - "acceptance recovery"
  - "interrupted acceptance"
  - "partial acceptance"
  - "Recover a dropped worktree branch"
  - "dropped worktree"
  - "recover dropped branch"
  - "recovery refs"
  - "refs discern recovery"
redirect_from:
  - "/docs/worktrees/acceptance-recovery"
  - "/docs/worktrees/drop-recovery"
---

# Recover an interrupted task

Resume a partially completed or dropped task from durable state without widening cleanup.

## Recover an interrupted landing

_A retry reconciles durable evidence before it changes authority, refs, or checkout files._

Acceptance moves the trunk ref and then converges its checkout. A process can end between those boundaries. discern therefore records the transition before either one and treats recovery as part of the original acceptance ([ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)).

### What the transaction records

The common-repository lock and this checkout's lock cover recovery through cleanup. discern acquires common before checkout. A concurrent `discern accept` refuses immediately, states that the call made no change, and waits for the active operation to finish before retrying. It cannot read an active journal as abandoned state ([ADR 0331](https://discern.sh/docs/decisions/0331-common-repository-locks-precede-checkout-locks)).

Before authority or refs move, a versioned Git-admin journal records the transition. It includes the worktree branch, trunk, expected and target commits, receiving checkout, effort-claim participation, verified consent, and approved Standard limit proposals. The journal binds consent and proposal approval to this transition. The trunk update and a per-worktree marker ref then move in one Git transaction. Rollback restores the trunk and removes the marker together.

The marker is durable evidence that the transition happened. It keeps one-shot authority spent even if another actor later returns the trunk to its expected commit or its reflog expires. A missing marker shows that discern's transaction did not commit.

### How a retry reconciles it

A retry inspects the journal and current authority without changing the journal, claim, refs, index, or checkout. Recovery requires one of these forms of evidence:

- consent bound to the recorded transition;
- a currently verified standing or effort grant;
- `--confirmed` consent from the current conversation.

A journal with Standard limit proposals always requires conversation consent bound to that transaction. A standing or effort grant cannot recover the narrower approval. Recovery validates the recorded proposal set before using it. Malformed, duplicate, or mismatched records leave the journal and refs unchanged.

A legacy effort journal can prove authority through its matching claim. Legacy conversation and standing-grant journals contain no bound consent, so they remain untouched until current authority exists.

Before the trunk transition, recovery restores a claimed effort grant only when no marker exists, clears the journal, and checks authority again before any fresh landing. Journal-bound consent cannot authorize that fresh transition.

After the transition, recovery consumes the claim and converges the main checkout only when its index and tracked files still match the recorded old or new tree. Changed local data stays untouched, with the journal preserved and an inspection remedy in the result. A reconciled landing stops at `discern worktree prune`; it never crosses the authority boundary again.

### Read the result before acting

Every applied acceptance result may carry `data.landing`:

| Field                | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `recovery_performed` | This call changed or reconciled an interrupted transaction.    |
| `trunk_landed`       | The trunk reached the accepted commit and was not rolled back. |
| `worktree_removed`   | The linked checkout and its Git registration were removed.     |
| `branch_deleted`     | The merged local branch was deleted.                           |

A later failure after any of those effects returns `error: "partial_acceptance"` and the main-checkout path in `data.root`. Read both fields before choosing a command: the worktree may already be gone. MCP re-aims at the surviving root when cleanup removed its previous working directory.

Checkout-local artifact materialization, repository ensure, smoke, tracked-clean, or branch-deletion failures cannot undo the trunk move. Acceptance reports them, consumes the grant, and continues the remaining cleanup. Tracked refresh work must converge in the branch before landing, so it never runs on this side of the transition.

### Where it lives in code

| Concern                  | Source                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Journal and recovery     | [`acceptance_transaction.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/acceptance_transaction.ts)                                                                                     |
| Ref transition           | [`git.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/git.ts)                                                                                                                           |
| Effort-claim cleanup     | [`effort_grant_cleanup.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/effort_grant_cleanup.ts)                                                                                         |
| Result state             | [`accept_landing_state.ts`](https://github.com/jackwh/discern/blob/main/src/shared/accept_landing_state.ts), [`result_schemas.ts`](https://github.com/jackwh/discern/blob/main/src/shared/result_schemas.ts) |
| Acceptance orchestration | [`lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)                                                                                                               |

## Recover a dropped worktree branch

_A destructive drop leaves a bounded, local route back to the branch's last committed snapshot._

### What drop retains

Before `discern worktree drop` removes resources, the checkout, or its branch, it stores the branch tip under `refs/discern/recovery/` and prints the exact ref. A failed write stops the drop with the worktree and branch intact. Dry-run creates no ref.

The repository keeps the newest 32 drop refs. They are local to this clone and are not pushed or fetched automatically. A detached worktree has no branch tip to retain. A worktree holding the trunk keeps that branch, while acceptance needs no recovery ref because the accepted commit is reachable from the trunk ([ADR 0271](https://discern.sh/docs/decisions/0271-destructive-drops-retain-bounded-recovery-refs)).

### Restore the committed tip

Use the ref printed by drop. If that output is unavailable, list retained tips newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

Create a normal branch at the selected ref, then inspect it:

```sh
git switch -c recovered-work refs/discern/recovery/20260811T120000000Z-example-1234abcd
git log --stat recovered-work
```

Review the branch before deleting its recovery ref. When the retained history is no longer needed, remove the ref explicitly with `git update-ref -d <ref>`.

### Know the boundary

The ref retains committed objects only. Staged, working-tree, ignored, and untracked bytes are absent from the branch tip, so `--force` can still destroy them permanently.

For lost refs outside discern's drop path, use `git reflog`. `discern doctor` warns when reflog recording is disabled or an explicit expiry falls below discern's recovery floor.
