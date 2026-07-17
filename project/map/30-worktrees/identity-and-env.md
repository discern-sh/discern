---
title: Identity and environment
description: How a worktree gets stable names, a deterministic port, inherited env values, and discoverable resource handles.
order: 30
aliases:
  - worktree identity
  - discern identity
  - worktree port
  - inherit env
---

# Worktree identity and environment

_One stable worktree id drives every branch name, local handle, and development port._

Identity lets concurrent worktrees address separate local services without a shared registry. It derives from structured git and env state, so moving a checkout does not change its names ([ADR 0025](../_adr/0025-worktree-resources.md)).

## Read the derived identity

Run `discern identity` inside a linked worktree with one selector:

| Selector            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `--id`              | Stable worktree id.                                                           |
| `--branch`          | `<branch_prefix><id>`, usually `agent/<id>`.                                  |
| `--port`            | `13000 + cksum(id) % 2000`.                                                   |
| `--site`            | Domain Name System (DNS)-safe `<project-slug>-<id>`, fitted to 63 characters. |
| `--db`              | Database-safe `<project_slug>_<id>`.                                          |
| `--worktree`        | Generic `<project-slug>-<id>` handle.                                         |
| `--resource <name>` | `<project-slug>-<id>-<name>` for one declared resource.                       |
| `--resources`       | Every declared resource as `name=handle`.                                     |

The id resolves from `DISCERN_WORKTREE_ID` in the current process, then from the configured env files, then from git's linked-worktree metadata. An explicit override accepts letters, numbers, dots, dashes, and underscores. Record one when a manually named integration worktree needs a different derived identity.

`discern start` checks the port for collisions with live siblings and mints another id when needed. Port selection remains best-effort: a crowded band does not block creation, and simultaneous start processes have no cross-process lock. Record a different `DISCERN_WORKTREE_ID` if 2 live worktrees ever receive the same port.

## Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first listed file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. Inheritance creates the first env file when it is missing, so every declared value arrives. It copies only the named keys. The rest of the main checkout's local env stays there.

The configured env files can carry these values. The lifecycle records the port and resource handles when a file exists. The id remains an optional override supplied by the project or user.

| Variable                  | Contents                        |
| ------------------------- | ------------------------------- |
| `DISCERN_WORKTREE_ID`     | Optional explicit id override.  |
| `DISCERN_WORKTREE_PORT`   | Deterministic development port. |
| `DISCERN_WORKTREE`        | Generic worktree handle.        |
| `DISCERN_RESOURCE_<NAME>` | Handle for a declared resource. |

Identity commands remain available when the project has no env file. `discern status` derives fleet ids and ports from each worktree's own identity rather than inventing values from branch names.

## Use tokens during setup

Resource and setup commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, and `@dir@`. Resource commands also receive `@resource@`. The setup lifecycle writes inherited values and identity handles before one-time setup commands, then writes them again afterward. A command such as `cp .env.example .env` cannot erase the values setup delivered ([ADR 0059](../_adr/0059-worktree-setup-ensure.md)).

## Where it lives in code

| Responsibility                        | Source                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Identity derivation and id resolution | [`src/engine/worktree/identity.ts`](../../../src/engine/worktree/identity.ts)                           |
| Env-file precedence and writes        | [`src/engine/worktree/env_file.ts`](../../../src/engine/worktree/env_file.ts)                           |
| Runtime tokens                        | [`src/engine/worktree/tokens.ts`](../../../src/engine/worktree/tokens.ts)                               |
| Frozen parity fixtures                | [`tests/fixtures/parity/worktree-identity.json`](../../../tests/fixtures/parity/worktree-identity.json) |

## Current state and gotchas

- The port, site tail, and database name use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes every existing worktree's identity.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity.
