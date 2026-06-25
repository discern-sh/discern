# Glossary

Every discern-specific term, defined precisely. This is the canonical
dictionary: the names defined here are used verbatim across the whole
documentation tree, and synonyms are not introduced. The few nouns the whole
system is built on come first, because they show up everywhere else.

For a narrative tour of how these terms relate, read [concepts.md](concepts.md).
For the architectural shape, see [system-map.md](system-map.md).

---

## Core nouns

The handful of building blocks the rest of the system rests on. Understand these
and the rest of the tree reads as variations on them.

### discern

The whole tool: a single self-contained binary that is both the **Installer**
and the **Engine**. discern scaffolds a stack-neutral agentic-development
harness into any repository, in one command, and keeps it upgradable thereafter.

### Installer

The scaffolding face of the `discern` binary — `discern setup`, `upgrade`,
`doctor`, `migrate`, `config`, `add-preset`. Its TypeScript lives under
[`src/`](../../src/) and compiles into the single-file binary. It writes and
refreshes a project's files; it is build-time work only — an installed project
never needs Deno, and the Installer is never a runtime dependency of it.

### Harness

What an install _gives a project_: the `discern` verbs it can run, an
`discern.toml` config, the bundled [Skills](#skill), and the compiled guidance.
The logic — the [Engine](#engine) — is in the binary, not installed into the
project; on disk the entire discern footprint is **one root file,
`discern.toml`** ([ADR 0020](../_adr/0020-dissolve-discern-dir.md)), alongside
any config-pointed content you author (your [Guidance source](#guidance-source),
[Skills](#skill), [Recipes](#recipe)) and the generated files. The seed and
Skill files an install starts from originate under
[`templates/`](../../templates/) and are **bundled into the binary**, which
writes them out at `setup`/`upgrade`. (The docs tree and `TODO.md` are not part
of the install; they are written on demand after install by the bundled Skills.)

### Engine

The stack-neutral logic behind the `discern` run-time verbs (`finish`,
`prepare`, `audit`, `status`, `worktree`/`worktree:*`, `graduate`, `ratchets`,
`refresh`, `changed-scopes`, …), written in **TypeScript and compiled into the
binary** under [`src/engine/`](../../src/engine/) (sharing
[`src/shared/`](../../src/shared/) with the Installer). The Engine knows nothing
stack-specific — it runs the [Capabilities](#capability), [Checks](#check),
[Scopes](#scope), and [worktree settings](#worktree-settings) a project declares
in `discern.toml`. It is the limit case of [the binary's](#the-binarys-files)
files: not installed into a project at all.

### Dispatcher

The verb-routing front of the `discern` binary
([`src/engine/dispatch.ts`](../../src/engine/dispatch.ts)). It finds the project
root (the nearest ancestor with a `discern.toml`), routes a known verb to its
built-in handler, and on an _unknown_ verb execs a matching project
[Recipe](#recipe) with the `DISCERN_*` environment exported. A built-in verb
wins over a same-named recipe (warning on the shadow); a verb whose
[Feature](#feature) is disabled reports "feature disabled" rather than falling
through.

### Recipe

A project's **own** `discern` verb — a language-agnostic executable under
`[recipes].dir` (default `./recipes`). The binary execs it on an unknown verb,
with `DISCERN_*` exported; a name with a colon maps to a hyphenated file
(`some:verb` → `some-verb`). A recipe reads config through the
`discern config get|array|has|
subsections|keys` surface and worktree identity
through `discern worktree-name --db|--site|--port|--resource <name>` — it does
**not** source a shell library. On a name collision with a built-in verb the
binary wins ([ADR 0001](../_adr/0001-project-owned-recipes.md)).

---

## The installer & upgrades

Terms for how an install is created, kept current, and migrated. Covered in
depth under [`../10-installer/`](../10-installer/).

### Binary version

The `discern` binary's semantic version (e.g. `1.0.0`), declared once in
`deno.json` and read everywhere through
[`version.ts`](../../src/lib/version.ts). Shown by `--version`. Getting a newer
binary (via `install.sh`/`brew`/a future `self-update`) is a separate axis from
`discern upgrade`, which brings a _project_ into line with the binary it is run
from.

### Schema version

A plain monotonic integer — the anchor the [Migration](#migration) chain steps
from, stamped into `[meta].schema_version` in `discern.toml`. It bumps **only**
when an installed project needs a migration to stay correct, so most releases
leave it untouched. The current shape is schema **9** — the `8 → 9` step
untracks the generated `AGENTS.md`, adding `/AGENTS.md` to `.gitignore` so it
joins the other compiled mirrors as a build artifact
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

### Migration

One **idempotent** step that brings an install from Schema version `N` to `N+1`.
`upgrade` reads `[meta].schema_version` (from `discern.toml`, or a legacy
`.discern/config.toml` for a pre-6 install), runs every pending step in order up
to the binary's, then re-stamps it. A step can edit the config
comment-preserving, move/rewrite files, and deep-merge settings — the `5 → 6`
step moves the config to the root, relocates guidance/recipes/authored skills
out of `.discern/`, prunes the pristine bundled skills, and deletes `.discern/`
([ADR 0014](../_adr/0014-versioned-migration-system.md),
[ADR 0020](../_adr/0020-dissolve-discern-dir.md)).

### Preset

A reusable overlay applied with `discern add-preset <name>`: a `presets/<name>/`
directory whose files are scaffolded onto a project (with the same yours-vs-the-
binary's rules as `setup`) plus an optional `preset.json` at its root — an
discern config document whose `capabilities` / `checks` / `scopes` / `ratchets`
are written into `discern.toml`. Supersedes the former "adapter" overlay; the
binary bundles none ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

---

## File dispositions

Every path an install touches has a **disposition** — how `discern` treats it on
`upgrade`, and where it is edited. Ownership is **two buckets**:
[yours](#your-files--yours) (committed seeds, write-once) and
[the binary's](#the-binarys-files) (gitignored, re-published artifacts). The
[Merged](#merged-file) seeds and [Generated](#generated-file) artifacts are
named refinements within them. The full surface is mapped in
[install-surface.md](../80-development/install-surface.md).

### Your files / Yours

A file written once — then owned by the project, **committed**, never refreshed
or flagged by `upgrade`, and edited in place. The one seed `setup` always lays
down is `discern.toml` (the entire discern footprint); it also seeds the project
`brief.md` when non-empty, plus the [Merged](#merged-file)
`.claude/settings.json` and `.gitignore`. The rest are content you author at
config-pointed locations (your [Guidance source](#guidance-source)
`guidance.md`, authored [Skills](#skill) under `[skills].dir`,
[Recipes](#recipe) under `[recipes].dir`) or are created on demand after install
by `discern setup` (the `docs/` tree and `TODO.md`).

### The binary's files

A **gitignored** artifact the binary re-publishes on every `upgrade`, always
safe to overwrite because the binary owns it — the opposite of
[yours](#your-files--yours). The materialized [Skills](#skill) under
`.claude/skills/` (built-ins copied, authored ones symlinked) and the compiled
agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are all the binary's
[Generated](#generated-file) artifacts
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)). The
[Engine](#engine), the built-in guidance, and the built-in Skill sources are the
limit case: the binary's, but **bundled** inside it, not on disk in a project at
all. (This bucket replaces the retired notion of a "managed file" — there are no
content hashes, no `.new` preservation, and no drift detection, because nothing
here is committed at all; drift between a generated file and its source is
caught by `discern finish`'s currency check instead.)

### Merged file

A [yours](#your-files--yours) seed folded into whatever the project already has
rather than written whole, so an existing project keeps its own content. It is
produced only at `setup` and left untouched by `upgrade`, in one of two forms: a
structured merge (`.claude/settings.json`) or an idempotent append
(`.gitignore`).

### Generated file

A file produced by a `discern` command rather than copied from a template, and
reproduced by re-running that command rather than edited directly.
`discern
refresh` compiles the agent files (`CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`) and materializes `.claude/skills/`. They are all
[the binary's](#the-binarys-files) gitignored build artifacts; the reviewable,
tracked form is your `[guidance].sources`, and `discern finish` flags a
generated file that has drifted from its source (ADR 0034).

---

## The quality gate

Terms for `discern finish` and what it runs. Covered in depth under
[`../20-quality-gate/`](../20-quality-gate/).

### Feature

One of the toggleable subsystems listed under `[features]` in `discern.toml` —
`worktrees`, `ratchets`, `guidance`, `skills`, `docs` — each defaulting **on**.
Setting one to `false` removes it coherently: its verbs hide from `--help` (and
error if invoked), its hooks are left out of `settings.json`, its guidance
section is dropped, and its [`doctor`](#installer) checks skip. A Feature is
**distinct from a [Capability](#capability)**: `[features]` toggles whole
subsystems, `[capabilities]` is the gate's command table. The gate, `config`,
and `doctor` are core and not listed
([ADR 0020](../_adr/0020-dissolve-discern-dir.md),
[`features.ts`](../../src/shared/features.ts)).

### Capability

One of a small, **closed** vocabulary of things a project can do, declared flat
under `[capabilities]` in `discern.toml`: `format`, `build`, `lint`,
`typecheck`, `test`. Each is a name mapped to a command (or a list run in
order); the Engine **derives the gate [Stage](#stage)** from the name, so an
author never writes a scheduling keyword. The set is closed — an unknown key is
an error that points at a [Check](#check). A known capability that is simply
**omitted** is [knowably absent](#readiness): the gate skips it, never errors.
Not to be confused with a [Feature](#feature) (a subsystem toggle)
([ADR 0017](../_adr/0017-capabilities-model.md)).

### Check

Custom gate work **outside** the known capability vocabulary, declared as
`[checks.<name>]` with an explicit `stage` (the Engine can't derive one from an
unknown name), a `run`, and an optional free-text `provides` label. A Check runs
as its own labelled job in its declared Stage, exactly like a Capability
([ADR 0017](../_adr/0017-capabilities-model.md)).

### Readiness

Whether a project's gate is meaningfully wired, reported by `discern doctor`.
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

`discern finish` — the compound quality gate: the Capability and Check
[Stages](#stage) in order (`fix ∥ build`, then `check ∥ test`), then any
[Scope](#scope) `gate`s that fired, then (in a worktree) the main-merged check.
Each Capability and Check runs as its own labelled job, so a failure is
attributed to the precise one. `discern prepare` is the fast inner loop — the
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
`DISCERN_METRIC <metric>
<number>`. Ratchets are slow, so they run on demand via
`discern ratchets`, not as part of `finish`
([ADR 0003](../_adr/0003-named-metric-ratchets.md),
[ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

---

## The worktree workflow

Terms for the isolated-worktree workflow. Covered in depth under
[`../30-worktrees/`](../30-worktrees/).

### Worktree

A throwaway, isolated `git worktree` (and its branch) for a single change, so an
agent never works directly in the main checkout. Each gets a deterministic
dev-server port and any per-worktree [resources](#worktree-resource) a project
declares, so concurrent worktrees never collide.

### Worktree settings

The stack-specific part of the worktree workflow the engine calls but does not
implement: per-worktree **[resources](#worktree-resource)**
(`[worktree.resources.<name>]` with `create`/`destroy`), plus the per-worktree
`inherit_env`, `port`, and `setup` keys. A fresh install declares no resources,
so a worktree round is a clean no-op until a project wires one. The whole
workflow is the `worktrees` [Feature](#feature), inert when it is off
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md),
[ADR 0025](../_adr/0025-worktree-resources.md)).

### Worktree resource

An external thing a worktree needs in isolation — a database, an emulator, a
container, a queue — declared as `[worktree.resources.<name>]` with a `create`
command (run once at setup) and a `destroy` (run once at teardown). It is
created once, reused by every later command for the life of the worktree, and
destroyed at teardown; a worktree that vanishes without a clean teardown has its
resources reclaimed by `worktree:prune` (the GC safety net). Its
project-namespaced handle is read with `worktree-name --resource <name>` or the
`DISCERN_RESOURCE_<NAME>` env var
([ADR 0025](../_adr/0025-worktree-resources.md)).

### Graduate

What `discern graduate` does: integrate the worktree's branch into the main repo
and tear the worktree down (its resources destroyed, directory pruned). Requires
the branch to already carry `main`. The landing is configurable
(`[worktree].graduate_to`, or `--to` per run): `branch` checks the branch out in
the main repo for review (the default); `main` fast-forwards the trunk to the
branch tip and deletes the now-merged branch.

---

## Agent guidance

Terms for the author-once → compile-everywhere instruction pipeline. Covered in
depth under [`../40-agent-guidance/`](../40-agent-guidance/).

### Guidance source

The project's own agent instructions ([yours](#your-files--yours)), at the
location(s) named by `[guidance].sources` in `discern.toml` — default
`guidance.md` at the root, globs allowed, read only if present. They are
**additive**: discern's built-in harness guidance (bundled,
[`templates/guidance/`](../../templates/guidance/)) is always prepended, so your
sources extend it rather than replace it.

### Compiled agent file

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` — per-agent instruction files
[generated](#generated-file) by `discern refresh` from the built-in guidance
(one section per enabled [Feature](#feature)) plus the Guidance source. They
carry no banner — they open with the guidance itself, and drift from their
source is caught by `discern status` / `discern finish`
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)). Which files
are emitted is set by `[guidance].agents` (`claude_code` → `CLAUDE.md`, `codex`
→ `AGENTS.md`, `gemini` → `GEMINI.md`). All are gitignored build artifacts;
`AGENTS.md` is the **canonical** one (it holds the full body the others import).

### Skill

A focused agent capability shipped as a `SKILL.md`. The effective set is
discern's **bundled** built-ins (in the binary,
[`templates/skills/`](../../templates/skills/) — `document-subsystem` and
`write-adr`) plus any you **author** under `[skills].dir` (default `./skills`),
where yours override a built-in of the same name. `discern refresh` (and
`setup`/`upgrade`) materialize the set into `.claude/skills/` (gitignored,
[the binary's](#the-binarys-files)): built-ins **copied**, authored skills
**symlinked** so edits are live. `discern skills
list` shows the set;
`discern skills eject <name>` copies a built-in into your dir to customize. The
`skills` [Feature](#feature) governs the whole subsystem.

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
