# Install surface

_What `icculus init` lays down in a project, and which files are **managed**
(refreshed by the kit) versus **yours** (written once, then kept)._

One `icculus init` scaffolds the harness into a project. Every file originates
in [`templates/`](../../templates/) — the source of truth — which the installer
copies, renders, merges, or appends into place; `init` then writes two more from
your answers. This page is the durable map of that surface, grouped by what each
part does.

It is deliberately **not** an exhaustive file list. The per-file truth lives in
self-describing sources that never go stale — consult those for the leaves:

> - `agent --help` lists every engine recipe from its own `# desc:` line.
> - [`managed.json`](../../templates/managed.json) declares exactly which paths
>   are managed (see [ADR 0008](../_adr/0008-declarative-managed-set.md)).
> - [`.icculus/config.toml`](../../templates/.icculus/config.toml.tmpl)
>   documents every config block in its own comments.

## The four dispositions

Every path in an install is one of four kinds. The disposition decides how the
kit treats it on `upgrade` and where you change it.

| Disposition   | What it is                                                                                    | On `icculus upgrade`                                                                                                      | Where you change it                                            |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **managed**   | Copied verbatim from `templates/`; `selfcheck` holds it byte-identical to the kit.            | Refreshed. A local edit is preserved as `<file>.new`; one the kit no longer ships is removed if pristine, kept if edited. | Edit the source under `templates/`, then `deno task selfsync`. |
| **yours**     | Rendered once from a `templates/….tmpl` at `init`, then owned by the project.                 | Untouched.                                                                                                                | Edit the file in place.                                        |
| **merged**    | Folded into an existing file (structured merge or idempotent append), preserving its content. | Untouched (written at `init` only).                                                                                       | Edit the file in place.                                        |
| **generated** | Produced by a harness command after install — not shipped as a static file.                   | n/a (re-run the producing command).                                                                                       | Edit the inputs, then re-run the command.                      |

The managed set is declared in [`managed.json`](../../templates/managed.json);
everything else under `templates/` is yours. Two files are special-cased at
`init` so an existing project keeps what it already had: `.claude/settings.json`
by structured merge, and `.gitignore` by idempotent append.

In the tables below, each path links to its source under `templates/`; the path
shown is where the file lands in an installed project.

## Control surface & configuration

| Path                                                                | Disposition | What it is                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agent`](../../templates/agent)                                    | managed     | The `agent` task runner: finds the project root and dispatches `agent <verb>` to an engine recipe.                                                                                                                                                         |
| [`.icculus/config.toml`](../../templates/.icculus/config.toml.tmpl) | yours       | The one hand-edited file that teaches the generic engine about your stack — capabilities, checks, scopes (with gates), worktree settings, ratchets, gate ergonomics, recipes.                                                                              |
| `.icculus/brief.md`                                                 | yours       | The project brief captured at `init`; the source [`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md) reads to fill the docs and guidelines.                                                                                                  |
| `.icculus/manifest.json`                                            | generated   | Records the kit version, the install **schema version** (the migration anchor, [ADR 0014](../_adr/0014-versioned-migration-system.md)), and a hash of every managed file, so `upgrade` / `selfcheck` can tell pristine from edited and current from stale. |

## The quality gate

The gate lives in `.icculus/engine/` (all **managed**). Its public verbs:

| Command                                                                  | What it does                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`agent finish`](../../templates/.icculus/engine/finish)                 | The full gate — `fix`+`build`, then `check`+`test` in parallel, scope-matched scope gates, and (in a worktree) the main-merged check. |
| [`agent tidy`](../../templates/.icculus/engine/tidy)                     | The fast inner loop — fixers then read-only checks; no build or test.                                                                 |
| [`agent test`](../../templates/.icculus/engine/test)                     | The `test` capability on its own.                                                                                                     |
| [`agent doctor`](../../templates/.icculus/engine/doctor)                 | Health-checks the install — config, git, capability/check commands, paths, and a readiness report.                                    |
| [`agent ratchets`](../../templates/.icculus/engine/ratchets)             | Holds never-loosen metric floors/ceilings against `main` (on demand; not part of `finish`).                                           |
| [`agent changed-scopes`](../../templates/.icculus/engine/changed-scopes) | Classifies which scopes the branch touches; fails **open** (an unknown path runs more gates, never fewer).                            |

Internal helpers (`with-gotchas`, the `assert-*` guards) back these.

## The isolated-worktree workflow

Generic git mechanics in `.icculus/engine/` (all **managed**), driven by the
hooks in [Bookkeeping & integration](#bookkeeping--integration). The two
stack-specific seams (database, dev-server) are empty config in
`.icculus/config.toml` until you wire them.

| Command                                                                        | What it does                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`agent worktree`](../../templates/.icculus/engine/worktree)                   | Sets up a freshly-created worktree (run by the `WorktreeCreate` hook).          |
| [`agent worktree:ensure`](../../templates/.icculus/engine/worktree-ensure)     | Session-start idempotent setup (run by the `SessionStart` hook).                |
| [`agent worktree:exit`](../../templates/.icculus/engine/worktree-exit)         | Graduates the branch into the main repo and tears the worktree down.            |
| [`agent worktree:teardown`](../../templates/.icculus/engine/worktree-teardown) | Tears down a worktree's database and dev-server link (run by `WorktreeRemove`). |
| [`agent worktree:prune`](../../templates/.icculus/engine/worktree-prune)       | Sweeps stale worktrees, fully-merged branches, and orphan directories.          |
| [`agent worktree-name`](../../templates/.icculus/engine/worktree-name)         | Resolves a worktree's stable identity (id / site / branch / port / db).         |

The `assert-*` guards, `inherit-main-env-vars`, and the prune/sweep/remove
plumbing implement these; see `agent --help`.

## The engine library

[`.icculus/engine/lib/`](../../templates/.icculus/engine/lib/) (all **managed**)
holds the dependency-free POSIX shell every recipe sources via `bootstrap.sh`:
config access (`config.sh` + `toml.awk`), the parallel job runner (`jobs.sh`),
colour-aware output (`output.sh`), the ratchet engine (`ratchets.sh`), the
failure-pointer wording (`gotchas.sh`), value validators (`validate.sh`), and
the shared worktree helpers (`worktree.sh`). It is internal plumbing — recipes
source it; you rarely read it directly.

## Agent instructions (author-once → compile-everywhere)

| Path                            | Disposition | What it is                                                                                |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `.icculus/guidelines/<slug>.md` | yours       | The single hand-edited guidance source.                                                   |
| `CLAUDE.md`, `AGENTS.md`        | generated   | The per-agent instruction files compiled from the guidelines; carry a do-not-edit banner. |
| `.claude/skills/*`              | generated   | Symlinks that make the bundled skills discoverable by the agent.                          |

[`agent guidelines`](../../templates/.icculus/engine/guidelines) (managed) is
the recipe that compiles the guidance source into the agent files and refreshes
the skill symlinks. Which agent files it writes is set by `[project].agents` in
`.icculus/config.toml` (`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

## Bundled skills

[`.icculus/skills/`](../../templates/.icculus/skills/) ships four **managed**
skills the coding agent can invoke, each a `SKILL.md` under its own directory:

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

| Path                                                                  | Disposition | What it is                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO.md`                                                             | generated   | The shared backlog for deferred or at-risk work; documents its own format. Lazy — not shipped at `init`; created by `/bootstrap` (or on the first deferral) from the `bootstrap` skill skeleton.                     |
| [`.icculus/recipes/`](../../templates/.icculus/recipes/README.md)     | yours       | Your own `agent <verb>` recipes — unmanaged; the engine wins on a name collision ([ADR 0001](../_adr/0001-project-owned-recipes.md)).                                                                                |
| [`.claude/settings.json`](../../templates/.claude/settings.json.tmpl) | merged      | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `./agent worktree:ensure`, `WorktreeCreate` → `./agent` branch + setup, `WorktreeRemove` → `./agent worktree:teardown` — preserving existing settings. |
| [`.gitignore`](../../templates/.gitignore.fragment)                   | merged      | Idempotently ignores `/CLAUDE.md` and `/.claude/*` (except the tracked settings files).                                                                                                                              |

One path appears only at run time, never from `init`, and is gitignored:
`.claude/worktrees/` (the linked worktree checkouts).
