---
title: Identity and environment
description: How every checkout gets stable names, a deterministic port and test seed, inherited env values, and discoverable resource handles.
order: 40
aliases:
  - worktree identity
  - discern identity
  - worktree port
  - inherit env
---

# Checkout identity and environment

_Checkout state supplies stable local coordinates and repeatable test order._

Moving a checkout preserves its identity ([ADR 0025](../_adr/0025-worktree-resources.md), [ADR 0350](../_adr/0350-checkout-identity-supplies-test-order-seeds.md)).

## Read the derived identity

Run `discern identity` in the main checkout or a linked worktree and select the value you need:

| Selector            | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--id`              | Stable checkout id.                                                                   |
| `--branch`          | Full branch name: `<branch_prefix><id>` for a worktree, the configured trunk on main. |
| `--port`            | `17290 + cksum(id) % 2000`.                                                           |
| `--seed`            | POSIX `cksum` of the full branch name, without a trailing newline.                    |
| `--site`            | Domain Name System (DNS)-safe `<project-slug>-<id>`, fitted to 63 characters.         |
| `--db`              | Database-safe `<project_slug>_<id>`.                                                  |
| `--worktree`        | Generic `<project-slug>-<id>` handle.                                                 |
| `--resource <name>` | `<project-slug>-<id>-<name>` for one declared resource.                               |
| `--resources`       | Every declared resource as `name=handle`.                                             |

A linked worktree resolves its id from `DISCERN_WORKTREE_ID`, configured environment files, then Git metadata. Overrides accept letters, numbers, dots, dashes, and underscores. This read-only precedence never grants destructive ownership: cleanup uses the exact Git worktree entry plus discern's ready marker.

Main identity uses the configured trunk and preserves it in `--branch`. Its seed changes only with that setting. Worktree seeds stay stable by branch; branches rotate order. Neither uses the clock nor secure entropy.

`discern start` avoids trunk and live-sibling port collisions when possible. A crowded band or racing starts may collide; change `DISCERN_WORKTREE_ID` then.

## Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first listed file.

Each entry may use any portable project-relative filename. It does not need an `.env` basename. discern removes leading `./` prefixes and refuses entries that name the same case-insensitive path.

Reads may follow a symbolic link when its target stays inside the project. A missing or stale checkout, an unreadable file, or a link that leaves the project behaves as an absent env file. Before writing, discern refuses every symbolic-link component instead of modifying its target; configure the target path directly or replace the link with a regular file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. Inheritance creates the first env file when it is missing, so every declared value arrives. It copies only the named keys. The rest of the main checkout's local env stays there.

The configured env files can carry the values listed in the [environment-variable reference](../70-reference/environment-variables.md#worktree-environment). `[worktree].port` defaults to `false`; set it to `true` when project tooling reads the development-port value. The lifecycle records that value only when the setting is on and an env file exists. `discern identity --port` and the `@port@` setup token remain available either way. Resource handles are recorded when an env file exists. The id remains an optional override supplied by the project or user.

Identity commands work without an env file. Status, its Model Context Protocol (MCP) projection, and its resource expose the current checkout. Fleet rows derive each checkout's own id and port.

## Use tokens during setup

Resource and setup commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, and `@dir@`. Resource commands also receive `@resource@`. The setup lifecycle writes inherited values and identity handles before one-time setup commands, then writes them again afterward. A command such as `cp .env.example .env` cannot erase the values setup delivered ([ADR 0059](../_adr/0059-worktree-setup-ensure.md)).

## Where it lives in code

| Responsibility                        | Source                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Identity derivation and id resolution | [`src/engine/worktree/identity.ts`](../../../src/engine/worktree/identity.ts)                           |
| Destructive ownership predicate       | [`src/engine/worktree/ownership.ts`](../../../src/engine/worktree/ownership.ts)                         |
| Env-file precedence and writes        | [`src/engine/worktree/env_file.ts`](../../../src/engine/worktree/env_file.ts)                           |
| Contained read and write paths        | [`src/shared/project_path.ts`](../../../src/shared/project_path.ts)                                     |
| Runtime tokens                        | [`src/engine/worktree/tokens.ts`](../../../src/engine/worktree/tokens.ts)                               |
| Frozen parity fixtures                | [`tests/fixtures/parity/worktree-identity.json`](../../../tests/fixtures/parity/worktree-identity.json) |

## Current state and gotchas

- The port, site tail, database name, and test seed use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes existing checkout coordinates or test order.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity.
- The seed provides deterministic test-order replay. It carries no randomness or security meaning.
