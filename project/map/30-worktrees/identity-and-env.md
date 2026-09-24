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

Run `discern identity` in the main checkout or a linked worktree and select the value you need. To inspect another registered checkout, pass its exact worktree id, path, local branch, or full local ref as the positional argument. Ambiguous selectors refuse instead of choosing by fleet order ([ADR 0359](../_adr/0359-worktree-targets-share-one-resolution-contract.md)).

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

| Identity limit                     | Exact boundary                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Generated name slug                | At most 40 characters before the six-hex-character uniqueness tail.                                      |
| `DISCERN_WORKTREE_ID` override     | 1–81 characters; first character alphanumeric, remainder letters, numbers, dots, dashes, or underscores. |
| Port band                          | 2,000 ports, `17290` through `19289`.                                                                    |
| `--site`                           | One DNS label of at most 63 characters; overlong id tails are hash-fitted.                               |
| `--db`, `--worktree`, `--resource` | No product length clamp. Apply the destination system's limit; use `--site` for a DNS label.             |
| Git metadata slug collision        | An id equal to the project slug, or the slug followed by digits, receives the `wt-` prefix.              |

A linked worktree resolves its id from `DISCERN_WORKTREE_ID`, configured environment files, then Git metadata. Overrides accept letters, numbers, dots, dashes, and underscores. This read-only precedence never grants destructive ownership: cleanup uses the exact Git worktree entry plus discern's ready marker.

Main identity uses the configured trunk and preserves it in `--branch`. Its seed changes only with that setting. Worktree seeds stay stable by branch; branches rotate order. Neither uses the clock nor secure entropy.

`discern start` avoids trunk and live-sibling port collisions when possible. A crowded band or racing starts may collide; change `DISCERN_WORKTREE_ID` then.

Every derived value is deterministic local coordination, with no security or global-uniqueness meaning. Port hashing, input normalization, and repeated project slugs can collide; the destination system still owns conflict detection and access control.

## Keep task metadata separate from identity

The worktree id, branch, path, resource handles, port, and environment values form stable lifecycle identity. A task's display title and optional brief are mutable human metadata. New starts store that metadata with the creation ref and resolved commit in the linked worktree's Git administrative directory at `discern/task-metadata.json` ([ADR 0356](../_adr/0356-task-metadata-follows-the-worktree-identity.md)). Git activity and the logbook remain the timestamp authorities.

Status joins the record to the derived id and branch. A missing record marks an older worktree and uses its id-derived label. An invalid or unreadable record reports unavailable metadata with the same bounded fallback. `discern worktree rename <title>` changes the display title through a plan and apply operation. It leaves stable identity and the stored brief and creation source intact.

Moving a registered worktree retains its Git administrative directory and task metadata. Acceptance, Drop, failed-start cleanup, and Git worktree removal remove the record with that directory. A retained branch without a worktree therefore has no task record. Cloning and fetching transfer Git history and refs without transferring this local metadata.

## Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first existing listed file. A write reconciles one `Worktree values managed … via [worktree] in discern.toml` marker in either attribution mode. Its scope is the discern-managed values within the shared file.

Each entry may use any portable project-relative filename. It does not need an `.env` basename. discern removes leading `./` prefixes and refuses entries that name the same case-insensitive path.

Reads may follow a symbolic link when its target stays inside the project. A missing file, a missing or stale checkout, or a link that leaves the project behaves as an absent env file. A listed file that exists but that discern cannot read could hold the winning definition of any key, so every value the files supply becomes unknown. A file without read permission and a directory at the listed path both count. Identity resolution, inheritance, and env writes then refuse and name the file. Status marks that checkout unreadable, reports its derived id and port, and withholds recorded resource handles ([ADR 0328](../_adr/0328-absence-and-unknown-observations-stay-distinct.md)). Before writing, discern refuses every symbolic-link component instead of modifying its target; configure the target path directly or replace the link with a regular file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. A value replaces an empty worktree value or the matching default in `<first-configured-env-file>.example`; a worktree-specific value is preserved. Inheritance creates the first configured env file at POSIX mode `0600` when it is missing and never changes an existing file's mode. It copies only the named keys. The rest of the main checkout's local env stays there.

The default configuration creates or changes no env file: inheritance names no values, port recording is off, and no resources are declared. Only declared inheritance may create the first configured file. Port and resource recording update an existing configured file or remain available through `discern identity`. The id remains an optional override supplied by the project or user.

Identity commands work without an env file. Status, its Model Context Protocol (MCP) projection, and its resource expose the current checkout. Fleet rows derive each checkout's own id and port.

## Use tokens during setup

Resource and setup commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, and `@dir@`. Resource commands also receive `@resource@`. The setup lifecycle writes inherited values and identity handles before one-time setup commands, then writes them again afterward. A command such as `cp .env.example .env` cannot erase the values setup delivered ([ADR 0059](../_adr/0059-worktree-setup-ensure.md)).

## Where it lives in code

| Responsibility                        | Source                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Identity derivation and id resolution | [`src/engine/worktree/identity.ts`](../../../src/engine/worktree/identity.ts)                           |
| Worktree target resolution            | [`src/engine/worktree/target_resolution.ts`](../../../src/engine/worktree/target_resolution.ts)         |
| Human task metadata schema            | [`src/shared/task_metadata.ts`](../../../src/shared/task_metadata.ts)                                   |
| Worktree-local metadata store         | [`src/engine/worktree/task_metadata.ts`](../../../src/engine/worktree/task_metadata.ts)                 |
| Destructive ownership predicate       | [`src/engine/worktree/ownership.ts`](../../../src/engine/worktree/ownership.ts)                         |
| Env-file precedence and writes        | [`src/engine/worktree/env_file.ts`](../../../src/engine/worktree/env_file.ts)                           |
| Contained read and write paths        | [`src/shared/project_path.ts`](../../../src/shared/project_path.ts)                                     |
| Runtime tokens                        | [`src/engine/worktree/tokens.ts`](../../../src/engine/worktree/tokens.ts)                               |
| Frozen parity fixtures                | [`tests/fixtures/parity/worktree-identity.json`](../../../tests/fixtures/parity/worktree-identity.json) |

## Current state and gotchas

- The port, site tail, database name, and test seed use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes existing checkout coordinates or test order.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity. An explicit identity target does not require the invoking directory to survive the worktree's removal. A missing process directory supplies no override authority; other read failures still propagate.
- The seed provides deterministic test-order replay. It carries no randomness or security meaning.
- Identity handles and ports can collide and confer no ownership or access rights.
