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
and the rest of the tree reads as variations on them.

### icculus

The whole tool: the **Installer** plus the **Harness** it ships. icculus
scaffolds a stack-neutral agentic-development harness into any repository, in
one command, and keeps it upgradable thereafter. The name (and `agent`,
`.icculus/`) is a working placeholder pending a final one.

### Installer

The Deno/TypeScript CLI — `icculus init`, `upgrade`, `doctor`, `migrate`,
`config`, `add-preset` — that lives under [`src/`](../../src/) and compiles to
single-file binaries in `dist/`. It scaffolds and refreshes an install. It is a
build-time tool only: an installed project never needs Deno, and the Installer
is never a runtime dependency of it.

### Harness

What an install _contains and runs_: the [`agent`](#agent-the-dispatcher)
dispatcher, the [Engine](#engine), the `.icculus/config.toml` config, and the
bundled [Skills](#skill). It is pure POSIX shell plus a TOML config. Every file
in it originates in [`templates/`](../../templates/) — the source of truth —
which the Installer copies, renders, merges, or appends into place. (The docs
tree and `TODO.md` are not part of the install; they are written on demand after
install by the bundled Skills.)

### Engine

The stack-neutral logic of the Harness: the [Recipes](#recipe) and the shared
shell library under [`.icculus/engine/`](../../templates/.icculus/engine/). The
Engine knows nothing stack-specific — it runs the [Capabilities](#capability),
[Checks](#check), [Scopes](#scope), and [worktree settings](#worktree-settings)
a project declares in `.icculus/config.toml`. All Engine files are
[managed](#managed-file).

### `agent` (the dispatcher)

[`agent`](../../templates/agent), the task-runner surface a coding agent or
person drives day to day. It finds the project root (the nearest ancestor with a
`.icculus/config.toml`) and routes `agent <verb>` to the matching
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
untouched. The current shape is schema **4**.

### Manifest

[`.icculus/manifest.json`](#generated-file) — the [generated](#generated-file)
record of an install's Kit version, Schema version, and a content hash of every
[managed file](#managed-file). It is what lets `upgrade` and `selfcheck` tell a
pristine managed file from an edited one, and a current install from a stale
one.

### Migration

One **idempotent** step that brings an install from Schema version `N` to `N+1`.
`upgrade` reads the recorded Schema version, runs every pending step in order up
to the build's, then re-stamps. A step can edit `.icculus/config.toml`
comment-preserving, move/rewrite files, and deep-merge settings
([ADR 0014](../_adr/0014-versioned-migration-system.md)).

### Preset

A reusable overlay applied with `icculus add-preset <name>`: a `presets/<name>/`
directory whose files are scaffolded onto a project (with the same managed/yours
rules as `init`) plus an optional `preset.json` at its root — an icculus config
document whose `capabilities` / `checks` / `scopes` / `ratchets` are written
into `.icculus/config.toml`. Supersedes the former "adapter" overlay; the kit
bundles none ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

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

### Your files / Yours

A file written once — then owned by the project, never refreshed or flagged by
`upgrade`, and edited in place (the opposite of a
[managed file](#managed-file)). Some are laid at `icculus init` from a
`templates/….tmpl` (`.icculus/config.toml`, the project guidelines); others are
created on demand after install by the bundled Skills (the `docs/` tree and
`TODO.md`, written by `/bootstrap`).

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

### Capability

One of a small, **closed** vocabulary of things a project can do, declared flat
under `[capabilities]` in `.icculus/config.toml`: `format`, `build`, `lint`,
`typecheck`, `test`. Each is a name mapped to a command (or a list run in
order); the Engine **derives the gate [Stage](#stage)** from the name, so an
author never writes a scheduling keyword. The set is closed — an unknown key is
an error that points at a [Check](#check). A known capability that is simply
**omitted** is [knowably absent](#readiness): the gate skips it, never errors
([ADR 0017](../_adr/0017-capabilities-model.md)).

### Check

Custom gate work **outside** the known capability vocabulary, declared as
`[checks.<name>]` with an explicit `stage` (the Engine can't derive one from an
unknown name), a `run`, and an optional free-text `provides` label. A Check runs
as its own labelled job in its declared Stage, exactly like a Capability
([ADR 0017](../_adr/0017-capabilities-model.md)).

### Readiness

Whether a project's gate is meaningfully wired, reported by `agent doctor`.
Because the [Capability](#capability) vocabulary is **closed**, the Engine can
enumerate which of the five are filled and which are knowably absent, and judge
whether the install clears a minimal bar (a test plus at least one static
check). An omitted capability is a definite "absent" signal, not an unknown —
the property a closed set makes possible
([ADR 0017](../_adr/0017-capabilities-model.md)).

### Stage

The internal scheduling bucket a [Capability](#capability) or [Check](#check)
runs in — `fix`, `build`, `check`, `test`. For a known capability the Engine
derives it (`format`→fix, `build`→build, `lint`/`typecheck`→check, `test`→test);
for a Check the author states it. The four Stages survive _inside_ the Engine
(the parallel shape `fix → build → check ∥ test` is unchanged), but "phase" is
no longer a user-facing word.

### Gate

`agent finish` — the compound quality gate: the Capability and Check
[Stages](#stage) in order (`fix ∥ build`, then `check ∥ test`), then any
[Scope](#scope) `gate`s that fired, then (in a worktree) the main-merged check.
Each Capability and Check runs as its own labelled job, so a failure is
attributed to the precise one. `agent tidy` is the fast inner loop — the
fix-stage then check-stage work, no build or test.

### Scope

A named region of the repo a change can touch, declared as a `[scopes.<name>]`
table: `paths` (the defining globs) plus optional `neutral` / `previewable`
booleans and a `gate` command (the former "side gate") run only when that Scope
changed. Used to skip irrelevant work and to fire a sub-component's own gate.
Classification **fails open**: a path matching no Scope counts as a real code
change, so it runs more gates, never fewer
([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

### Ratchet

A never-loosen quality floor or ceiling (line coverage, a size budget, a
lint-error count), declared under `[ratchets]` and held against `main`. It
**inlines its own `run`**, the command that prints
`ICCULUS_METRIC <metric>
<number>`. Ratchets are slow, so they run on demand via
`agent ratchets`, not as part of `finish`
([ADR 0003](../_adr/0003-named-metric-ratchets.md),
[ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

---

## The worktree workflow

Terms for the isolated-worktree workflow. Covered in depth under
[`../30-worktrees/`](../30-worktrees/).

### Worktree

A throwaway, isolated `git worktree` (and its branch) for a single change, so an
agent never works directly in the main checkout. Each gets a deterministic
dev-server port and its own database, so concurrent worktrees never collide.

### Worktree settings

The stack-specific seams the worktree workflow calls but does not implement: the
**database** seam (clone/drop a per-worktree database), the **dev-server** seam
(link/unlink a per-worktree site), plus the per-worktree `inherit_env`, `port`,
and `setup` keys. All are empty/default config in `.icculus/config.toml` until a
project wires them, so a worktree round is a clean no-op until then
([ADR 0007](../_adr/0007-adapter-contract.md),
[ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

### Graduate

What `agent worktree:exit` does: integrate the worktree's branch into the main
repo and tear the worktree down (database and dev-server link removed, directory
pruned). Requires the branch to already carry `main`.

---

## Agent guidance

Terms for the author-once → compile-everywhere instruction pipeline. Covered in
depth under [`../40-agent-guidance/`](../40-agent-guidance/).

### Guidance source

`.icculus/guidelines/<slug>.md` — the single, hand-edited file
([yours](#your-files--yours)) holding the project's agent instructions. The one
place guidance is authored.

### Compiled agent file

`CLAUDE.md`, `AGENTS.md`, and the like — per-agent instruction files
[generated](#generated-file) from the Guidance source by `agent guidelines`,
each carrying a do-not-edit banner. Which files are emitted is set by
`[project].agents` (`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

### Skill

A bundled agent capability shipped under `.icculus/skills/<name>/SKILL.md` (e.g.
`bootstrap`, `document-subsystem`, `write-adr`) and made discoverable through
`.claude/skills/` symlinks. All shipped Skills are [managed](#managed-file).

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
