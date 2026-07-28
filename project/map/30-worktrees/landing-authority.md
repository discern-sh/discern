---
title: Landing authority
description: How conversation consent and recorded grants decide whether a finished worktree returns for review or lands directly.
order: 90
aliases:
  - landing authority
  - standing grant
  - effort grant
  - pre-authorized landing
---

# Landing authority

_discern verifies landing authority before it moves the trunk._

A green [receipt](../00-orientation/glossary.md#receipt) proves the gate. Landing permission comes from conversation consent or a recorded grant for the worktree ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

## The three sources

| Source         | Evidence                                                                                               | Lifetime               |
| -------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Conversation   | `discern accept --confirmed` attests to acceptance in this conversation.                               | One call.              |
| Standing grant | The trunk's `[acceptance].pre_authorized` lists granted [scopes](../00-orientation/glossary.md#scope). | Every covered landing. |
| Effort grant   | **Pre-authorize landing once green** at [the desk](the-desk.md).                                       | That worktree.         |

`--confirmed` means conversation consent only. Standing authority comes from the trunk's committed `[acceptance]`. The worktree branch cannot supply it.

## How discern resolves coverage

`start` reports possible standing scopes. `status` and green `done` classify the final paths: every path must match a known granted scope. Unknown grants and unmatched paths stay uncovered. Effort grants bind to their branch.

When a grant exists, `data.landing_authority` carries the result:

| Field             | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| `kind`            | `authorized` or `conversation-required`.                |
| `source`          | `standing-grant` or `effort-grant`.                     |
| `scopes`          | Standing scopes covering the tree.                      |
| `standing_scopes` | Known grants, including prospective or partial matches. |
| `uncovered`       | Paths that still need conversation review.              |
| `warnings`        | Untrusted evidence, such as an invalid recorded grant.  |

Without grant evidence, [handoff](hand-work-back.md) remains ordinary. `accept` records the source and any scopes in its result and receipt ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

## Where it lives in code

| Concern                   | Source                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resolution and vocabulary | [`landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts), [`consent.ts`](../../../src/shared/consent.ts)                                              |
| Standing grants           | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                                                               |
| Effort grants             | [`effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts), [`effort_grant_writer.ts`](../../../src/engine/worktree/effort_grant_writer.ts)                       |
| Transaction and cleanup   | [`acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts), [`effort_grant_cleanup.ts`](../../../src/engine/worktree/effort_grant_cleanup.ts) |
| Trunk transition          | [`git.ts`](../../../src/engine/worktree/git.ts)                                                                                                                          |
| Results and surface guard | [`result_schemas.ts`](../../../src/shared/result_schemas.ts), [`engine_lifecycle_authority_test.ts`](../../../tests/engine_lifecycle_authority_test.ts)                  |

## Current state & gotchas

- Standing authority is pinned to its trunk commit; concurrent advances refuse.
- Acceptance journals an effort claim before moving refs. The trunk and marker move together; rollback reverses both.
- A retained marker keeps authority spent after a trunk reset or reflog expiry. Recovery never replays it.
- Landing consumes the claim. Drop, prune, and orphan cleanup reap abandoned state.
- Uncertainty returns to conversation review; it never widens authority.
