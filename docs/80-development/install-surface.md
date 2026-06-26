# Install surface

_What `discern setup` lays down in a project, and which files are **yours**
(written once, then kept), **generated** (re-published artifacts, always safe to
overwrite), or **bundled** (shipped inside the binary, never on disk)._

One `discern setup` scaffolds the harness into a project. The whole discern
footprint is **one root file, `discern.toml`**
([ADR 0020](../_adr/0020-dissolve-discern-dir.md)) — there is no hidden
`.discern/` directory. The seed files originate in
[`templates/`](../../templates/) — the source of truth — which the binary
renders, merges, or appends into place; the built-in skills and guidance are
bundled in the binary itself and materialised on disk only as generated output.
This page is the durable map of that surface, grouped by what each part does.

It is deliberately **not** an exhaustive file list. The per-file truth lives in
self-describing sources that never go stale — consult those for the leaves:

> - `discern --help` lists every subcommand (the former engine recipes are now
>   first-class verbs).
> - [`discern.toml`](../../templates/discern.toml.tmpl) documents every config
>   block in its own comments.

## The two buckets

Every path in an install is one of two kinds. The bucket decides how the binary
treats it on `upgrade` and where you change it.

| Bucket           | What it is                                                                                                                                                                                  | On `discern upgrade`                            | Where you change it                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| **yours**        | Committed seed files: rendered once from a `templates/….tmpl` (or merged/appended into what was already there) at `setup`, then owned by the project. Authored skills/recipes/guidance too. | Untouched.                                      | Edit the file in place.                                          |
| **the binary's** | Gitignored, re-published artifacts: the materialised `.claude/skills/` and the compiled agent files. Produced from the bundled sources, written out, always safe to overwrite.              | Re-published — overwritten to match the binary. | Edit the source (in this repo) and re-run the producing command. |

A third category is **bundled**: the engine, the built-in skills
([`templates/skills/`](../../templates/skills/)), and the built-in harness
guidance ([`templates/guidance/`](../../templates/guidance/)) ship _inside_ the
binary and are never committed to a project at all — the limit case of the
binary's bucket ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). There is
**no** "managed copy kept byte-identical by a gate": with the shell engine
retired there is nothing committed to sync. The same buckets are defined in the
[glossary](../00-orientation/glossary.md#file-dispositions).

Two seed files are special-cased at `setup` so an existing project keeps what it
already had: `.claude/settings.json` by structured merge, and `.gitignore` by
idempotent append.

In the tables below, seed paths link to their source under `templates/`; the
path shown is where the file lands in an installed project. The materialised
skills and compiled agent files have no committed `templates/` counterpart —
they are generated from the bundled sources.

## Control surface & configuration

| Path                                                | Bucket | What it is                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern.toml`](../../templates/discern.toml.tmpl) | yours  | The one hand-edited file — the entire discern footprint. It teaches the generic engine about your stack: `[features]` toggles, capabilities, checks, scopes (with gates), worktree settings, ratchets, gate ergonomics, and the `[guidance]`/`[skills]`/`[recipes]` pointers. Its `[meta].schema_version` is the migration anchor ([ADR 0014](../_adr/0014-versioned-migration-system.md)), stamped by `upgrade`. |
| `brief.md`                                          | yours  | An optional project brief — seeded only when one is supplied (`discern setup --brief`/`--config`; the default zero-config run supplies none). When present, the agent reads it to help fill the docs and guidance.                                                                                                                                                                                                |

## The quality gate

The gate is part of the binary's TypeScript engine
([`src/engine/`](../../src/engine/)). Its public verbs are first-class `discern`
subcommands:

| Command                  | What it does                                                                                                                                              | Source                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `discern finish`         | The full gate — (in a worktree) a fail-fast main-merged check first, then `fix`+`build`, then `check`+`test` in parallel, then scope-matched scope gates. | [`src/engine/gate/finish.ts`](../../src/engine/gate/finish.ts)       |
| `discern prepare`        | The fast inner loop — fixers then read-only checks; no build or test.                                                                                     | [`src/engine/gate/prepare.ts`](../../src/engine/gate/prepare.ts)     |
| `discern test`           | The `test` capability on its own.                                                                                                                         | [`src/engine/gate/test.ts`](../../src/engine/gate/test.ts)           |
| `discern ratchets`       | Holds never-loosen metric floors/ceilings against `main` (on demand; not part of `finish`).                                                               | [`src/engine/gate/ratchets.ts`](../../src/engine/gate/ratchets.ts)   |
| `discern changed-scopes` | Classifies which scopes the branch touches; fails **open** (an unknown path runs more gates, never fewer).                                                | [`src/engine/scopes/changed.ts`](../../src/engine/scopes/changed.ts) |

The gate, `config`, and `doctor` are **core** — always on. The other subsystems
each sit behind a `[features]` toggle (`worktrees`, `ratchets`, `guidance`,
`skills`, `docs`, all default on); disabling one hides its verbs, omits its
guidance section, skips its doctor checks, and leaves its hooks out of
`settings.json` ([ADR 0020](../_adr/0020-dissolve-discern-dir.md)). A _feature_
is not a _capability_: `[features]` toggles whole subsystems,
[`[capabilities]`](#the-quality-gate) is the gate's command table.

Stage scheduling
([`src/engine/gate/stages.ts`](../../src/engine/gate/stages.ts)), the
failure-pointer wording
([`src/engine/gate/gotchas.ts`](../../src/engine/gate/gotchas.ts)), and the
parallel/serial job runner
([`src/engine/jobs/runner.ts`](../../src/engine/jobs/runner.ts), with
process-group tree-kill in
[`src/engine/jobs/command.ts`](../../src/engine/jobs/command.ts)) back these.
`doctor` ([`src/commands/doctor.ts`](../../src/commands/doctor.ts))
health-checks the install — config, git, capability/check commands, paths, and a
readiness report.

## The isolated-worktree workflow

Generic git mechanics in the engine
([`src/engine/worktree/`](../../src/engine/worktree/)), driven by the hooks in
[Bookkeeping & integration](#bookkeeping--integration). The stack-specific part
is the per-worktree **resources** (`[worktree.resources.<name>]`) a project
declares in `discern.toml`; a fresh install declares none. The whole workflow
sits behind `[features].worktrees`.

| Command                     | What it does                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `discern worktree:create`   | Creates + sets up a worktree from the `WorktreeCreate` hook's JSON payload (stdin).  |
| `discern worktree`          | Sets up a freshly-created worktree (what `worktree:create` runs inside it).          |
| `discern worktree:ensure`   | Session-start idempotent setup (run by the `SessionStart` hook).                     |
| `discern graduate`          | Graduates the branch into the main repo and tears the worktree down.                 |
| `discern worktree:remove`   | Tears a worktree down from the `WorktreeRemove` hook's payload (stdin; best-effort). |
| `discern worktree:teardown` | Destroys a worktree's resources (what `worktree:remove` runs).                       |
| `discern worktree:prune`    | Sweeps stale worktrees, fully-merged branches, orphan dirs, and orphan resources.    |
| `discern worktree-name`     | Resolves a worktree's stable identity (id / site / branch / port / db / resource).   |

The lifecycle logic lives in
[`src/engine/worktree/lifecycle.ts`](../../src/engine/worktree/lifecycle.ts);
the stable worktree identity (POSIX-`cksum`-faithful) in
[`src/engine/worktree/identity.ts`](../../src/engine/worktree/identity.ts). Run
`discern --help` for the full verb list.

## Agent instructions (author-once → compile-everywhere)

| Path                     | Bucket    | What it is                                                                                                                                                                                                                                                              |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guidance.md`            | yours     | Your hand-authored guidance source(s) — the default `[guidance].sources`, additive to the built-ins. Globs allowed. Seeded by `discern setup`.                                                                                                                          |
| `AGENTS.md`              | generated | The **canonical** per-agent file (codex) — holds the full compiled body the mirrors import. Gitignored (ADR 0034); a stale one fails `discern finish`'s guidance-currency check.                                                                                        |
| `CLAUDE.md`, `GEMINI.md` | generated | The gitignored per-agent mirrors. `CLAUDE.md` is just an `@AGENTS.md` import (Claude Code expands it), so it can't drift from the canonical file; `GEMINI.md` is a full copy until Gemini's include syntax is wired. No banner — drift is caught by the currency check. |
| `.claude/skills/*`       | generated | Materialised skills the agent discovers — built-ins copied, authored skills symlinked.                                                                                                                                                                                  |

`discern refresh` ([`src/engine/guidelines.ts`](../../src/engine/guidelines.ts))
regenerates the generated agent files, skills, and integration artifacts: it
compiles each agent file as **discern's built-in harness guidance** (always
prepended, one section per enabled feature) **plus your `[guidance].sources`**,
and (re)materialises the skills. Which files it writes is set by
`[guidance].agents` in `discern.toml` (`claude_code` → `CLAUDE.md`, `codex` →
`AGENTS.md`, `gemini` → `GEMINI.md`).

## Bundled skills

Four skills the coding agent can invoke are **bundled in the binary** (their
source lives under [`templates/skills/`](../../templates/skills/), compiled in
via `deno compile --include templates`), and a project can add its own under
`[skills].dir` (default `./skills`, yours overriding a built-in by name).
`discern refresh` (and `setup`/`upgrade`) materialise the effective set into
`.claude/skills/` — **generated**, gitignored: built-ins **copied**, authored
skills **symlinked** so edits are live (see
[`src/lib/skills.ts`](../../src/lib/skills.ts)). `discern skills list` shows the
set and which of yours override which; `discern skills eject <name>` copies a
built-in into `./skills/` so you can customise it. Each is a `SKILL.md` under
its own directory:

| Skill                                                                      | What it does                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md) | Write or refresh a `docs/` subtree per the documenter brief.                  |
| [`fix-a-bug-class`](../../templates/skills/fix-a-bug-class/SKILL.md)       | Fix a whole class of defect — not one instance — behind a permanent detector. |
| [`write-adr`](../../templates/skills/write-adr/SKILL.md)                   | Record a significant decision as an Architecture Decision Record.             |

(Seeding a fresh install is **not** a skill — it is the `discern setup` command;
see below and [ADR 0024](../_adr/0024-bootstrap-as-command.md), amended by
[ADR 0036](../_adr/0036-unify-setup.md).)

## Documentation & ADR scaffold (lazy — not part of the install surface)

`setup` writes **no** `docs/` tree and **no** `TODO.md`. The doc, ADR, and TODO
skeletons ship **with whatever creates them** — the `discern setup` command
(under `templates/setup/skel/`) and two skills (under
`templates/skills/<skill>/skel/`) — and are materialised on demand:

| Materialised by                                                            | Skeleton it carries                                                                          | What lands in the project                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern setup` (the command)                                              | `templates/setup/skel/docs/{README.md, 00-orientation/*, 80-development/*}` + `skel/TODO.md` | The orientation tree, the `80-development/` tree (incl. `finish-gate-gotchas`), and `TODO.md` — laid only when the project has none, then filled. |
| [`write-adr`](../../templates/skills/write-adr/SKILL.md)                   | `skel/docs/_adr/{0000-template.md, README.md}`                                               | `docs/_adr/`, created on first use.                                                                                                               |
| [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md) | `skel/docs/_internal/{documenter-agent-brief.md, scopes/_template.md}`                       | `docs/_internal/`, the documenter brief and per-subtree scope-manifest template.                                                                  |

So `docs/`, `TODO.md`, `guidance.md`, and the compiled agent files appear
**after** install, with real content — they are no longer a static part of the
install surface. This page lives in the `80-development/` tree that
`discern setup` materialises.

## Bookkeeping & integration

| Path                                                                  | Bucket         | What it is                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO.md`                                                             | yours          | The shared backlog for deferred or at-risk work; documents its own format. Lazy — not shipped at `setup`; created by `discern setup` (or on the first deferral) from its bundled skeleton, then yours to keep.                                                                            |
| `recipes/` (`[recipes].dir`)                                          | yours          | Your own `discern <verb>` recipes (default `./recipes`, read only if present) — the engine wins on a name collision ([ADR 0001](../_adr/0001-project-owned-recipes.md)). Recipes read config through `discern config get`, not by sourcing a shell library.                               |
| [`.claude/settings.json`](../../templates/.claude/settings.json.tmpl) | yours (merged) | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `discern worktree:ensure`, `WorktreeCreate` → `discern worktree:create`, `WorktreeRemove` → `discern worktree:remove` — preserving existing settings. (The worktree hooks are omitted when `[features].worktrees = false`.) |
| [`.gitignore`](../../templates/.gitignore.fragment)                   | yours (merged) | Idempotently ignores the compiled agent files `/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md` (all build artifacts — ADR 0034) and `/.claude/*` (except the tracked settings files).                                                                                                             |

> In this repo (which self-hosts from source), the same `.claude/settings.json`
> hooks call `deno task dev worktree:*` instead of `discern worktree:*` — the
> distributed
> [`templates/.claude/settings.json.tmpl`](../../templates/.claude/settings.json.tmpl)
> uses the on-`PATH` `discern` binary.

The linked worktree checkouts appear only at run time, never from `setup`. By
default they live in a **sibling** directory (`<repo>.worktrees/`), outside the
repo entirely, so nothing in the tree needs to ignore them. A project that
points `[worktree].root` at a path _inside_ the repo (e.g. `.claude/worktrees`,
the old default) keeps them out of git via the `/.claude/*` rule
([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).
