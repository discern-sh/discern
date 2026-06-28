# ADR 0016: Consolidate the install surface under `.discern/`

> **Retired — superseded by [ADR 0020](../0020-dissolve-discern-dir.md).** The
> `.discern/` namespace it introduced is dissolved into a single root
> `discern.toml`. Kept for history; not current architecture.

**Status**: accepted; **superseded by
[ADR 0020](../0020-dissolve-discern-dir.md)** (the `.discern/` namespace this
introduced is dissolved into a single root `discern.toml`).

## Context

`discern init` into a fresh project scaffolded **66 files across eight top-level
entries**: `bin/`, `docs/`, `TODO.md`, `discern.toml`, `.ai/`, `.claude/`,
`.discern/`, and `.gitignore`. The raw count is not the problem — `.git/` is
thousands of files behind one entry and nobody minds. The problem is **spread**
and **premature seeding**:

- **Machinery leaked out of its namespace.** The dispatcher lived at `bin/agent`
  (colliding with projects that have their own `bin/`, and easy for an agent to
  forget — guidance reflexively says "run `agent …`", not "run `bin/agent …`"),
  and author-once guidance/skills lived under a second top-level dotdir `.ai/`.
  A developer adding the harness saw several new top-level entries they did not
  create.
- **We documented a system that did not exist yet.** `init` laid down a 15-file
  `docs/` skeleton and a `TODO.md`, almost entirely
  `<!-- /bootstrap fills
  this -->` placeholders, on day one — before there was
  anything to document.
- **The config carried the kit's brand into the project root.** `discern.toml`
  sat at the top level of every consumer.

This is pre-adoption (no public release), so the layout can still change freely
— the cheapest this will ever be (the same window ADR 0009 and ADR 0014 leaned
on).

## Decision

Consolidate everything the kit owns under the single `.discern/` namespace, and
defer the developer-space artifacts until they have real content.

1. **One namespace for machinery.** The dispatcher moves to a **root-level
   `agent`** (a real managed file, not a symlink — the installer is data-driven,
   so this is a plain file move; `bin/` is gone). The config moves to
   **`.discern/config.toml`**; guidance to **`.discern/guidelines/`**; skills to
   **`.discern/skills/`**. The `.ai/` directory is gone. The "is this a discern
   project?" root marker is now `.discern/config.toml` (with a legacy fallback
   to `discern.toml`, see point 4). After `init`, a plain `ls` shows nothing new
   but `agent` and the `.discern/` namespace.

2. **Lazy docs and TODO.** `init` scaffolds **no `docs/` tree and no
   `TODO.md`**. The doc/ADR/TODO skeletons ship inside the skills that consume
   them, under `.discern/skills/<skill>/skel/`, and are created on demand:
   `/bootstrap` materialises the orientation + `80-development` tree and
   `TODO.md`; `write-adr` creates `docs/_adr/`; `document-subsystem` creates
   `docs/_internal/`. The docs/ADR/backlog _discipline_ is unchanged — it is
   delivered by the skills, not by empty scaffolding. `[project].gotchas_doc`
   defaults to empty and `/bootstrap` sets it when it creates the gotchas doc.

3. **`bin/` is eliminated, not relocated behind a symlink.** The daily command
   is the literal `agent` at the repo root.

4. **Existing installs migrate, they are not re-initialised.** This is the first
   _structural_ step on the ADR 0014 migration chain — exactly the case that ADR
   anticipated ("the eventual kit rename … lands later as a further step"). A
   new **schema 2 → 3** migration renames `bin/agent` → `agent`, `discern.toml`
   → `.discern/config.toml`, `.ai/guidelines` → `.discern/guidelines`,
   `.ai/skills` → `.discern/skills`, repoints the `.claude` worktree hooks at
   `./agent`, and best-effort repoints the neutral-scope globs. The migration is
   **idempotent** (each rename no-ops once its source is gone, so a re-run — or
   an install already in the new layout — passes through cleanly).
   `upgrade`/`migrate` detect the config at either the new or the legacy path so
   a pre-migration install is still recognised and carried forward; the
   migration runner's config-editing context resolves the same way. This repo is
   migrated by running its own step.

## Consequences

- The empty-project blast radius drops from **66 files across 8 entries** to
  roughly **48 files across 4** (`agent`, `.discern/`, and the two unavoidable
  integration files `.claude/settings.json` and `.gitignore`). The "all over the
  place" complaint is answered by consolidation, not by shrinking the engine
  (whose ~30 shell files stay — they are invisible under one entry, and bundling
  them would hurt maintainability).
- **A migration step and corpus fixture are owed**, per the ADR 0014 discipline:
  the "upgrade ≡ fresh init" convergence test must stay green, and a focused 2→3
  unit test exercises the transform directly. This is the same gate-enforced
  discipline as `selfcheck`.
- **The legacy `discern.toml` path is now a recognised input** to `upgrade`/
  `migrate` (and the migration context). This is a small, permanent piece of
  backward-tolerance; it is the seam that makes the migration reachable.
- This amends — does not supersede —
  [ADR 0008](0008-declarative-managed-set.md): the managed set in `managed.json`
  now lists `agent` and `.discern/skills/` rather than `bin/agent` and
  `.ai/skills/`. It does not change the managed-vs-seed model.
- The skills are a known follow-up: this change **relocates** them and bundles
  their scaffolding, but does not rethink _which_ skills ship or whether they
  should be per-repo vs. global.

## Alternatives considered

- **A root `agent` symlink into `.discern/`.** Rejected: a committed symlink
  does not reproduce reliably through the data-driven installer (reading a
  symlink's bytes yields a real file), so it would need a bespoke "symlink"
  disposition, cross-platform handling, and selfcheck of link integrity — real
  installer complexity for no visible gain. `ls` shows `agent` at the root
  either way; the only difference is whether that entry is a 1-line pointer or
  the real script.
- **Keep `discern.toml` at the project root.** A root config file is a strong
  convention (`package.json`, `Cargo.toml`, `deno.json`). Rejected in favour of
  a clean root: the config is edited rarely after bootstrap, and keeping it in
  the namespace makes the marker, the engine, the guidance, and the skills one
  coherent door.
- **Keep scaffolding the docs tree at `init` as a forcing function.** Rejected:
  16 placeholder files on day one read as noise, and the discipline is already
  carried by the skills that author the content. Lazy creation puts a file on
  disk only when it has something real in it.
- **A clean break with no migration.** Rejected once the maintainer asked to
  carry the existing internal installs forward — and doing so dogfoods the
  lightly-exercised ADR 0014 chain on its first real structural step, which is
  worth more than the saved effort.
