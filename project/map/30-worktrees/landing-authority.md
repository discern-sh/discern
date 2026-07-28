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

_discern verifies who authorized a landing before it moves the trunk._

Landing authority records the owner's permission for one worktree. A green [receipt](../00-orientation/glossary.md#receipt) proves only the gate. Landing still needs authority. Without it, the agent reports and stops. A recorded grant covering the exact tree lets landing continue without another conversation ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

One resolver serves `start`, `status`, green `done`, and `accept`. The first three only expose its answer. Acceptance rechecks at the fast-forward boundary, so branch or [trunk](../00-orientation/glossary.md#trunk) movement invalidates stale authority.

## The three sources

| Source         | Evidence                                                                                                         | Lifetime                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Conversation   | `discern accept --confirmed` attests that the owner accepted this landing in the current conversation.           | One acceptance call.             |
| Standing grant | The trunk's committed `[acceptance].pre_authorized` lists granted [scopes](../00-orientation/glossary.md#scope). | Every fully covered landing.     |
| Effort grant   | **Pre-authorize landing once green** at [the desk](the-desk.md) records authority for one worktree.              | Until that effort lands or ends. |

`--confirmed` means conversation consent only. It never substitutes for a recorded grant. The resolver reads `[acceptance]` from the trunk's committed config. Changes on the worktree branch never enter that authority decision.

## How discern resolves coverage

At `start`, no final change exists. The result can name standing scopes prospectively, and discern checks the final paths later.

For `status` and a receipt-bearing `done`, discern classifies every changed path with the configured scopes. A standing grant authorizes the tree only when every path matches at least one known granted scope. A path outside every scope stays uncovered. An unknown scope name covers nothing. An effort grant applies to its recorded branch without path classification.

When a grant exists, `data.landing_authority` carries the result:

| Field             | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `kind`            | `authorized` or `conversation-required`.                              |
| `source`          | `standing-grant` or `effort-grant` for an authorized tree.            |
| `scopes`          | Standing scopes that cover the exact tree.                            |
| `standing_scopes` | Known standing grants, including a prospective or partial match.      |
| `uncovered`       | Changed paths that keep the landing on the conversation-review route. |
| `warnings`        | Evidence discern cannot trust, such as an invalid recorded grant.     |

No grant and no authority warning leave the field absent. That default preserves the ordinary [hand-work-back](hand-work-back.md) route.

`accept` returns verified `data.consent`: `source` identifies conversation, standing, or effort authority, while `scopes` carries standing-grant coverage. It appends the same evidence to the derived receipt line ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

## Where it lives in code

| Concern                          | Source                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Shared resolution and projection | [`landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)               |
| Consent-source vocabulary        | [`consent.ts`](../../../src/shared/consent.ts)                                            |
| Standing-grant configuration     | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                |
| Per-effort grant reader          | [`effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts)                         |
| Lifecycle result schema          | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                              |
| Cross-surface guard              | [`engine_lifecycle_authority_test.ts`](../../../tests/engine_lifecycle_authority_test.ts) |

## Current state & gotchas

- An authorized `done` or `status` result changes no state. Only `accept` moves the trunk.
- Acceptance rechecks standing and effort grants immediately before the fast-forward.
- A successful effort-granted landing consumes that grant. Drop, prune, and orphan cleanup remove abandoned grant state.
- Any uncertainty returns to conversation review; it never widens authority.
