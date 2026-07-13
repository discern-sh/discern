# Install surface

_What `discern setup` lays down in a project, and which files are **yours**
(written once, then kept), **co-managed** (discern owns a delimited part), or
**the binary's** (re-published artifacts, always safe to overwrite)._

One `discern setup` scaffolds discern into a project. The committed footprint is
**one root file, `discern.toml`, plus one visible folder, `discern/`** —
enforced by test
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md);
see [the write-surface contract](#the-write-surface-contract)). `discern.toml`
stays at the root as the discovery marker; the `discern/` namespace holds
everything discern asks you to author and everything it maintains for you. The
namespace is 100% yours: no generated artifact is ever written inside it, so no
directory is ever part-tracked, part-generated. The seed files originate in
[`templates/`](../../../templates/) — the source of truth — which the binary
renders, merges, or appends into place; the built-in skills and guidance are
bundled in the binary itself and materialised on disk only as generated output.

This page is the durable map of that surface, grouped by what each part does. It
is deliberately **not** an exhaustive file list. The per-file truth lives in
self-describing sources that never go stale — consult those for the leaves:

> - `discern --help` lists every subcommand.
> - [`discern.toml`](../../../templates/discern.toml.tmpl) documents every
>   config block in its own comments.

## The buckets

Every path in an install is one of three kinds. The bucket decides how the
binary treats it on `upgrade` and where you change it.

| Bucket           | What it is                                                                                                                                                                                             | On `discern upgrade`                                                                                                                                                                                                                | Where you change it                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **yours**        | The `discern/` namespace (guidance, the map, authored skills, project scripts, the ledger, the brief) and the merged provider settings: rendered or merged once at `setup`, then owned by the project. | Untouched.                                                                                                                                                                                                                          | Edit the file in place.                                                                 |
| **co-managed**   | `discern.toml`'s fixed scaffold, plus the delimited discern block in `.gitignore`; project-owned values, record tables, and ignore rules outside the block remain yours.                               | Versioned migrations run; missing fixed config sections/keys are restored (ADR 0092), and the `.gitignore` block is reconciled to the current fragment (ADR 0093). Existing values, named tables, and outside rules are left alone. | Edit project values, named tables, and ignore rules outside the discern block in place. |
| **the binary's** | Gitignored, re-published artifacts: the materialised skills dirs (`.claude/skills/`, `.agents/skills/`) and the compiled agent files. Produced from the bundled sources, always safe to overwrite.     | Re-published — overwritten to match the binary.                                                                                                                                                                                     | Edit the source (in this repo) and re-run the producing command.                        |

A limit case of the binary's bucket is **bundled**: the engine, the built-in
skills ([`templates/skills/`](../../../templates/skills/)), and the built-in
guidance ([`templates/guidance/`](../../../templates/guidance/)) ships _inside_
the binary and are never committed to a project at all
([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The same buckets are
defined in the [glossary](../00-orientation/glossary.md#file-dispositions).

Two seed surfaces are special-cased at `setup` so an existing project keeps what
it already had: each configured agent's settings file by structured merge, and
`.gitignore` by a delimited discern block whose surrounding project rules remain
untouched.

## The write-surface contract

discern writes to a user project **only**:

- the root `discern.toml` (the config writer);
- the configured source paths — by default the `discern/` namespace, resolved
  through the [paths registry](../../../src/shared/paths_registry.ts): the
  guidance seed, the map, authored-skills and project scripts dirs, the ledger,
  the brief;
- the compiled agent files, materialised skills dirs, and provider integration
  files, at the vendor-fixed paths the
  [provider registry](../../../src/lib/providers.ts) declares;
- the delimited block in `.gitignore`;
- a worktree's `.env` (updated in place, never created).

Everything else it records lives inside `.git` (the gate receipt, the
worktree-ready sentinel, the resource ledger, the ignored-file baseline), at a
path the user typed (`docs --output`), or in a temp file — outside the project
tree. **Placement is consent**: a file at its namespace default carries an
implicit write-license; a config key pointed elsewhere is an explicit one; a
path that is neither is untouchable
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

The contract is enforced by
[`tests/paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts),
guard #4 of the leakage battery
([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)): a static
funnel confines every raw write primitive in `src/**` to a sanctioned write-site
module, and a runtime pass scaffolds a project, runs `setup begin` + `refresh` +
`upgrade`, and checks every file written against the contract derived from the
two registries. A write outside the surface fails the gate — which is what makes
the footprint sentence a checkable predicate rather than copy.

## Control surface & configuration

| Path                                                   | Bucket     | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern.toml`](../../../templates/discern.toml.tmpl) | co-managed | The one hand-edited root file. It teaches the generic engine about your stack: capabilities, checks, scopes (with gates), worktree settings, standards, gate ergonomics, and the `[map]`/`[guidance]`/`[skills]`/`[scripts]`/`[project].todo` pointers. Its `[meta].schema_version` is the migration anchor ([ADR 0014](../_adr/0014-versioned-migration-system.md)); its missing fixed scaffold is reconciled from the current template ([ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)). |
| `discern/brief.md`                                     | yours      | An optional project brief — seeded only when one is supplied (`discern setup --brief`/`--config`). When present, the agent reads it to help fill the map and guidance.                                                                                                                                                                                                                                                                                                                                     |

Every source path has a prescriptive default and a config key that points it
anywhere ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)):

| Source               | Default               | Config key           |
| -------------------- | --------------------- | -------------------- |
| guidance source      | `discern/guidance.md` | `[guidance].sources` |
| the map              | `map/`                | `[map].dir`          |
| authored skills      | `discern/skills`      | `[skills].dir`       |
| project scripts      | `discern/scripts`     | `[scripts].dir`      |
| deferred-work ledger | `discern/TODO.md`     | `[project].todo`     |
| project brief        | `discern/brief.md`    | — (fixed)            |

This repo itself points every ongoing configurable authored source beneath
`project/`: the map, guidance, authored skills, project scripts, and ledger. The
registry-driven self-hosting guard makes a future configurable source
auto-enrol, while the shipped defaults in the table above remain unchanged.

## The quality gate

The gate is part of the binary's TypeScript engine
([`src/engine/`](../../../src/engine/)). Its public verbs are first-class
`discern` subcommands:

| Command             | What it does                                                                                                                                              | Source                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `discern done`      | The full gate — (in a worktree) a fail-fast main-merged check first, then `fix`+`build`, then `check`+`test` in parallel, then scope-matched scope gates. | [`src/engine/gate/finish.ts`](../../../src/engine/gate/finish.ts)       |
| `discern prepare`   | The fast inner loop — fixers then read-only checks; no build or test.                                                                                     | [`src/engine/gate/prepare.ts`](../../../src/engine/gate/prepare.ts)     |
| `discern test`      | The `test` capability on its own.                                                                                                                         | [`src/engine/gate/test.ts`](../../../src/engine/gate/test.ts)           |
| `discern standards` | Checks never-loosen metric floors/ceilings against `main` (on demand; not part of `done`).                                                                | [`src/engine/gate/standards.ts`](../../../src/engine/gate/standards.ts) |
| `discern impact`    | Classifies which scopes the branch touches; fails **open** (an unknown path runs more gates, never fewer).                                                | [`src/engine/scopes/scopes.ts`](../../../src/engine/scopes/scopes.ts)   |

Every subsystem is core — there is no `[features]` table and no existence-toggle
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A subsystem that
costs nothing when unused needs no switch: worktrees you never start and
standards you never define are naturally inert, and the one knob left is
`[skills].exclude` (materialised skills occupy agent context even unused).
`[capabilities]` is what it always was: the gate's command table.

Stage scheduling
([`src/engine/gate/stages.ts`](../../../src/engine/gate/stages.ts)), the
failure-pointer wording
([`src/engine/gate/gotchas.ts`](../../../src/engine/gate/gotchas.ts)), and the
parallel/serial job runner
([`src/engine/jobs/runner.ts`](../../../src/engine/jobs/runner.ts), with
process-group tree-kill in
[`src/engine/jobs/command.ts`](../../../src/engine/jobs/command.ts)) back these.
`doctor` ([`src/commands/doctor.ts`](../../../src/commands/doctor.ts))
health-checks the install — config, git, capability/check commands, paths, and a
readiness report.

## The isolated-worktree workflow

The worktree workflow is discern's spine — always wired, with no configuration
attached ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). Generic git
mechanics live in the engine
([`src/engine/worktree/`](../../../src/engine/worktree/)), driven by the hooks
in [Bookkeeping & integration](#bookkeeping--integration). The stack-specific
part is the per-worktree **resources** (`[worktree.resources.<name>]`) a project
declares in `discern.toml`; a fresh install declares none.

| Command                     | What it does                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `discern start`             | Creates + sets up an isolated worktree to begin a change in.                                                 |
| `discern worktree create`   | Creates + sets up a worktree from the `WorktreeCreate` hook's JSON payload (stdin).                          |
| `discern worktree setup`    | Sets up a freshly-created worktree (what `worktree create` runs inside it).                                  |
| `discern worktree ensure`   | Session-start idempotent setup (run by the `SessionStart` hook).                                             |
| `discern accept`            | Accepts the branch into the main repo, tears the worktree down, and refreshes the checkout it leaves behind. |
| `discern worktree remove`   | Tears a worktree down from the `WorktreeRemove` hook's payload (stdin; best-effort).                         |
| `discern worktree teardown` | Destroys a worktree's resources (what `worktree remove` runs).                                               |
| `discern worktree prune`    | Sweeps stale worktrees, fully-merged branches, orphan dirs, and orphan resources.                            |
| `discern identity`          | Resolves a worktree's stable identity (id / site / branch / port / db / resource).                           |

The lifecycle logic lives in
[`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts);
the stable worktree identity (POSIX-`cksum`-faithful) in
[`src/engine/worktree/identity.ts`](../../../src/engine/worktree/identity.ts).
Run `discern --help` for the full verb list.

## Agent instructions (author-once → compile-everywhere)

| Path                                 | Bucket    | What it is                                                                                                                                                                                                                                           |
| ------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern/guidance.md`                | yours     | Your hand-authored guidance source(s) — the default `[guidance].sources`, additive to the built-ins. Globs allowed. Seeded by `discern setup`.                                                                                                       |
| `AGENTS.md`                          | generated | The **canonical** agent file — holds the full compiled body the mirrors import; Cursor and the Copilot CLI read it natively. Committed by default (ADR 0128) so a bare clone carries it; a stale one fails `discern done`'s guidance-currency check. |
| `CLAUDE.md`, `GEMINI.md`             | generated | The committed per-agent mirrors — each a one-line `@AGENTS.md` import (both vendors expand it in place), so neither can drift from the canonical file. No banner — drift is caught by the currency check.                                            |
| `.claude/skills/`, `.agents/skills/` | generated | Materialised skills the configured agents discover — built-ins rendered, authored skills symlinked. Gitignored; stale rendered skills fail the skills currency check, and force-tracked materialized files fail the tracked-artifacts guard.         |

`discern refresh`
([`src/engine/guidelines.ts`](../../../src/engine/guidelines.ts)) regenerates
the generated agent files, skills, and integration artifacts: it compiles each
agent file as **discern's built-in guidance** (always prepended) **plus your
`[guidance].sources`**, and (re)materialises the skills. Which files it writes
is set by `[guidance].agents`, through the provider registry
([`src/lib/providers.ts`](../../../src/lib/providers.ts)) — the per-provider
truth, including each agent's MCP, hooks, and skills wiring, is mapped in
[`../60-agent-integrations/`](../60-agent-integrations/).

## Bundled skills

The bundled skills the coding agent can invoke ship **in the binary** (their
source lives under [`templates/skills/`](../../../templates/skills/), compiled
in via `deno compile --include templates`; the table below is guard-checked
against that set), and a project can add its own under `[skills].dir` (default
`discern/skills`, yours overriding a built-in by name). `discern refresh` (and
`setup`/`upgrade`) materialise the effective set into each configured agent's
skills dir — **generated**, gitignored: built-ins **rendered** through the
strict template engine (path tokens like `{{map_dir}}` become the configured
paths — [ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)),
authored skills **symlinked** so edits are live (see
[`src/lib/skills.ts`](../../../src/lib/skills.ts)). `discern skills list` shows
the set and which of yours override which; `discern skills eject <name>` copies
a built-in into your skills dir so you can customise it; `[skills].exclude`
drops named skills from materialisation. Each is a `SKILL.md` under its own
directory:

| Skill                                                                                             | What it does                                                                                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`discern-shape-the-work`](../../../templates/skills/discern-shape-the-work/SKILL.md)             | Turn a vague ask into a one-page brief: the goal, decisions answered or defaulted visibly, falsifiable criteria.     |
| [`discern-delegate-work`](../../../templates/skills/discern-delegate-work/SKILL.md)               | Shape work into self-contained briefs — one handoff, a fan-out, or stages — then review what lands.                  |
| [`discern-prove-it-works`](../../../templates/skills/discern-prove-it-works/SKILL.md)             | Earn the "done": exercise the real artifact and report an evidence dossier — verified, failed, unverifiable.         |
| [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)     | Write or refresh a subtree of the map per the documenter brief.                                                      |
| [`discern-cure-a-bug`](../../../templates/skills/discern-cure-a-bug/SKILL.md)                     | Cure a whole class of defect — every instance, behind a permanent detector.                                          |
| [`discern-diagnose-a-bug`](../../../templates/skills/discern-diagnose-a-bug/SKILL.md)             | Prove a bug's cause — reproduce, falsify hypotheses — before any fix is written.                                     |
| [`discern-audit-the-suite`](../../../templates/skills/discern-audit-the-suite/SKILL.md)           | Find instance-pinned test clusters and under-scoped guards; close each with a guard off the source of truth.         |
| [`discern-prune-the-overgrowth`](../../../templates/skills/discern-prune-the-overgrowth/SKILL.md) | Sweep out agent-session overgrowth — proven-safe cuts, behaviour-preserving commits, a standard capping the entropy. |
| [`discern-outlaw-a-pattern`](../../../templates/skills/discern-outlaw-a-pattern/SKILL.md)         | Make a legacy pattern illegal: detector, falling standard, permanent gate rule at zero.                              |
| [`discern-standard-a-metric`](../../../templates/skills/discern-standard-a-metric/SKILL.md)       | Put a defendable quality metric behind a never-loosen standard, limit set at today's value.                          |
| [`discern-survey-the-fleet`](../../../templates/skills/discern-survey-the-fleet/SKILL.md)         | Read-only reconnaissance across every worktree: intent, state, collisions, next steps.                               |
| [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md)       | Route a session's lesson into guidance, a skill, a project script, a doc, or an ADR — so future sessions inherit it. |
| [`discern-write-adr`](../../../templates/skills/discern-write-adr/SKILL.md)                       | Record a significant decision as an Architecture Decision Record.                                                    |

(Seeding a fresh install is **not** a skill — it is the `discern setup` command;
see [ADR 0024](../_adr/_superseded/0024-setup-command-not-skill.md), amended by
[ADR 0036](../_adr/0036-unify-setup.md).)

## The map & the ledger

`discern setup begin` lays the map's skeleton at `[map].dir` (default `map/`,
including the ADR pack) and the deferred-work ledger at `[project].todo`
(default `discern/TODO.md`), and the setup brief's authoring pass fills them —
the map is eager, and never left empty
([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)). The documenter
brief and scope-manifest template land lazily, on the
[`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)
skill's first use. The skeleton sources ship with whatever creates them —
[`templates/setup/skeleton/`](../../../templates/setup/skeleton/) for setup, a
`skeleton/` dir inside each carrying skill — and are copied to the
**configured** destinations, with path tokens rendered
([ADR 0080](../_adr/0080-configured-agent-map-root.md),
[ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)).

## Bookkeeping & integration

| Path                                                                     | Bucket           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern/TODO.md` (`[project].todo`)                                     | yours            | The deferred-work ledger — the running TODO list agents read and maintain in discern's workflow (not the team's backlog); documents its own format.                                                                                                                                                                                                                                                                             |
| `discern/scripts` (`[scripts].dir`)                                      | yours            | Your executable project scripts (read only if present), listed with `discern script` and run with `discern script <name>`. Built-in names are legal inside the namespace ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)). Scripts read config through `discern config get`, not by sourcing a shell library.                                                                                        |
| [`.claude/settings.json`](../../../templates/.claude/settings.json.tmpl) | co-managed merge | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `discern worktree ensure`, `WorktreeCreate` → `discern worktree create`, `WorktreeRemove` → `discern worktree remove` — preserving existing settings. Each other configured agent gets its own settings/hooks seed the same way, routed through the provider registry ([`../60-agent-integrations/`](../60-agent-integrations/)).                                 |
| [`.gitignore`](../../../templates/.gitignore.fragment)                   | co-managed       | The project owns its ignore rules outside `# --- discern ---` / `# --- /discern ---`. Inside that block, discern ignores only what it materializes or keeps machine-local — the skills dirs and `.claude/settings.local.json` (ADR 0128); the compiled agent files stay tracked. `upgrade` reconciles it to the current fragment (ADR 0093), while `status` warns and `done` blocks if a discern-owned ignored path is tracked. |

> In this repo (which self-hosts from source), these hooks call
> `deno task dev worktree ensure`, `deno task dev worktree create`, and
> `deno task dev worktree remove` rather than the installed `discern` binary:
> they run automatically with no setup, so they go through Deno directly instead
> of the optional local-dev `discern` wrapper. The distributed
> [`templates/.claude/settings.json.tmpl`](../../../templates/.claude/settings.json.tmpl)
> uses the on-`PATH` `discern` binary.

The linked worktree checkouts appear only at run time, never from `setup`. By
default they live in a **sibling** directory (`<repo>.worktrees/`), outside the
repo entirely, so nothing in the tree needs to ignore them. A project that
points `[worktree].root` at a path _inside_ the repo (e.g. `.claude/worktrees`)
keeps them out of git via the ignore block
([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).
