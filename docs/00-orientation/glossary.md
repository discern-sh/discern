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

The whole tool: a single self-contained binary that is both the **Installer**
and the **Engine**. icculus scaffolds a stack-neutral agentic-development
harness into any repository, in one command, and keeps it upgradable thereafter.
The name (and `.icculus/`) is a working placeholder pending a final one.

### Installer

The scaffolding face of the `icculus` binary — `icculus init`, `upgrade`,
`doctor`, `migrate`, `config`, `add-preset`. Its TypeScript lives under
[`src/`](../../src/) and compiles into the single-file binary. It writes and
refreshes a project's files; it is build-time work only — an installed project
never needs Deno, and the Installer is never a runtime dependency of it.

### Harness

What an install _gives a project_: the `icculus` verbs it can run, a
`.icculus/config.toml` config, the bundled [Skills](#skill), and the compiled
guidance. The logic — the [Engine](#engine) — is in the binary, not installed
into the project; on disk an install carries only its config, its
[Skills](#skill), its [Recipes](#recipe), and generated files. The seed and
Skill files an install starts from originate under
[`templates/`](../../templates/) and are **bundled into the binary**, which
writes them out at `init`/`upgrade`. (The docs tree and `TODO.md` are not part
of the install; they are written on demand after install by the bundled Skills.)

### Engine

The stack-neutral logic behind the `icculus` run-time verbs (`finish`, `tidy`,
`worktree`/`worktree:*`, `ratchets`, `guidelines`, `changed-scopes`, …), written
in **TypeScript and compiled into the binary** under
[`src/engine/`](../../src/engine/) (sharing [`src/shared/`](../../src/shared/)
with the Installer). The Engine knows nothing stack-specific — it runs the
[Capabilities](#capability), [Checks](#check), [Scopes](#scope), and
[worktree settings](#worktree-settings) a project declares in
`.icculus/config.toml`. It is the limit case of
[the binary's](#the-binarys-files) files: not installed into a project at all.

### Dispatcher

The verb-routing front of the `icculus` binary
([`src/engine/dispatch.ts`](../../src/engine/dispatch.ts)). It finds the project
root (the nearest ancestor with a `.icculus/config.toml`), routes a known verb
to its built-in handler, and on an _unknown_ verb execs a matching project
[Recipe](#recipe) with the `ICCULUS_*` environment exported. A built-in verb
wins over a same-named recipe (warning on the shadow).

### Recipe

A project's **own** `icculus` verb — a language-agnostic executable under
`.icculus/recipes/`. The binary execs it on an unknown verb, with `ICCULUS_*`
exported; a name with a colon maps to a hyphenated file (`some:verb` →
`some-verb`). A recipe reads config through the
`icculus config get|array|has|
subsections|keys` surface and worktree identity
through `icculus worktree-name --db|--site|--port` — it does **not** source a
shell library. On a name collision with a built-in verb the binary wins
([ADR 0001](../_adr/0001-project-owned-recipes.md)).

---

## The installer & upgrades

Terms for how an install is created, kept current, and migrated. Covered in
depth under [`../10-installer/`](../10-installer/).

### Binary version

The `icculus` binary's semantic version (e.g. `1.0.0`), declared once in
`deno.json` and read everywhere through
[`version.ts`](../../src/lib/version.ts). Shown by `--version`. Getting a newer
binary (via `install.sh`/`brew`/a future `self-update`) is a separate axis from
`icculus upgrade`, which brings a _project_ into line with the binary it is run
from.

### Schema version

A plain monotonic integer — the anchor the [Migration](#migration) chain steps
from, stamped into `[meta].schema_version` in `.icculus/config.toml`. It bumps
**only** when an installed project needs a migration to stay correct, so most
releases leave it untouched. The current shape is schema **5**.

### Migration

One **idempotent** step that brings an install from Schema version `N` to `N+1`.
`upgrade` reads `[meta].schema_version` from `.icculus/config.toml`, runs every
pending step in order up to the binary's, then re-stamps it. A step can edit
`.icculus/config.toml` comment-preserving, move/rewrite files, and deep-merge
settings ([ADR 0014](../_adr/0014-versioned-migration-system.md)).

### Preset

A reusable overlay applied with `icculus add-preset <name>`: a `presets/<name>/`
directory whose files are scaffolded onto a project (with the same yours-vs-the-
binary's rules as `init`) plus an optional `preset.json` at its root — an
icculus config document whose `capabilities` / `checks` / `scopes` / `ratchets`
are written into `.icculus/config.toml`. Supersedes the former "adapter"
overlay; the binary bundles none
([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

---

## File dispositions

Every path an install touches has a **disposition** — how `icculus` treats it on
`upgrade`, and where it is edited. Ownership is **two buckets**:
[yours](#your-files--yours) (committed seeds, write-once) and
[the binary's](#the-binarys-files) (gitignored, re-published artifacts). The
[Merged](#merged-file) seeds and [Generated](#generated-file) artifacts are
named refinements within them. The full surface is mapped in
[install-surface.md](../80-development/install-surface.md).

### Your files / Yours

A file written once — then owned by the project, **committed**, never refreshed
or flagged by `upgrade`, and edited in place. These are the seeds `init` lays
down: `.icculus/config.toml`, the project guidelines, the project brief, the
`.icculus/recipes/` README, plus the [Merged](#merged-file)
`.claude/settings.json` and `.gitignore`. Others are created on demand after
install by the bundled Skills (the `docs/` tree and `TODO.md`, written by
`/bootstrap`).

### The binary's files

A **gitignored** artifact the binary re-publishes on every `upgrade`, always
safe to overwrite because the binary owns it — the opposite of
[yours](#your-files--yours). The bundled [Skills](#skill) (materialized into
`.icculus/skills/`), the `.claude/skills/` symlinks, and the compiled
`CLAUDE.md`/`AGENTS.md` are all the binary's. The [Engine](#engine) is the limit
case: the binary's, but not on disk in a project at all. (This bucket replaces
the retired notion of a "managed file" — there are no content hashes, no `.new`
preservation, and no drift detection, because nothing here is committed.)

### Merged file

A [yours](#your-files--yours) seed folded into whatever the project already has
rather than written whole, so an existing project keeps its own content. It is
produced only at `init` and left untouched by `upgrade`, in one of two forms: a
structured merge (`.claude/settings.json`) or an idempotent append
(`.gitignore`).

### Generated file

One of [the binary's](#the-binarys-files) files produced by an `icculus` command
rather than copied from a template, and reproduced by re-running that command
rather than edited directly. `icculus guidelines` compiles `CLAUDE.md`,
`AGENTS.md`, and the `.claude/skills/` symlinks; `init`/`upgrade` materialize
the `.icculus/skills/` tree.

---

## The quality gate

Terms for `icculus finish` and what it runs. Covered in depth under
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

Whether a project's gate is meaningfully wired, reported by `icculus doctor`.
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

`icculus finish` — the compound quality gate: the Capability and Check
[Stages](#stage) in order (`fix ∥ build`, then `check ∥ test`), then any
[Scope](#scope) `gate`s that fired, then (in a worktree) the main-merged check.
Each Capability and Check runs as its own labelled job, so a failure is
attributed to the precise one. `icculus tidy` is the fast inner loop — the
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
`icculus ratchets`, not as part of `finish`
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

What `icculus worktree:exit` does: integrate the worktree's branch into the main
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
[generated](#generated-file) from the Guidance source by `icculus guidelines`,
each carrying a do-not-edit banner. Which files are emitted is set by
`[project].agents` (`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

### Skill

A bundled agent capability shipped under `.icculus/skills/<name>/SKILL.md` (e.g.
`bootstrap`, `document-subsystem`, `write-adr`). `init`/`upgrade` materialize
the bundled Skills into `.icculus/skills/` (gitignored) and symlink them into
`.claude/skills/`. All shipped Skills are [the binary's](#the-binarys-files):
overwritten on every `upgrade`, though a user's own real (non-symlink)
`.claude/skills/<name>` is left alone.

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
