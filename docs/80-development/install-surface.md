# Install surface

_What `icculus init` lays down in a project, and which files are **managed**
(refreshed by the kit) versus **seed** (yours to keep)._

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
> - [`icculus.toml`](../../templates/icculus.toml.tmpl) documents every config
>   block in its own comments.

## The four dispositions

Every path in an install is one of four kinds. The disposition decides how the
kit treats it on `upgrade` and where you change it.

| Disposition   | What it is                                                                                    | On `icculus upgrade`                                                       | Where you change it                                            |
| ------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **managed**   | Copied verbatim from `templates/`; `selfcheck` holds it byte-identical to the kit.            | Refreshed. A local edit is flagged as drift and preserved as `<file>.new`. | Edit the source under `templates/`, then `deno task selfsync`. |
| **seed**      | Rendered once from a `templates/….tmpl` at `init`, then owned by the project.                 | Untouched.                                                                 | Edit the file in place.                                        |
| **merged**    | Folded into an existing file (structured merge or idempotent append), preserving its content. | Untouched (written at `init` only).                                        | Edit the file in place.                                        |
| **generated** | Produced by a harness command after install — not shipped as a static file.                   | n/a (re-run the producing command).                                        | Edit the inputs, then re-run the command.                      |

The managed set is declared in [`managed.json`](../../templates/managed.json);
everything else under `templates/` is a seed. Two files are special-cased at
`init` so an existing project keeps what it already had: `.claude/settings.json`
by structured merge, and `.gitignore` by idempotent append.

In the tables below, each path links to its source under `templates/`; the path
shown is where the file lands in an installed project.

## Control surface & configuration

| Path                                                | Disposition | What it is                                                                                                                                                  |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`bin/agent`](../../templates/bin/agent)            | managed     | The `agent` task runner: finds the project root and dispatches `agent <verb>` to an engine recipe.                                                          |
| [`icculus.toml`](../../templates/icculus.toml.tmpl) | seed        | The one hand-edited file that teaches the generic engine about your stack — slots, scopes, worktree adapters, ratchets, evidence, gate ergonomics, recipes. |
| `.icculus/brief.md`                                 | seed        | The project brief captured at `init`; the source [`bootstrap`](../../templates/.ai/skills/bootstrap/SKILL.md) reads to fill the docs and guidelines.        |
| `.icculus/manifest.json`                            | generated   | Records the kit version and a hash of every managed file, so `upgrade` / `selfcheck` can tell pristine from edited.                                         |

## The quality gate

The gate lives in `.icculus/engine/` (all **managed**). Its public verbs:

| Command                                                                  | What it does                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`agent finish`](../../templates/.icculus/engine/finish)                 | The full gate — `fix`+`build`, then `check`+`test` in parallel, scope-matched side gates, and (in a worktree) the main-merged check. |
| [`agent tidy`](../../templates/.icculus/engine/tidy)                     | The fast inner loop — fixers then read-only checks; no build or test.                                                                |
| [`agent test`](../../templates/.icculus/engine/test)                     | The test-phase slots on their own.                                                                                                   |
| [`agent doctor`](../../templates/.icculus/engine/doctor)                 | Health-checks the install — config, git, slot commands, paths.                                                                       |
| [`agent ratchets`](../../templates/.icculus/engine/ratchets)             | Holds never-loosen metric floors/ceilings against `main` (on demand; not part of `finish`).                                          |
| [`agent evidence`](../../templates/.icculus/engine/evidence)             | Optional per-branch work-evidence capture/check (off unless enabled).                                                                |
| [`agent changed-scopes`](../../templates/.icculus/engine/changed-scopes) | Classifies which scopes the branch touches; fails **open** (an unknown path runs more gates, never fewer).                           |

Internal helpers (`with-gotchas`, the `assert-*` guards) back these.

## The isolated-worktree workflow

Generic git mechanics in `.icculus/engine/` (all **managed**), driven by the
hooks in [Bookkeeping & integration](#bookkeeping--integration). The two
stack-specific seams (database, dev-server) are empty config in `icculus.toml`
until you wire them.

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

| Path                       | Disposition | What it is                                                                                |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `.ai/guidelines/<slug>.md` | seed        | The single hand-edited guidance source.                                                   |
| `CLAUDE.md`, `AGENTS.md`   | generated   | The per-agent instruction files compiled from the guidelines; carry a do-not-edit banner. |
| `.claude/skills/*`         | generated   | Symlinks that make the bundled skills discoverable by the agent.                          |

[`agent guidelines`](../../templates/.icculus/engine/guidelines) (managed) is
the recipe that compiles the guidance source into the agent files and refreshes
the skill symlinks. Which agent files it writes is set by `[project].agents` in
`icculus.toml` (`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`).

## Bundled skills

[`.ai/skills/`](../../templates/.ai/skills/) ships nine **managed** skills the
coding agent can invoke, each a `SKILL.md` under its own directory:

| Skill                                                                              | What it does                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`bootstrap`](../../templates/.ai/skills/bootstrap/SKILL.md)                       | Seed a freshly-installed harness from the project brief.           |
| [`document-subsystem`](../../templates/.ai/skills/document-subsystem/SKILL.md)     | Write or refresh a `docs/` subtree per the documenter brief.       |
| [`write-adr`](../../templates/.ai/skills/write-adr/SKILL.md)                       | Record a significant decision as an Architecture Decision Record.  |
| [`handoff-worktree`](../../templates/.ai/skills/handoff-worktree/SKILL.md)         | Graduate the current worktree's branch into the main repo.         |
| [`grill-me`](../../templates/.ai/skills/grill-me/SKILL.md)                         | Stress-test a plan by relentless interview.                        |
| [`grill-with-docs`](../../templates/.ai/skills/grill-with-docs/SKILL.md)           | Stress-test a plan against the domain model, updating docs inline. |
| [`coding-principles`](../../templates/.ai/skills/coding-principles/SKILL.md)       | Principles to apply while planning and writing code.               |
| [`prompt-engineering`](../../templates/.ai/skills/prompt-engineering/SKILL.md)     | Guidance for writing prompts, hooks, commands, and skills.         |
| [`engineering-overkill`](../../templates/.ai/skills/engineering-overkill/SKILL.md) | Propose maximalist, beyond-pragmatic technical alternatives.       |

## Documentation & ADR scaffold

[`docs/`](../../templates/docs/) is a **seed** tree — written once, then yours.
It arrives mostly as `/bootstrap` skeletons:

| Path                                                           | What's in it                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`docs/00-orientation/`](../../templates/docs/00-orientation/) | README plus four skeletons: concepts, glossary, system map, design principles.                                    |
| [`docs/80-development/`](../../templates/docs/80-development/) | README plus getting-started / testing / code-conventions skeletons, and `finish-gate-gotchas` (pre-filled traps). |
| [`docs/_adr/`](../../templates/docs/_adr/)                     | The ADR-format README and `0000-template.md`.                                                                     |
| [`docs/_internal/`](../../templates/docs/_internal/)           | The documenter brief and the per-subtree scope-manifest template.                                                 |

This page lives in that tree, under `80-development/`.

## Bookkeeping & integration

| Path                                                                  | Disposition | What it is                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`TODO.md`](../../templates/TODO.md.tmpl)                             | seed        | The shared backlog for deferred or at-risk work; documents its own format.                                                                                                                 |
| [`.icculus/recipes/`](../../templates/.icculus/recipes/README.md)     | seed        | Your own `agent <verb>` recipes — unmanaged; the engine wins on a name collision ([ADR 0001](../_adr/0001-project-owned-recipes.md)).                                                      |
| [`.claude/settings.json`](../../templates/.claude/settings.json.tmpl) | merged      | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `worktree:ensure`, `WorktreeCreate` → branch + setup, `WorktreeRemove` → `worktree:teardown` — preserving existing settings. |
| [`.gitignore`](../../templates/.gitignore.fragment)                   | merged      | Idempotently ignores `/CLAUDE.md`, `/.claude/*` (except the tracked settings files), and the `.icculus/evidence/` runtime store.                                                           |

Two paths appear only at run time, never from `init`, and are gitignored:
`.icculus/evidence/` (the gate's per-branch evidence store) and
`.claude/worktrees/` (the linked worktree checkouts).
