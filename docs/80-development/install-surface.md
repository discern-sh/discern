# Install surface

_What `icculus init` lays down in a project, and which files are **yours**
(written once, then kept) versus **the binary's** (re-published artifacts,
always safe to overwrite)._

One `icculus init` scaffolds the harness into a project. The seed files
originate in [`templates/`](../../templates/) — the source of truth — which the
binary renders, merges, or appends into place; the skills are bundled in the
binary itself and materialised on disk. This page is the durable map of that
surface, grouped by what each part does.

It is deliberately **not** an exhaustive file list. The per-file truth lives in
self-describing sources that never go stale — consult those for the leaves:

> - `icculus --help` lists every subcommand (the former engine recipes are now
>   first-class verbs).
> - [`.icculus/config.toml`](../../templates/.icculus/config.toml.tmpl)
>   documents every config block in its own comments.

## The two buckets

Every path in an install is one of two kinds. The bucket decides how the binary
treats it on `upgrade` and where you change it.

| Bucket           | What it is                                                                                                                                                                   | On `icculus upgrade`                            | Where you change it                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| **yours**        | Committed seed files: rendered once from a `templates/….tmpl` (or merged/appended into what was already there) at `init`, then owned by the project.                         | Untouched.                                      | Edit the file in place.                                          |
| **the binary's** | Gitignored, re-published artifacts: the materialised skills and the compiled agent files. Bundled in the binary (or produced from it), copied out, always safe to overwrite. | Re-published — overwritten to match the binary. | Edit the source (in this repo) and re-run the producing command. |

There is **no** third "managed copy kept byte-identical by a gate." With the
shell engine retired there is nothing committed to sync — the engine lives in
the binary, the limit case of the binary's bucket: never on disk in a project at
all ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The same two buckets
are defined in the [glossary](../00-orientation/glossary.md#file-dispositions).

Two seed files are special-cased at `init` so an existing project keeps what it
already had: `.claude/settings.json` by structured merge, and `.gitignore` by
idempotent append.

In the tables below, seed paths link to their source under `templates/`; the
path shown is where the file lands in an installed project. The skills and
compiled agent files have no `templates/` source — they are the binary's.

## Control surface & configuration

| Path                                                                | Bucket | What it is                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`.icculus/config.toml`](../../templates/.icculus/config.toml.tmpl) | yours  | The one hand-edited file that teaches the generic engine about your stack — capabilities, checks, scopes (with gates), worktree settings, ratchets, gate ergonomics, recipes. Its `[meta].schema_version` is the migration anchor ([ADR 0014](../_adr/0014-versioned-migration-system.md)), stamped by `upgrade`. |
| `.icculus/brief.md`                                                 | yours  | The project brief captured at `init`; the [`bootstrap`](../../.icculus/skills/bootstrap/SKILL.md) skill reads it to fill the docs and guidelines.                                                                                                                                                                 |

## The quality gate

The gate is part of the binary's TypeScript engine
([`src/engine/`](../../src/engine/)). Its public verbs are first-class `icculus`
subcommands:

| Command                  | What it does                                                                                                                          | Source                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `icculus finish`         | The full gate — `fix`+`build`, then `check`+`test` in parallel, scope-matched scope gates, and (in a worktree) the main-merged check. | [`src/engine/gate/finish.ts`](../../src/engine/gate/finish.ts)       |
| `icculus tidy`           | The fast inner loop — fixers then read-only checks; no build or test.                                                                 | [`src/engine/gate/tidy.ts`](../../src/engine/gate/tidy.ts)           |
| `icculus test`           | The `test` capability on its own.                                                                                                     | [`src/engine/gate/test.ts`](../../src/engine/gate/test.ts)           |
| `icculus ratchets`       | Holds never-loosen metric floors/ceilings against `main` (on demand; not part of `finish`).                                           | [`src/engine/gate/ratchets.ts`](../../src/engine/gate/ratchets.ts)   |
| `icculus changed-scopes` | Classifies which scopes the branch touches; fails **open** (an unknown path runs more gates, never fewer).                            | [`src/engine/scopes/changed.ts`](../../src/engine/scopes/changed.ts) |

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
[Bookkeeping & integration](#bookkeeping--integration). The two stack-specific
seams (database, dev-server) are empty config in `.icculus/config.toml` until
you wire them.

| Command                     | What it does                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- |
| `icculus worktree`          | Sets up a freshly-created worktree (run by the `WorktreeCreate` hook).          |
| `icculus worktree:ensure`   | Session-start idempotent setup (run by the `SessionStart` hook).                |
| `icculus worktree:exit`     | Graduates the branch into the main repo and tears the worktree down.            |
| `icculus worktree:teardown` | Tears down a worktree's database and dev-server link (run by `WorktreeRemove`). |
| `icculus worktree:prune`    | Sweeps stale worktrees, fully-merged branches, and orphan directories.          |
| `icculus worktree-name`     | Resolves a worktree's stable identity (id / site / branch / port / db).         |

The lifecycle logic lives in
[`src/engine/worktree/lifecycle.ts`](../../src/engine/worktree/lifecycle.ts);
the stable worktree identity (POSIX-`cksum`-faithful) in
[`src/engine/worktree/identity.ts`](../../src/engine/worktree/identity.ts). Run
`icculus --help` for the full verb list.

## Agent instructions (author-once → compile-everywhere)

| Path                            | Bucket       | What it is                                                                                |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `.icculus/guidelines/<slug>.md` | yours        | The single hand-edited guidance source.                                                   |
| `CLAUDE.md`, `AGENTS.md`        | the binary's | The per-agent instruction files compiled from the guidelines; carry a do-not-edit banner. |
| `.claude/skills/*`              | the binary's | Gitignored symlinks that make the materialised skills discoverable by the agent.          |

`icculus guidelines`
([`src/engine/guidelines.ts`](../../src/engine/guidelines.ts)) compiles the
guidance source into the agent files and refreshes the skill symlinks. Which
agent files it writes is set by `[project].agents` in `.icculus/config.toml`
(`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

## Bundled skills

Four skills the coding agent can invoke are **bundled in the binary** (their
source lives under
[`templates/.icculus/skills/`](../../templates/.icculus/skills/), compiled in
via `deno compile --include templates`). `init`/`upgrade` materialise them into
`.icculus/skills/` — **the binary's** bucket: gitignored, always overwritten,
then symlinked into `.claude/skills/` (see
[`src/lib/skills.ts`](../../src/lib/skills.ts)). Each is a `SKILL.md` under its
own directory:

| Skill                                                                               | What it does                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md)                   | Seed a freshly-installed harness from the project brief.          |
| [`document-subsystem`](../../templates/.icculus/skills/document-subsystem/SKILL.md) | Write or refresh a `docs/` subtree per the documenter brief.      |
| [`write-adr`](../../templates/.icculus/skills/write-adr/SKILL.md)                   | Record a significant decision as an Architecture Decision Record. |
| [`handoff-worktree`](../../templates/.icculus/skills/handoff-worktree/SKILL.md)     | Graduate the current worktree's branch into the main repo.        |

## Documentation & ADR scaffold (lazy — not part of the install surface)

`init` writes **no** `docs/` tree and **no** `TODO.md`. The doc, ADR, and TODO
skeletons ship **inside the skills that create them**, under
`.icculus/skills/<skill>/skel/`, and are materialised on demand:

| Materialised by                                                                     | Skeleton it carries                                                          | What lands in the project                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md) (`/bootstrap`)    | `skel/docs/{README.md, 00-orientation/*, 80-development/*}` + `skel/TODO.md` | The orientation tree, the `80-development/` tree (incl. `finish-gate-gotchas`), and `TODO.md` — copied, then filled. |
| [`write-adr`](../../templates/.icculus/skills/write-adr/SKILL.md)                   | `skel/docs/_adr/{0000-template.md, README.md}`                               | `docs/_adr/`, created on first use.                                                                                  |
| [`document-subsystem`](../../templates/.icculus/skills/document-subsystem/SKILL.md) | `skel/docs/_internal/{documenter-agent-brief.md, scopes/_template.md}`       | `docs/_internal/`, the documenter brief and per-subtree scope-manifest template.                                     |

So `docs/`, `TODO.md`, `CLAUDE.md`, and `AGENTS.md` appear **after** install,
with real content — they are no longer a static part of the install surface.
This page lives in the `80-development/` tree that `/bootstrap` materialises.

## Bookkeeping & integration

| Path                                                                  | Bucket         | What it is                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO.md`                                                             | yours          | The shared backlog for deferred or at-risk work; documents its own format. Lazy — not shipped at `init`; created by `/bootstrap` (or on the first deferral) from the `bootstrap` skill skeleton, then yours to keep.    |
| [`.icculus/recipes/`](../../templates/.icculus/recipes/README.md)     | yours          | Your own `icculus <verb>` recipes — the engine wins on a name collision ([ADR 0001](../_adr/0001-project-owned-recipes.md)). Recipes read config through `icculus config get`, not by sourcing a shell library.         |
| [`.claude/settings.json`](../../templates/.claude/settings.json.tmpl) | yours (merged) | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `icculus worktree:ensure`, `WorktreeCreate` → branch + `icculus worktree`, `WorktreeRemove` → `icculus worktree:teardown` — preserving existing settings. |
| [`.gitignore`](../../templates/.gitignore.fragment)                   | yours (merged) | Idempotently ignores `/CLAUDE.md`, `/.icculus/skills/`, and `/.claude/*` (except the tracked settings files).                                                                                                           |

> In this repo (which self-hosts from source), the same `.claude/settings.json`
> hooks call `deno task dev worktree:*` instead of `icculus worktree:*` — the
> distributed
> [`templates/.claude/settings.json.tmpl`](../../templates/.claude/settings.json.tmpl)
> uses the on-`PATH` `icculus` binary.

One path appears only at run time, never from `init`, and is gitignored:
`.claude/worktrees/` (the linked worktree checkouts).
