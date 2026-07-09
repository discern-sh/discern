# Per-worktree resources

_External things that must exist for exactly the life of a Worktree — and get
reclaimed when one leaks._

A **resource** is something outside git that a Worktree needs in isolation: a
database, an emulator/device/VM, a container, a queue, a bucket, a namespace.
discern provides the orchestration and the garbage collection; the project
provides the `create`/`destroy` commands. The engine never learns what the
resource actually is — the seam is fully generic.

`[worktree.db]` and `[worktree.dev_server]` are just two commented examples of
this one generic mechanism (the generalization is recorded in
[ADR 0025](../_adr/0025-worktree-resources.md)). The deterministic port
(`[worktree].port`) is **not** a resource — it is derived identity and
provisions nothing.

## The config seam

```toml
[worktree.resources.<name>]
create  = "..."   # run once at setup; author idempotent (empty = no-op)
destroy = "..."   # run once at teardown  (empty = nothing to tear down / GC)
ensure  = "..."   # optional: idempotent re-readiness, run at session start
required = true   # optional: a failed create aborts setup (default true)
retries  = 0      # optional: retry create/destroy on a non-zero exit (default 0)
gc       = true   # optional: may orphan-prune reclaim it? (default true)
```

Resources are **created top-to-bottom and destroyed bottom-to-top** (document
order at create, reversed at destroy), so a dependency declared first is torn
down last. Commands run via `sh -c` after `@…@` token expansion; an empty
command is a clean no-op. A `required` create that fails aborts setup loudly
(the default); `required = false` warns and continues.

## The lifecycle

| Phase                                             | What happens                                                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern worktree setup`                          | **setup** — creates each resource (a ledger entry is written first, so a crash mid-create is GC-able), then records its handle into `.env`.                                |
| `discern worktree setup` re-run / re-fired hook   | **re-ready, never re-create** — an already-configured worktree skips resource `create` and the setup steps, running each resource's `ensure` instead. Setup is idempotent. |
| any later command                                 | **reuse** — the resource persists for the whole Worktree; nothing re-creates it. Pay an expensive readiness cost once, never per-invocation.                               |
| `discern worktree teardown` / `drop` / `graduate` | **destroy** — runs each resource's destroy in reverse order (best-effort), then clears its ledger entry. A clean exit leaves no orphan.                                    |
| `discern worktree prune`                          | **garbage-collect** — reclaims the resources of any Worktree that vanished WITHOUT a clean teardown (hard kill, `rm -rf`, crash).                                          |

Teardown is **best-effort and idempotent**: a failure is logged and never
strands a Worktree (a later prune is the backstop), and a destroy that runs when
the resource is already gone must be a clean no-op — author it that way. Author
`destroy` to be **cwd-independent**, too: at teardown it runs from the Worktree,
but at GC it runs from the **main checkout** (the Worktree is gone), so use
`@…@` handles or absolute paths — never a relative path like `./cache`.

## Identity, ownership, and namespacing

A resource's **handle** is its deterministic, project-namespaced name:

```
resourceForId(slug, id, name) = "<slug>-<id>-<name>"   (sanitized to [a-z0-9-])
```

It is:

- **deterministic** — the same Worktree + resource always resolves the same
  handle;
- **unique** — across Worktrees (the id) and across resources (the name);
- **namespaced by project** — the slug prefix means two projects' Worktrees on
  the same host can never collide on a handle;
- **shell/CLI/resource-name-safe** — sanitized, unclamped (a resource that needs
  a length-bounded DNS label can use `@site@` instead).

These tokens are available to every resource command, expanded per-Worktree at
run time:

| Token            | Value                                         | Read it with                 |
| ---------------- | --------------------------------------------- | ---------------------------- |
| `@resource@`     | this resource's handle (`<slug>-<id>-<name>`) | `identity --resource <name>` |
| `@worktree@`     | the Worktree's base handle (`<slug>-<id>`)    | `identity --worktree`        |
| `@db@`           | a database-name-safe identity (underscores)   | `identity --db`              |
| `@site@`         | a DNS-safe site/host name                     | `identity --site`            |
| `@port@`         | the deterministic dev-server port             | `identity --port`            |
| `@project_slug@` | the project slug                              | `config get project.slug`    |
| `@dir@`          | the Worktree root (absolute)                  | —                            |

`@resource@` is bound to the resource whose command is running; it is empty in
`[worktree.setup].steps` (which run outside any single resource — use
`@worktree@`/`@db@`/`@site@` there). The seeded `db` example uses `@db@` and
`dev_server` uses `@site@`, because those shapes (underscore-safe, DNS-safe) are
what a database engine and a vhost actually require.

## Runtime discovery (for your own tooling)

A project's gate, scripts, or app — running **later, in a separate process**
inside the Worktree — discover a resource's handle two ways, both equal to what
`create` used:

1. **Query:** `discern identity --resource <name>` (and `--resources` to list
   every declared resource as `name=handle` lines).
2. **Env:** the Worktree's `.env` carries `DISCERN_RESOURCE_<NAME>` (uppercased,
   non-alphanumerics → `_`) and `DISCERN_WORKTREE`, written at setup when a
   `.env` exists.

This is the crux of the feature: a project's tooling addresses its OWN isolated
resource instead of guessing from a shared global pool.

## The ledger and orphan garbage-collection

discern records every resource it creates as one JSON file per (Worktree,
resource) under **`<git-common-dir>/discern/resources/`** — inside the shared
`.git` admin area. That location is deliberate: it is shared across a repo's
Worktrees (they share the common git dir), it survives an individual Worktree's
removal, it is per-project (each repo has its own `.git`), and it is untracked
by git. The entry records the project, the Worktree's git key, the resource
handle, and the **frozen, fully-expanded destroy command** — everything GC needs
once the Worktree is gone and its identity can no longer be re-derived.

`worktree prune` reconciles the ledger against the live Worktrees and runs
`destroy` for any entry whose Worktree has vanished. GC is **conservative by
construction** — it only ever runs a destroy command that is IN this project's
ledger, and it keeps (never reclaims) an entry that is any of:

- still live — its git key is present, or its path is still a registered
  Worktree;
- a **recycled handle** — a live Worktree currently owns the same handle;
- `gc = false` — opted out of GC (teardown-only; use this for
  data-loss-sensitive resources you only ever want torn down explicitly);
- carrying an unresolved `@token@` in its frozen destroy command (refused, never
  half-run).

Deletion is compare-and-swap, and `worktree prune --dry-run` reports exactly
what it _would_ reclaim without acting. A clean `graduate`/`teardown` clears
entries up front, so only an unclean exit ever leaves an orphan for GC to find.

> **Why keyed on the git admin-dir basename, not the path?** git's admin-dir
> basename (`<common>/worktrees/<key>`) is git's own stable,
> unique-per-live-Worktree identity, immune to symlink canonicalization and path
> reuse. Keying on the path would risk leaking an orphan or destroying a live
> resource when a path is reused or resolves differently for a live writer vs a
> dead-dir GC. See [ADR 0025](../_adr/0025-worktree-resources.md).

## Drift

A worktree-lifetime resource can die out-of-band — a host reboot stops a running
emulator. Declare an `ensure` command to reconcile it: `worktree ensure` (the
session-start hook) runs each resource's `ensure` when the Worktree is already
set up. `ensure` must be idempotent. If a resource declares no `ensure`,
re-readiness is the project's responsibility.

## See also

- [ADR 0025](../_adr/0025-worktree-resources.md) — the decision, the
  GC/ownership model, and the breaking change + manual migration.
- The `[worktree.resources.<name>]` block in the seed
  [`discern.toml`](../../templates/discern.toml.tmpl).
