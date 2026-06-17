# Glossary

Every icculus-specific term, defined precisely. This is the canonical
dictionary: the names defined here are used verbatim across the whole
documentation tree, and synonyms are not introduced. The few nouns the whole
system is built on come first, because they show up everywhere else.

For a narrative tour of how these terms relate, read [concepts.md](concepts.md).
For the architectural shape, see [system-map.md](system-map.md).

---

## Core nouns

The handful of building blocks the rest of the system rests on. Understand these
six and the rest of the tree reads as variations on them.

### icculus

The whole tool: the **Installer** plus the **Harness** it ships. icculus
scaffolds a stack-neutral agentic-development harness into any repository, in
one command, and keeps it upgradable thereafter. The name (and `bin/agent`,
`.icculus/`) is a working placeholder pending a final one.

### Installer

The Deno/TypeScript CLI — `icculus init`, `upgrade`, `doctor`, `migrate`,
`config`, `add-adapter` — that lives under [`src/`](../../src/) and compiles to
single-file binaries in `dist/`. It scaffolds and refreshes an install. It is a
build-time tool only: an installed project never needs Deno, and the Installer
is never a runtime dependency of it.

### Harness

What an install _contains and runs_: the [`agent`](#agent-the-dispatcher)
dispatcher, the [Engine](#engine), the `icculus.toml` config, the bundled
[Skills](#skill), and the docs scaffold. It is pure POSIX shell plus a TOML
config. Every file in it originates in [`templates/`](../../templates/) — the
source of truth — which the Installer copies, renders, merges, or appends into
place.

### Engine

The stack-neutral logic of the Harness: the [Recipes](#recipe) and the shared
shell library under [`.icculus/engine/`](../../templates/.icculus/engine/). The
Engine knows nothing stack-specific — it runs the [Slots](#slot), Scopes, and
adapters a project declares in `icculus.toml`. All Engine files are
[managed](#managed-file).

### `agent` (the dispatcher)

[`bin/agent`](../../templates/bin/agent), the task-runner surface a coding agent
or person drives day to day. It finds the project root (the nearest ancestor
with an `icculus.toml`) and routes `agent <verb>` to the matching
[Recipe](#recipe), with the harness paths exported. Tiny and dependency-free:
the Recipes hold the logic.

### Recipe

One Engine command — a file under `.icculus/engine/` (e.g. `finish`, `tidy`,
`worktree`, `doctor`). A name with a colon maps to a hyphenated file
(`worktree:exit` → `worktree-exit`). A project may add its **own** unmanaged
recipes under `.icculus/recipes/`; on a name collision the Engine wins
([ADR 0001](../_adr/0001-project-owned-recipes.md)).

---

## The installer & the sync model

Terms for how an install is created, kept current, and migrated. Covered in
depth under [`../10-installer/`](../10-installer/).

### Kit version

The Installer's semantic version (e.g. `1.0.0`), declared once in `deno.json`
and read everywhere through [`version.ts`](../../src/lib/version.ts). Recorded
in the [Manifest](#manifest) and shown by `--version`.

### Schema version

A plain monotonic integer — the anchor the [Migration](#migration) chain steps
from. Distinct from the Kit version on purpose: it bumps **only** when an
installed project needs a migration to stay correct, so most releases leave it
untouched. The current shape is schema **2**.

### Manifest

[`.icculus/manifest.json`](#generated-file) — the [generated](#generated-file)
record of an install's Kit version, Schema version, and a content hash of every
[managed file](#managed-file). It is what lets `upgrade` and `selfcheck` tell a
pristine managed file from an edited one, and a current install from a stale
one.

### Migration

One **idempotent** step that brings an install from Schema version `N` to `N+1`.
`upgrade` reads the recorded Schema version, runs every pending step in order up
to the build's, then re-stamps. A step can edit `icculus.toml`
comment-preserving, move/rewrite files, and deep-merge settings
([ADR 0014](../_adr/0014-versioned-migration-system.md)).

---

## File dispositions

Every path an install contains has a **disposition** — how `icculus` treats it
on `upgrade`, and where it is edited. The four are mapped across the whole
surface in [install-surface.md](../80-development/install-surface.md).

### Managed file

A file copied verbatim from the kit's [`templates/`](../../templates/) tree and
held byte-identical to it by `selfcheck`. `icculus upgrade` refreshes it, and a
local edit is reported as drift and preserved alongside as `<file>.new`. A
managed file is edited at its `templates/` source, never at its installed path —
the managed set is declared in [`managed.json`](../../templates/managed.json)
(see [ADR 0008](../_adr/0008-declarative-managed-set.md)).

### Seed file

A file written once, at `icculus init`, from a `templates/….tmpl`, then owned by
the project. `upgrade` never refreshes or flags it; it is edited in place.
`icculus.toml`, the project guidelines, the `docs/` tree, and `TODO.md` are
seeds.

### Merged file

A file folded into whatever the project already has rather than written whole,
so an existing project keeps its own content. It is produced only at `init` and
left untouched by `upgrade`, in one of two forms: a structured merge
(`.claude/settings.json`) or an idempotent append (`.gitignore`).

### Generated file

A file produced by a harness command after install rather than copied from a
template, and reproduced by re-running that command rather than edited directly.
The `guidelines` recipe compiles `CLAUDE.md`, `AGENTS.md`, and the
`.claude/skills/` symlinks; the installer writes `.icculus/manifest.json`.

---

## The quality gate

Terms for `agent finish` and what it runs. Covered in depth under
[`../20-quality-gate/`](../20-quality-gate/).

### Slot

One stack-specific command, declared as `[slots.<name>]` in `icculus.toml`. Its
`run` is the shell command; its `phase` decides when it runs. A fresh install's
slots default to the `:` no-op, so the gate is green before any is filled. The
Engine discovers slots by name — only `phase` and `run` matter.

### Phase

When and how a Slot runs inside `finish`: **fix** (mutating fixers, run serially
first), **build** (artifact producers, parallel with fix), **check** (read-only
analysis), **test** (the suite) — check and test run in parallel after
fix+build. A Slot with **no** phase is a **measurement slot**: `finish` never
runs it; a [Ratchet](#ratchet) reads it on demand.

### Gate

`agent finish` — the compound quality gate: the four Phases in order, then any
[Side gates](#side-gate) whose Scope changed, then (in a worktree) the
main-merged check. Each Slot runs as its own labelled job, so a failure is
attributed to the precise Slot. `agent tidy` is the fast inner loop — the fix
Slots then the check Slots, no build or test.

### Scope

A classification of which part of the repo a change touches, declared under
`[scopes]` (e.g. `neutral`, `web`, `previewable`, or a custom name). Used to
skip irrelevant work and to fire Side gates. Classification **fails open**: a
path matching nothing counts as a real code change, so it runs more gates, never
fewer.

### Side gate

A command mapped to a Scope under `[scopes.side_gates]`, run by `finish` only
when that Scope actually changed — the way a sub-component with its own
self-contained gate plugs in
([ADR 0002](../_adr/0002-first-class-side-gates.md)).

### Ratchet

A never-loosen quality floor or ceiling (line coverage, a size budget, a
lint-error count), declared under `[ratchets]` and held against `main`. It reads
a number from a measurement Slot that prints `ICCULUS_METRIC <name> <number>`.
Ratchets are slow, so they run on demand via `agent ratchets`, not as part of
`finish` ([ADR 0003](../_adr/0003-named-metric-ratchets.md)).

### Evidence

An optional gate requiring each branch to record work evidence (a screenshot, a
note) before `finish` passes. Off by default; enabled with `[evidence]`.

---

## The worktree workflow

Terms for the isolated-worktree workflow. Covered in depth under
[`../30-worktrees/`](../30-worktrees/).

### Worktree

A throwaway, isolated `git worktree` (and its branch) for a single change, so an
agent never works directly in the main checkout. Each gets a deterministic
dev-server port and its own database, so concurrent worktrees never collide.

### Adapter

A stack-specific seam the worktree workflow calls but does not implement: the
**database** adapter (clone/drop a per-worktree database) and the **dev-server**
adapter (link/unlink a per-worktree site). Both are empty config in
`icculus.toml` until a project wires them, so a worktree round is a clean no-op
until then ([ADR 0007](../_adr/0007-adapter-contract.md)).

### Graduate

What `agent worktree:exit` does: integrate the worktree's branch into the main
repo and tear the worktree down (database and dev-server link removed, directory
pruned). Requires the branch to already carry `main`.

---

## Agent guidance

Terms for the author-once → compile-everywhere instruction pipeline. Covered in
depth under [`../40-agent-guidance/`](../40-agent-guidance/).

### Guidance source

`.ai/guidelines/<slug>.md` — the single, hand-edited [seed](#seed-file) file
holding the project's agent instructions. The one place guidance is authored.

### Compiled agent file

`CLAUDE.md`, `AGENTS.md`, and the like — per-agent instruction files
[generated](#generated-file) from the Guidance source by `agent guidelines`,
each carrying a do-not-edit banner. Which files are emitted is set by
`[project].agents` (`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

### Skill

A bundled agent capability shipped under `.ai/skills/<name>/SKILL.md` (e.g.
`bootstrap`, `document-subsystem`, `write-adr`) and made discoverable through
`.claude/skills/` symlinks. All shipped Skills are [managed](#managed-file).

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
