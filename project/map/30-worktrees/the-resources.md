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

| Key        | Default | Behavior                                                          |
| ---------- | ------- | ----------------------------------------------------------------- |
| `create`   | `""`    | Runs until one `ready` transition; uncertain intent cleans first. |
| `destroy`  | `""`    | Runs during teardown or orphan cleanup.                           |
| `ensure`   | `""`    | Reconciles readiness on session start.                            |
| `required` | `true`  | Aborts first setup when creation fails.                           |
| `retries`  | `0`     | Retries failed create and destroy commands, capped at 5.          |
| `gc`       | `true`  | Lets `worktree prune` reclaim an orphan.                          |

Commands run through `sh -c` after token expansion. discern creates resources from top to bottom and destroys them in reverse order. A dependency declared first remains available until discern removes its dependents.

Every `create`, `ensure`, and `destroy` invocation (including orphan garbage collection) receives the same two environment keys: `DISCERN_WORKTREE` for the frozen worktree handle and that resource's `DISCERN_RESOURCE_<NAME>` handle.

## Follow the resource lifecycle

| Worktree phase                | Resource behavior                                               |
| ----------------------------- | --------------------------------------------------------------- |
| First setup                   | Persists `intent`, runs `create`, then records `ready`.         |
| Repeated setup after `ready`  | Skips `create`; readiness is durable evidence.                  |
| Repeated setup after `intent` | Runs frozen cleanup first; retries only after cleanup succeeds. |
| Session start                 | Runs `ensure` when configured.                                  |
| Normal work                   | Reuses the same resource handle.                                |
| `accept`, `drop`, or teardown | Runs the frozen `destroy` command in reverse order.             |
| `worktree prune`              | Tears down live removals; reclaims pre-existing orphans.        |

discern writes complete ownership, the worktree handle, expanded tokens, and the frozen destroy action before `create`. A crash or failed command therefore leaves visible `intent`; only a successful create records readiness. Re-entry cleans that uncertain state before retrying. If no safe destroy action exists or cleanup fails, setup refuses rather than possibly repeating a non-idempotent create. A non-required first failure stays visible in the setup result and continues; a required failure stops setup.

Teardown is best-effort. A failed `destroy` leaves its ledger entry in place so a later prune can retry. Use `gc = false` for data-loss-sensitive resources that require explicit teardown. When prune selects a live checkout for removal, its plan includes every recorded resource regardless of `gc`; apply destroys them from the checkout in reverse order and keeps the checkout if any destroy fails. Orphan garbage collection applies `gc` only after a checkout has already vanished.

## Understand the ledger

The ledger stores one JSON file per worktree and resource under `<git-common-dir>/discern/resources/`. Git worktrees share that directory, while separate repositories do not. Each entry records its `intent` or `ready` phase, Git worktree key, canonical path, worktree and resource handles, retry budget, token values, and fully expanded destroy command.

Garbage collection acts only on entries in this project's ledger. It keeps live Git keys and paths, handles owned by live worktrees, entries with `gc = false`, and commands with unresolved tokens. Before each destroy, it checks live state and the ledger entry again. Those checks prevent an older orphan record from destroying a newly recycled handle owned by a concurrent worktree.

`discern worktree prune --dry-run` shows the candidates without destroying them. The apply path consumes that plan and rechecks every candidate immediately before the irreversible step ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).

## Where it lives in code

| Responsibility                                 | Source                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Resource specs, ledger, and garbage collection | [`src/engine/worktree/resources.ts`](../../../src/engine/worktree/resources.ts)               |
| Lifecycle orchestration                        | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)               |
| Token expansion                                | [`src/engine/worktree/tokens.ts`](../../../src/engine/worktree/tokens.ts)                     |
| Resource behavior tests                        | [`tests/engine_worktree_resources_test.ts`](../../../tests/engine_worktree_resources_test.ts) |

## Current state and gotchas

- Make `destroy` and `ensure` idempotent. `ensure` runs routinely; frozen destroy may run after uncertain create intent and again after a failed teardown.
- Make `destroy` independent of the current directory. Orphan cleanup runs it from the main checkout after the worktree directory has disappeared.
- Use identity tokens or absolute paths in `destroy`; a relative path such as `./cache` points somewhere else during orphan cleanup.
- `@resource@` exists only inside that resource's commands. Use `@worktree@`, `@db@`, `@site@`, or `@port@` in `[worktree.setup]`.
