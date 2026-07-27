---
title: Per-worktree resources
description: Configure external resources that discern creates, reuses, destroys, and reclaims with each worktree.
order: 30
aliases:
  - worktree resources
  - resource lifecycle
  - resource garbage collection
  - worktree database
---

# Per-worktree resources

_Give each worktree the external state it needs, then remove that state when the worktree goes away._

A resource is an external thing a worktree needs in isolation: a database, emulator, container, queue, bucket, or namespace. discern runs the lifecycle. The project supplies the commands. A fresh installation declares no resources, so worktree creation remains stack-neutral ([ADR 0025](../_adr/0025-worktree-resources.md)).

The deterministic development port belongs to [identity](identity-and-env.md). It names a port and provisions nothing.

## Configure a resource

Declare resources in `discern.toml` in dependency order:

```toml
[worktree.resources.db]
create = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"
ensure = "pg_isready -d @db@"
required = true
retries = 0
gc = true
```

| Key        | Default | Behavior                                                 |
| ---------- | ------- | -------------------------------------------------------- |
| `create`   | `""`    | Runs once during first setup.                            |
| `destroy`  | `""`    | Runs during teardown or orphan cleanup.                  |
| `ensure`   | `""`    | Reconciles readiness on session start.                   |
| `required` | `true`  | Aborts first setup when creation fails.                  |
| `retries`  | `0`     | Retries failed create and destroy commands, capped at 5. |
| `gc`       | `true`  | Lets `worktree prune` reclaim an orphan.                 |

Commands run through `sh -c` after token expansion. discern creates resources from top to bottom and destroys them in reverse order. A dependency declared first remains available until discern removes its dependents.

## Follow the resource lifecycle

| Worktree phase                | Resource behavior                                            |
| ----------------------------- | ------------------------------------------------------------ |
| First setup                   | Writes a ledger entry, then runs `create`.                   |
| Repeated setup                | Skips `create`; the ledger entry proves it already ran.      |
| Session start                 | Runs `ensure` when configured.                               |
| Normal work                   | Reuses the same resource handle.                             |
| `accept`, `drop`, or teardown | Runs the frozen `destroy` command in reverse order.          |
| `worktree prune`              | Reclaims recorded resources whose worktree is provably gone. |

discern writes the ledger entry before `create`. That intent record makes a crash during provisioning visible to garbage collection. discern reports a non-required creation failure and continues setup. A required failure stops setup with the command to fix.

Teardown is best-effort. A failed `destroy` leaves its ledger entry in place so a later prune can retry. Use `gc = false` for data-loss-sensitive resources that only explicit teardown may remove.

## Understand the ledger

The ledger stores one JSON file per worktree and resource under `<git-common-dir>/discern/resources/`. Git worktrees share that directory, while separate repositories do not. Each entry records the git worktree key, canonical path, resource handle, retry budget, and fully expanded destroy command.

Garbage collection acts only on entries in this project's ledger. It keeps live git keys and paths, handles owned by live worktrees, entries with `gc = false`, and commands with unresolved tokens. Before each destroy, it checks live state and the ledger entry again. A concurrent worktree cannot lose a newly recycled handle to an older orphan record.

`discern worktree prune --dry-run` shows the candidates without destroying them. The apply path consumes that plan and rechecks every candidate immediately before the irreversible step ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).

## Where it lives in code

| Responsibility                                 | Source                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Resource specs, ledger, and garbage collection | [`src/engine/worktree/resources.ts`](../../../src/engine/worktree/resources.ts)               |
| Lifecycle orchestration                        | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)               |
| Token expansion                                | [`src/engine/worktree/tokens.ts`](../../../src/engine/worktree/tokens.ts)                     |
| Resource behavior tests                        | [`tests/engine_worktree_resources_test.ts`](../../../tests/engine_worktree_resources_test.ts) |

## Current state and gotchas

- Make `create`, `destroy`, and `ensure` idempotent. `ensure` runs routinely, and a failed destroy remains eligible for another attempt.
- Make `destroy` independent of the current directory. Orphan cleanup runs it from the main checkout after the worktree directory has disappeared.
- Use identity tokens or absolute paths in `destroy`; a relative path such as `./cache` points somewhere else during orphan cleanup.
- `@resource@` exists only inside that resource's commands. Use `@worktree@`, `@db@`, `@site@`, or `@port@` in `[worktree.setup]`.
