---
title: Identity and environment
description: How a worktree gets stable names, a deterministic port, inherited env values, and discoverable resource handles.
order: 40
aliases:
  - worktree identity
  - discern identity
  - worktree port
  - inherit env
---

# Worktree identity and environment

_A stable worktree id determines the branch name, local handles, and development port._

Identity lets concurrent worktrees address separate local services without a shared registry. It derives from structured Git and environment state, so moving a checkout does not change its names ([ADR 0025](../_adr/0025-worktree-resources.md)).

## Read the derived identity

Run `discern identity` inside a linked worktree and select the value you need:

| Selector            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `--id`              | Stable worktree id.                                                           |
| `--branch`          | `<branch_prefix><id>`, usually `agent/<id>`.                                  |
| `--port`            | `17290 + cksum(id) % 2000`.                                                   |
| `--site`            | Domain Name System (DNS)-safe `<project-slug>-<id>`, fitted to 63 characters. |
| `--db`              | Database-safe `<project_slug>_<id>`.                                          |
| `--worktree`        | Generic `<project-slug>-<id>` handle.                                         |
| `--resource <name>` | `<project-slug>-<id>-<name>` for one declared resource.                       |
| `--resources`       | Every declared resource as `name=handle`.                                     |

The id resolves from `DISCERN_WORKTREE_ID` in the current process, then from the configured environment files, then from Git's linked-worktree metadata. An explicit override accepts letters, numbers, dots, dashes, and underscores. Record one when a manually named integration worktree needs a different derived identity. This runtime precedence never grants destructive ownership: automatic cleanup derives its id from the exact worktree entry in Git's administrative metadata and requires discern's plain worktree-ready marker as separate evidence.

`discern start` checks the port for collisions with live siblings and mints another id when needed. Port selection remains best-effort: a crowded band does not block creation, and simultaneous start processes have no cross-process lock. Record a different `DISCERN_WORKTREE_ID` if 2 live worktrees ever receive the same port.

## Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first listed file.

Each entry may use any portable project-relative filename. It does not need an `.env` basename. discern removes leading `./` prefixes and refuses entries that name the same case-insensitive path.

Reads may follow a symbolic link when its target stays inside the project. A missing or stale checkout, an unreadable file, or a link that leaves the project behaves as an absent env file. Before writing, discern refuses every symbolic-link component instead of modifying its target; configure the target path directly or replace the link with a regular file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. Inheritance creates the first env file when it is missing, so every declared value arrives. It copies only the named keys. The rest of the main checkout's local env stays there.

The configured env files can carry the values listed in the [environment-variable reference](../70-reference/environment-variables.md#worktree-environment). `[worktree].port` defaults to `false`; set it to `true` when project tooling reads the development-port value. The lifecycle records that value only when the setting is on and an env file exists. `discern identity --port` and the `@port@` setup token remain available either way. Resource handles are recorded when an env file exists. The id remains an optional override supplied by the project or user.

Identity commands remain available when the project has no env file. `discern status` derives fleet ids and ports from each worktree's own identity rather than inventing values from branch names.

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

- The port, site tail, and database name use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes every existing worktree's identity.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity.
