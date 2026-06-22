# ADR 0025: Generalize the worktree db/dev-server adapters into per-worktree resources with orphan GC

**Status**: accepted

## Context

discern isolates each line of work in a linked `git worktree`, and from the
start it isolated a few per-worktree EXTERNAL resources with **hard-coded**
adapters: a database (`[worktree.db]` clone/drop), a dev-server link
(`[worktree.dev_server]` link/unlink), and a deterministic port
(`[worktree].port`). Each was a bespoke seam in the engine.

Two gaps surfaced in real use:

1. **No generic seam.** Projects increasingly need to isolate OTHER per-worktree
   externals — a device/emulator/VM/container instance — so that concurrent
   agents in different worktrees never contend over one shared global instance.
   The hard-coded db/dev_server pair couldn't express that without forking the
   engine.

2. **No garbage collection.** When a worktree vanishes WITHOUT a clean teardown
   (hard kill, `rm -rf`, a crash), its external resource leaks. `worktree:prune`
   deliberately did **not** drop databases — it runs from the main checkout, and
   the drop command needs the worktree's identity, which was only resolvable
   from inside the (now-gone) worktree. Orphans accumulated, and a stale
   leftover instance silently corrupted later runs.

A third pressure was consistency: two hard-coded adapters with their own config
shapes, ordering, and failure rules are harder to reason about than one
mechanism.

## Decision

**One generic seam: `[worktree.resources.<name>]`.** A project declares any
number of named per-worktree resources, each with a `create` command (run once
at setup), a `destroy` command (run once at teardown), and optional `ensure`
(idempotent re-readiness at session start), `required` (default true — a failed
create aborts setup), `retries` (default 0), and `gc` (default true — may
orphan-GC reclaim it). Resources are **created in document order and destroyed
in reverse**. db and dev_server are **demoted to two commented examples** of
this mechanism — the engine no longer knows them by name. `[worktree].port`
stays derived identity (it provisions nothing), not a resource.

**Identity.** A resource's handle is `resourceForId(slug, id, name)` =
`<slug>-<id>-<name>`, sanitized — deterministic, unique across worktrees and
resources, **namespaced by project** (the slug prefix, so two projects'
worktrees on one host never collide), and shell-safe. It is exposed as the
`@resource@` token (bound to the running resource), via
`discern worktree-name --resource <name>`, and in the worktree's `.env` as
`DISCERN_RESOURCE_<NAME>` — all three yield the same value, so a project's own
tooling (running later, in a separate process) can address its OWN resource
instead of guessing from a shared global pool. The existing
`@db@`/`@site@`/`@port@` tokens are **kept** and remain available to every
resource command: db needs an underscore-safe handle and dev_server a DNS-safe
one, so routing them through the dash-form `@resource@` would have broken them.
Keeping them also made the migration a pure command-move with no token
rewriting.

**A ledger, keyed on the git admin-dir basename.** discern records every
resource it creates as one JSON file per (worktree, resource) under
`<git-common-dir>/discern/resources/`. The ledger is the GC's single source of
truth: prune reconciles it against the live worktrees and runs `destroy` for any
entry whose worktree is gone. The primary key is the **git admin-dir basename**
(`<common>/worktrees/<key>`), git's own stable identity for a worktree — **not**
the worktree path. We explicitly rejected path-keying: a path is ambiguous under
symlink canonicalization (a live writer resolves `/tmp/x`→`/private/tmp/x`, a
dead-dir GC may not) and under path reuse (a new worktree landing on a removed
one's path), and either ambiguity could leak an orphan or destroy a live
resource.

**Conservative GC.** GC only ever runs a destroy command that is IN this
project's ledger, and only when the worktree is provably gone (its key is absent
from `<common>/worktrees/` after `git worktree prune`) AND no live worktree
still holds the path or the resource handle (the recycling guard) AND the entry
isn't `gc =
false`. The frozen, fully-expanded destroy command is run (identity
can't be re-derived once the worktree is gone); a command that still carries an
`@token@` is refused rather than half-run. Deletion is compare-and-swap.
`worktree:prune
--dry-run` reports what would be reclaimed without acting.

**Explicit *no*s.** GC never enumerates external resources directly (it only
acts through the ledger), never reclaims by physical-dir-absence (a locked,
temporarily-unmounted worktree keeps its admin dir and is live), and never
touches another project's ledger (each repo has its own `.git`).

**A breaking config change, carried by a migration.** The engine reads only
`[worktree.resources.*]`; the schema 7→8 migration carries non-empty
clone/drop/link/unlink forward as create/destroy and deletes the legacy tables,
and `doctor` hard-fails on a leftover `[worktree.db]`/`[worktree.dev_server]`
(the failure is otherwise silent — setup would succeed with no database).
discern is pre-public-launch, so we took the clean break rather than carry a
dual config shape forever.

## Consequences

- **The motivating case is now expressible** with no engine change: a project
  wires a per-worktree emulator/container as `[worktree.resources.<name>]` and
  discovers its handle at runtime.
- **Orphans are reclaimed.** `worktree:prune` now GCs orphaned resources —
  including databases, which it used to skip. This is strictly safer than the
  old "DBs leak forever," but it does mean prune can run a destructive `dropdb`
  from the main checkout; the conservative guards, `gc = false` opt-out, and
  `--dry-run` bound that blast radius.
- **One mechanism, one mental model.** Setup/teardown/graduate/prune all flow
  through the same resource layer; db and dev_server have no privileged status.
- **State returns under `.git/`** — a deliberate, narrow exception to ADR 0020's
  "the footprint is a single root `discern.toml`." 0020 is about the _config_
  footprint; the ledger is _runtime per-worktree state_, not config.
  `.git/discern/` is the correct home: per-project, untracked, shared across a
  repo's worktrees, and it survives an individual worktree's removal — exactly
  the lifetime the GC needs.
- **Costs.** A worktree-lifetime resource can die out-of-band (a host reboot
  stops a running instance); discern offers an optional `ensure` to reconcile
  it, but re-readiness is otherwise the project's responsibility. The migration
  drops inline comments on the old clone/drop keys (the doc paragraph is
  preserved). A hand-maintained config that skips `discern upgrade` is dead
  until migrated — doctor flags it, and the manual steps are in the upgrade
  notes.

## Alternatives considered

- **Keep db/dev_server hard-coded; only add the GC machinery.** Rejected: it
  leaves two config shapes and two failure models forever, and the brief
  explicitly wanted db/dev_server to become instances of the generic mechanism.
  The clean break is the version that actually delivers "one seam."
- **Seed db/dev_server as live (empty) tables** rather than commented examples.
  Rejected: an empty live table that provisions nothing is a privileged special
  case; commented examples match the established `[capabilities]` idiom ("absent
  = knowably absent") and make a fresh install declare zero resources.
- **Key the ledger on the worktree path** (with the basename as a fallback).
  Rejected — see Decision: the path is the _less_ stable key. The git admin-dir
  basename is git-guaranteed unique among live worktrees and independent of the
  `DISCERN_WORKTREE_ID` override.
- **Re-expand the destroy command from current config at GC time.** Rejected as
  the primary path: the worktree is gone, so a `@dir@` would expand to empty and
  a re-expanded `rm -rf @dir@/cache` could become `rm -rf /cache`. The frozen
  create-time command is what was true of the resource; it is authoritative.

This builds on [ADR 0011](0011-adopt-worktree-workflow.md) (the worktree
workflow) and [ADR 0007](0007-adapter-contract.md) (the adapter contract it
generalizes), and narrows [ADR 0020](0020-dissolve-discern-dir.md) for runtime
state as noted above.
