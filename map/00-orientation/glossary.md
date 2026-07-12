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
and the **Engine**. discern scaffolds a stack-neutral agentic-development system
into any repository, in one command, and keeps it upgradable thereafter.

### Installer

The scaffolding face of the `discern` binary — `discern setup`, `doctor`,
`config`, `preset`. Its TypeScript lives under [`src/`](../../src/) and compiles
into the single-file binary. It writes and refreshes a project's files; it is
build-time work only — an installed project never needs Deno, and the Installer
is never a runtime dependency of it.

### Discern install

What setup gives a project: the `discern` verbs it can run, a `discern.toml`
config, the bundled [Skills](#skill), and the compiled guidance. The logic — the
[Engine](#engine) — is in the binary, not installed into the project. On disk
the default authored footprint is `discern.toml`, the root [Map](#map), and
[the Namespace](#namespace), alongside gitignored generated files. The write
boundary is enforced by test
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md))
and every source can be config-pointed elsewhere (your
[Guidance source](#guidance-source), [Skills](#skill), [Recipes](#recipe),
[the Map](#map), the ledger). The seed and Skill files an install starts from
originate under [`templates/`](../../templates/) and are **bundled into the
binary**, which writes them out at `setup`.

### Namespace

The visible `discern/` directory — the default home for the
[Guidance source](#guidance-source), authored [Skills](#skill),
[Recipes](#recipe), the project brief, and the `TODO.md` deferred-work ledger.
The [Map](#map) defaults separately to root `map/`. Content you author for
audiences of your own never defaults into discern's paths. The Namespace is 100%
yours — no generated or gitignored artifact is ever written inside it — and
every source in it keeps a config key that points it anywhere
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md),
[ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)).

### Map

The documentation tree discern maintains at `[map].dir` (default `map/`): an
**agent-first** account of the codebase — inferred by agents, written by agents,
read by agents first and by humans as an audit of what their agents actually
understand. Its structure, format, and upkeep are discern's to prescribe;
staleness is a defect the gate catches. It is deliberately **not** the project's
own documentation, which discern never touches; pointing `[map].dir` at existing
docs is deliberate consent to apply the map discipline there. This repo uses the
root `map/` default. `setup begin` scaffolds it eagerly and the setup authoring
pass fills it — a blank map is worse than none
([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)).

### Engine

The stack-neutral logic behind the `discern` run-time verbs (`done`, `prepare`,
`improvement`, `status`, the `worktree` command group, `update`, `accept`,
`standards`, `refresh`, `impact`, `coupling`, …), written in **TypeScript and
compiled into the binary** under [`src/engine/`](../../src/engine/) (sharing
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
wins over a same-named recipe (warning on the shadow).

### Recipe

A project's **own** `discern` verb — a language-agnostic executable under
`[recipes].dir` (default `discern/recipes`). The binary execs it on an unknown
verb, with `DISCERN_*` exported; a name with a colon maps to a hyphenated file
(`some:verb` → `some-verb`). A recipe reads config through the
`discern config get|array|has|subsections|keys` surface and worktree identity
through `discern identity --db|--site|--port|--resource <name>` — it does
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
binary (by re-running the install script) is a separate axis from
`discern upgrade`, which brings a _project_ into line with the binary it is run
from.

### Schema version

A plain monotonic integer — the anchor the [Migration](#migration) chain steps
from, stamped into `[meta].schema_version` in `discern.toml`. It bumps **only**
when an installed project needs a migration to stay correct, so most releases
leave it untouched. The current shape is schema **19** — `17 → 18` renames the
quality-number table to `[standards]`, and `18 → 19` renames the
agent-maintained documentation table to `[map]` while preserving every existing
install's directory.

### Migration

One **idempotent** step that brings an install from Schema version `N` to `N+1`.
`upgrade` reads `[meta].schema_version` (from `discern.toml`, or a legacy
`.discern/config.toml` for a pre-6 install), runs every pending step in order up
to the binary's, validates the migrated config, then re-stamps it. If the
project records a newer schema than the binary supports and `upgrade` refuses
and point the user at reinstalling discern instead of stamping the config down.
A step can edit the config comment-preserving, move/rewrite files, and
deep-merge settings — the `5 → 6` step moves the config to the root, relocates
guidance/recipes/authored skills out of `.discern/`, prunes the pristine bundled
skills, and deletes `.discern/`
([ADR 0014](../_adr/0014-versioned-migration-system.md),
[ADR 0020](../_adr/0020-dissolve-discern-dir.md),
[ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)).

### Preset

A reusable overlay applied with `discern preset <name>`: a `presets/<name>/`
directory whose files are scaffolded onto a project (with the same yours-vs-the-
binary's rules as `setup`) plus an optional `preset.json` at its root — an
discern config document whose `capabilities` / `checks` / `scopes` / `standards`
are written into `discern.toml`. Fills are fill-if-absent: a value the project
already sets is the user's and stands, and every key is disclosed as filled or
kept ([ADR 0118](../_adr/0118-preset-fills-never-overwrite.md)). Supersedes the
former "adapter" overlay; the binary bundles none
([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

---

## File dispositions

Every path an install touches has a **disposition** — how `discern` treats it on
`upgrade`, and where it is edited. Ownership is **three buckets**:
[yours](#your-files--yours) (committed seeds, write-once),
[co-managed seed](#co-managed-seed) (`discern.toml`'s fixed scaffold and the
discern block in `.gitignore`), and [the binary's](#the-binarys-files)
(gitignored, re-published artifacts). The [Merged](#merged-file) seeds and
[Generated](#generated-file) artifacts are named refinements within them. The
full surface is mapped in
[install-surface.md](../80-development/install-surface.md).

### Your files / Yours

A file written once — then owned by the project, **committed**, never refreshed
or flagged by `upgrade`, and edited in place. `setup` may seed the project brief
(`discern/brief.md`) when non-empty, plus the [Merged](#merged-file) provider
settings and the project-owned rules outside the [co-managed](#co-managed-seed)
`.gitignore` block. The rest live in the [Namespace](#namespace) by default and
anywhere you point their keys: your [Guidance source](#guidance-source),
authored [Skills](#skill) under `[skills].dir`, [Recipes](#recipe) under
`[recipes].dir`, and the two `discern setup begin` scaffolds and the setup
authoring pass fills — [the Map](#map) under `[map].dir` and the deferred-work
ledger at `[project].todo`.

### Placement is consent

The rule that decides what discern (and the agents it briefs) may write
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
A file at its [Namespace](#namespace) default carries an **implicit**
write-license: agents maintain it freely, and staleness is a defect. A config
key pointed at a path outside the Namespace is an **explicit** write-license:
the user typed the path, and that typing is the consent. A path that is neither
is untouchable — by construction, not by warning: the write-surface contract is
an architectural test
([`tests/paths_write_surface_test.ts`](../../tests/paths_write_surface_test.ts)),
so a write anywhere else fails the gate.

### Co-managed seed

`discern.toml`, the single root config file, and the discern-owned block inside
`.gitignore`. The project owns config values and named record tables
(`[checks.<name>]`, `[scopes.<name>]`, `[standards.<name>]`,
`[worktree.resources.<name>]`), but `discern upgrade` owns the fixed scaffold:
it runs versioned migrations and restores missing non-record sections/keys from
the current template, with comments and canonical placement. Existing values are
never rewritten by scaffold reconciliation
([ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)).

For `.gitignore`, the project owns everything outside the `# --- discern ---` /
`# --- /discern ---` block. `upgrade` reconciles only that block to the current
fragment and absorbs known legacy discern-owned fragments
([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md)).

### The binary's files

A **gitignored** artifact the binary re-publishes on every `upgrade`, always
safe to overwrite because the binary owns it — the opposite of
[yours](#your-files--yours). The materialized [Skills](#skill) under
`.claude/skills/` and `.agents/skills/` (built-ins rendered, authored ones
symlinked) and the compiled agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are
all the binary's [Generated](#generated-file) artifacts
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)). The
[Engine](#engine), the built-in guidance, and the built-in Skill sources are the
limit case: the binary's, but **bundled** inside it, not on disk in a project at
all. (This bucket replaces the retired notion of a "managed file" — there are no
content hashes, no `.new` preservation, and no drift detection, because nothing
here is committed at all; drift between a generated file and its source is
caught by `discern done`'s currency check instead.)

### Merged file

A [yours](#your-files--yours) seed folded into whatever the project already has
rather than written whole, so an existing project keeps its own content. It is
produced only at `setup` and left untouched by `upgrade`: the structured merge
of each configured agent's settings file (`.claude/settings.json` and its peers,
routed through the provider registry). `.gitignore` used to be described as a
merged file; its project-owned rules are still preserved, but the discern block
is now a [co-managed seed](#co-managed-seed).

### Generated file

A file produced by a `discern` command rather than copied from a template, and
reproduced by re-running that command rather than edited directly.
`discern
refresh` compiles the agent files (`CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`) and materializes the configured agents' skills dirs. They are all
[the binary's](#the-binarys-files) gitignored build artifacts; the reviewable,
tracked form is your `[guidance].sources`, and `discern done` flags a generated
file that has drifted from its source (ADR 0034).

---

## The quality gate

Terms for `discern done` and what it runs. Covered in depth under
[`../20-quality-gate/`](../20-quality-gate/).

### Capability

A configured project command for one known kind of work. Capabilities form a
small, **closed** vocabulary declared flat under `[capabilities]` in
`discern.toml`: `format`, `build`, `lint`, `typecheck`, `test`, and `smoke` (a
fast "does it boot?" check —
[ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)). Each is a name
mapped to a command (or a list run in order); the Engine **derives the gate
[Stage](#stage)** from the name, so an author never writes a scheduling keyword.
The set is closed — an unknown key is an error that points at a [Check](#check).
A known capability that is simply **omitted** is [knowably absent](#readiness):
the gate skips it, never errors
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
enumerate which of the six are filled and which are knowably absent, and judge
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

The project's full quality check, run with `discern done`. In a worktree it
checks that the branch contains the latest trunk first, then runs the Capability
and Check [Stages](#stage) in order (`fix ∥ build`, then `check ∥ test`), then
any [Scope](#scope) `gate`s that fired. Each Capability and Check runs as its
own labelled job, so a failure is attributed to the precise one.
`discern prepare` is the fast inner loop — the fix-stage then check-stage work,
no build or test.

### Scope

A named region of the repository a change can touch, declared as a
`[scopes.<name>]` table: `paths` (the defining globs) plus optional `neutral` /
`previewable` booleans and a `gate` command run only when that Scope changed —
it skips irrelevant work and fires a sub-component's own gate. Classification
**fails open**: a path matching no Scope counts as a real code change, so it
runs more gates, never fewer
([ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

### Standard

Standards are _numbers that can never get worse_: never-loosen floors or
ceilings such as line coverage, a size budget, or a lint-error count. A Standard
is declared under `[standards]` and held against the [Trunk](#trunk). It
**inlines its own `run`**, the command that prints
`DISCERN_METRIC <metric> <number>`. Standards are slow, so they run on demand
via `discern standards`, not as part of `done`
([ADR 0003](../_adr/0003-named-metric-standards.md),
[ADR 0018](../_adr/0018-vocabulary-consolidation.md)).

### Co-change advisory

What `discern coupling` produces: from git history, the files that change
**together**, so a change is nudged toward the sibling it is likely missing. It
is purely **advisory** — surfaced through `hints[]`, it points at where to look
and **never blocks**, reporting evidence in plain counts ("B changed in N of the
M recent commits that touched A"). It is **zero-config**: it self-calibrates to
the repo (a sweeping commit is fenced out by the repo's own commit-size
distribution; a pair is kept only when their co-occurrence is statistically
significant by a log-likelihood-ratio test), so incidental churn doesn't surface
and there are no thresholds to tune. Available on demand in three modes (the
diff-aware change-set view, a one-file `coupling <path>` query, and a two-file
`coupling <a> <b>` evidence view that lists the commits where both changed) and,
behind `[coupling].in_gate`, at the tail of the [Gate](#gate). It is the
**discovery** end of the canonical-set discipline that the parity tests
**enforce** — the two stay deliberately separate
([ADR 0084](../_adr/0084-co-change-coupling-advisory.md),
[ADR 0051](../_adr/0051-canonical-set-parity.md)). Covered in
[coupling.md](../20-quality-gate/coupling.md).

---

## The worktree workflow

Terms for the isolated-worktree workflow. Covered in depth under
[`../30-worktrees/`](../30-worktrees/).

### Worktree

A separate checkout and branch for one change, created with `git worktree`, so
an agent never works directly in the main checkout. Each gets a deterministic
dev-server port and any per-worktree [resources](#worktree-resource) a project
declares, so concurrent worktrees never collide.

### Trunk

The shared branch accepted work lands on, configured by `[project].main_branch`
and usually named `main`. The main checkout is the long-lived checkout that
holds it; worktrees bring the trunk into their own branches with
`discern update`, then land back on it with `discern accept`.

### Worktree settings

The stack-specific part of the worktree workflow the engine calls but does not
implement: per-worktree **[resources](#worktree-resource)**
(`[worktree.resources.<name>]` with `create`/`destroy`), plus the per-worktree
`inherit_env`, `port`, and `setup` keys. A fresh install declares no resources,
so a worktree round is a clean no-op until a project wires one
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md),
[ADR 0025](../_adr/0025-worktree-resources.md)).

### Worktree resource

An external thing a worktree needs in isolation — a database, an emulator, a
container, a queue — declared as `[worktree.resources.<name>]` with a `create`
command (run once at setup) and a `destroy` (run once at teardown). It is
created once, reused by every later command for the life of the worktree, and
destroyed at teardown; a worktree that vanishes without a clean teardown has its
resources reclaimed by `worktree prune` (the GC safety net). Its
project-namespaced handle is read with `identity --resource <name>` or the
`DISCERN_RESOURCE_<NAME>` env var
([ADR 0025](../_adr/0025-worktree-resources.md)).

### Update

What `discern update` does: bring the latest [Trunk](#trunk) into the current
worktree's branch and re-materialize the generated agent files +
[Skills](#skill), in one deterministic step — the inverse of [Accept](#accept).
A no-op when the branch already contains main. It merges into a clean tree only,
and on a conflict it aborts the merge and reports the conflicting files. The
action the [Gate](#gate)'s fail-fast merge check points a behind branch at
([ADR 0055](../_adr/0055-update-verb.md)).

### Accept

What `discern accept` does: land the worktree's branch on the [Trunk](#trunk)
(whether that is `main`, `master`, …) and tear the worktree down (its resources
destroyed, directory pruned, the now-merged branch deleted). Requires the branch
to already carry the trunk, so the landing is always a clean fast-forward. The
trunk is the one landing target ([ADR 0110](../_adr/0110-the-landing-model.md));
composing on unlanded work happens on the pull side instead (`start --from`,
`update --from`).

---

## Agent guidance

Terms for the author-once → compile-everywhere instruction pipeline. Covered in
depth under [`../40-agent-guidance/`](../40-agent-guidance/).

### Guidance source

The project's own agent instructions ([yours](#your-files--yours)), at the
location(s) named by `[guidance].sources` in `discern.toml` — default
`discern/guidance.md`, globs allowed, read only if present. They are
**additive**: discern's built-in guidance (bundled,
[`templates/guidance/`](../../templates/guidance/)) is always prepended, so your
sources extend it rather than replace it.

### Compiled agent file

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` — per-agent instruction files
[generated](#generated-file) by `discern refresh` from the built-in guidance
sections plus the Guidance source. They carry no banner — they open with the
guidance itself, and drift from their source is caught by `discern status` /
`discern done` ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).
Which files are emitted is set by `[guidance].agents` (`claude_code` →
`CLAUDE.md`, `codex` → `AGENTS.md`, `gemini` → `GEMINI.md`). All are gitignored
build artifacts; `AGENTS.md` is the **canonical** one (it holds the full body
the others import).

### Skill

A focused agent capability shipped as a `SKILL.md`. The effective set is
discern's **bundled** built-ins (in the binary, sourced from
[`templates/skills/`](../../templates/skills/) — all named with the `discern-`
prefix, so their provenance shows wherever they surface) plus any you **author**
under `[skills].dir` (default `discern/skills`), where yours override a built-in
of the same name. `discern refresh` (and `setup`) materialize the set into each
configured agent's skills dir (gitignored, [the binary's](#the-binarys-files)):
built-ins **rendered** through the strict template engine — path tokens become
the configured paths
([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)) — and
authored skills **symlinked** so edits are live. `discern skills list` shows the
set; `discern skills eject <name>` copies a built-in into your dir to customize;
`[skills].exclude` drops named skills from materialization
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
