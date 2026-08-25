---
title: Operation effects and exclusion
description: How CLI and MCP command paths declare effects, choose a shared-state boundary, and refuse conflicting writers.
order: 90
aliases:
  - operation effects
  - operation locks
  - concurrent discern commands
  - checkout lock
  - common repository lock
---

# Operation effects and exclusion

_A command path declares what it can affect before its command-line interface (CLI) or Model Context Protocol (MCP) body runs._

## The registry classifies commands

[`OPERATION_EFFECTS`](../../../src/shared/operation_effects.ts) is total over the live CLI command tree. Each command path declares one or more effect classes:

| Effect class                       | Meaning                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| observation                        | Reads and reports state without a discern-owned mutation.                                     |
| discern-owned checkout mutation    | Changes files or Git-admin evidence scoped to one checkout.                                   |
| discern-owned common mutation      | Changes common Git state, a trunk ref, the main checkout, or another repository-wide record.  |
| Project-authored command execution | Runs a configured project command whose reachable effects belong to that command.             |
| External setup or resource effects | Runs setup, provider, resource, or lifecycle work that may change state outside the checkout. |

The same entry declares a lock boundary and a preview obligation. Mixed paths carry conditions for the flags or operands that activate their writer form. Dry runs acquire no writer lock. The registry does not treat a project-authored command as side-effect-free.

The preview field records whether a command has no preview obligation, must disclose effects, or requires a plan. Each command's current plan/apply implementation remains the source of its rendered dry-run behavior.

[`tests/operation_effects_test.ts`](../../../tests/operation_effects_test.ts) derives nested and top-level command paths from the live tree. It requires one registry entry for each path, checks MCP parity, and plants a future path to prove enrollment. [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts) enrolls the registry as a canonical set. Logbook routing has a separate recording concern and does not supply effect policy ([ADR 0330](../_adr/0330-every-command-path-declares-its-operation-effects.md)).

## Lock boundaries follow shared state

| Boundary            | Scope                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| None                | Observations, dry runs, and inactive forms of mixed commands remain concurrent.                     |
| Checkout            | Writers in one checkout exclude another discern writer there; separate worktrees remain concurrent. |
| Common repository   | Linked worktrees exclude operations that share refs, the main checkout, or common Git-admin state.  |
| Common and checkout | The operation acquires the common boundary first, then the selected checkout boundary.              |

[`withOperationLock`](../../../src/engine/operation_lock.ts) resolves Git-admin lock paths before acquisition and uses non-blocking operating-system file locks. A standing path becomes inert when its process releases the file lock. A conflict refuses before the command body, names the held boundary, states that the call made no change, and routes the caller to retry after the active operation finishes.

Acceptance uses the combined boundary before it inspects or recovers its transaction. `done`, `prepare`, `refresh`, and other checkout writers hold the checkout boundary while mutable state and evidence must stay coherent. Commands valid before Git exists use a host-temporary boundary keyed by their canonical checkout path ([ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md)).

## Nested commands reuse authenticated leases

Gate, setup, and lifecycle operations can invoke discern children. [`operation_lock_context.ts`](../../../src/shared/operation_lock_context.ts) carries held leases through async context and an internal child environment value. The lock file's random token authenticates that delegation only while another process holds the file's operating-system lock.

A nested operation can reuse a lease its parent holds. It cannot acquire common after checkout, acquire a second checkout, or widen a child from a checkout-only parent. Those refusals preserve the common-before-checkout order and prevent nested deadlock. [`tests/operation_lock_test.ts`](../../../tests/operation_lock_test.ts) exercises the shared acceptance boundary, same-checkout refusal, orphan path, pre-Git boundary, acquisition order, MCP routing, and separate-worktree concurrency.

## Where it lives in code

| Concern                 | Source                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| Effect policy           | [`operation_effects.ts`](../../../src/shared/operation_effects.ts)           |
| Lock acquisition        | [`operation_lock.ts`](../../../src/engine/operation_lock.ts)                 |
| Nested and child leases | [`operation_lock_context.ts`](../../../src/shared/operation_lock_context.ts) |
| Git-admin placement     | [`git_admin_state.ts`](../../../src/shared/git_admin_state.ts)               |
| CLI interception        | [`main.ts`](../../../src/main.ts)                                            |
| MCP interception        | [`server.ts`](../../../src/engine/mcp/server.ts)                             |
