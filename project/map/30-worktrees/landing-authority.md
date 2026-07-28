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

Landing authority is the owner's permission for one worktree. A green [receipt](../00-orientation/glossary.md#receipt) proves only the gate. Without authority, the agent stops; an exact-tree grant permits landing without another conversation ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

## The three sources

| Source         | Evidence                                                                                                         | Lifetime                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Conversation   | `discern accept --confirmed` attests to the owner's acceptance in the current conversation.                      | One acceptance call.             |
| Standing grant | The trunk's committed `[acceptance].pre_authorized` lists granted [scopes](../00-orientation/glossary.md#scope). | Every fully covered landing.     |
| Effort grant   | **Pre-authorize landing once green** at [the desk](the-desk.md) records authority for one worktree.              | Until that effort lands or ends. |

`--confirmed` means conversation consent only. Standing authority comes from the trunk's committed `[acceptance]`, never the worktree branch.

## How discern resolves coverage

At `start`, discern reports standing scopes prospectively; final paths decide coverage.

At `status` and green `done`, every path must match a known granted scope. Unmatched paths and unknown grants stay uncovered. Effort grants bind to their branch.

When a grant exists, `data.landing_authority` carries the result:

| Field             | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `kind`            | `authorized` or `conversation-required`.                              |
| `source`          | `standing-grant` or `effort-grant` for an authorized tree.            |
| `scopes`          | Standing scopes that cover the exact tree.                            |
| `standing_scopes` | Known standing grants, including a prospective or partial match.      |
| `uncovered`       | Changed paths that keep the landing on the conversation-review route. |
| `warnings`        | Evidence discern cannot trust, such as an invalid recorded grant.     |

Without a grant or warning, the field is absent and [handoff](hand-work-back.md) remains ordinary. `accept`'s `data.consent` and receipt name the source; `scopes` carries standing coverage ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

## Where it lives in code

| Concern                          | Source                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Shared resolution and projection | [`landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)               |
| Consent-source vocabulary        | [`consent.ts`](../../../src/shared/consent.ts)                                            |
| Standing-grant configuration     | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                |
| Per-effort grant reader          | [`effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts)                         |
| Grant creation and cleanup       | [`effort_grant_writer.ts`](../../../src/engine/worktree/effort_grant_writer.ts), [`effort_grant_cleanup.ts`](../../../src/engine/worktree/effort_grant_cleanup.ts) |
| Exact trunk transition           | [`git.ts`](../../../src/engine/worktree/git.ts)                                           |
| Lifecycle result schema          | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                              |
| Cross-surface guard              | [`engine_lifecycle_authority_test.ts`](../../../tests/engine_lifecycle_authority_test.ts) |

## Current state & gotchas

- Standing authority is pinned to its trunk commit; the compare-and-swap refuses concurrent advances.
- Acceptance atomically claims effort authority. Revocation and acceptance have one winner; a failed transition restores it unless a newer grant exists.
- Landing consumes the claim; drop, prune, and orphan cleanup remove abandoned state.
- Any uncertainty returns to conversation review; it never widens authority.
