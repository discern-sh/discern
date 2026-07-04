# ADR 0001: Project-owned recipes live in an unmanaged `.discern/recipes/`

> **Current-state note.** Recipes now live at the config-pointed `[recipes].dir`
> (default `recipes/`), not `.discern/recipes/`
> ([ADR 0020](0020-dissolve-discern-dir.md)), and read config via
> `discern config get` rather than sourcing a shell library
> ([ADR 0019](0019-single-binary-ts-engine.md)). The
> engine-wins-on-name-collision rule still stands.

**Status**: accepted; **amended by [ADR 0019](0019-single-binary-ts-engine.md)**
— see _Update (single-binary cutover)_ below.

## Update (single-binary cutover)

Under the single-binary cutover ([ADR 0019](0019-single-binary-ts-engine.md)),
`bin/agent` and `.discern/engine/` are gone: the dispatcher is `discern` and the
engine is compiled into the binary. Project recipes still live in an unmanaged
`.discern/recipes/`, auto-discovered and exec'd on an unknown verb — but they
read config via `discern config get` rather than sourcing a shell library, and
the engine-always-wins shadow rule survives.

## Context

`bin/agent` is the task-runner surface a coding agent drives: `agent finish`,
`agent worktree exit`, and more. It dispatches a verb to a file by mapping `:`
to `-` and running `.discern/engine/<recipe>`. Recipes are auto-discovered from
the files on disk — drop one in and it works, no registry.

However, `.discern/engine/` is **managed**: it is kit-owned, hash-tracked in the
manifest, and refreshed by `discern upgrade`. A project that wants its own
first-class `agent <verb>` command (say `agent deploy`, `agent seed-db`) has
nowhere to put it except that managed directory. Doing so is hazardous:

- **Upgrade churn.** A project file in `.discern/engine/` is not in the
  manifest, so it is treated as "not provably ours" — but it sits among files
  `upgrade` rewrites, and a future engine recipe of the same name would land as
  a `.new` sibling or, worse, shadow it.
- **Name collisions.** A project recipe named `finish` would silently shadow or
  be shadowed by the engine's, with no warning — a footgun either direction.
- **No clean separation.** `agent --help` and the manifest can't tell "the kit's
  commands" from "this project's commands".

Projects need to extend the command surface without forking the engine. The kit
already proves recipes need no registry; the missing piece is a _sanctioned,
unmanaged_ home for project recipes that `bin/agent` also resolves.

## Decision

Add a project-owned recipe directory that `bin/agent` resolves in addition to
the engine, kept strictly separate from the managed engine.

- **Location** is config-declared: a new optional key `[recipes].dir`,
  defaulting to `.discern/recipes`. The default applies even when the key is
  absent, so existing installs gain the feature on the next `upgrade` of
  `bin/agent` with no config edit.
- **Unmanaged.** `.discern/recipes/` matches no managed prefix
  (`.discern/engine/`, `.ai/skills/`, `bin/agent`), so it is never tracked,
  refreshed, or `.new`-preserved by `setup`/`upgrade`. It is the project's.
- **Resolution precedence: the engine always wins.** `bin/agent` checks the
  engine first, then the project recipes dir. A project recipe whose name
  collides with a built-in engine recipe is **never run** — instead `bin/agent`
  prints a warning to stderr that the project recipe is shadowed and should be
  renamed. The core commands (`finish`, `worktree command group`, …) can never
  be broken or redefined by a project file.
- **Discovery + help.** A project recipe carries a `# desc:` line, exactly like
  a top-level engine command, and surfaces under its own **"Project recipes"**
  group in `agent --help`. The unknown-recipe "did you mean…?" suggester also
  considers project recipes. A colliding (shadowed) name is omitted from the
  project-recipes listing, since it does not run.
- **Library access.** A project recipe invoked via `agent <name>` inherits the
  exported `DISCERN_*` paths, so it can `. "$DISCERN_LIB/bootstrap.sh"` to get
  the same `info`/`ok`/`die`, `config_get`, and `run_parallel` surface the
  engine recipes use.
- **Scaffolding.** `setup` writes a seed `.discern/recipes/README.md`
  documenting the directory and the `# desc:` contract. As a seed it is
  write-once and never touched by `upgrade`.

## Consequences

- Any project can add first-class custom commands (`agent deploy`,
  `agent reset-fixtures`) without editing kit-managed files and without upgrade
  churn — the central win.
- The managed/unmanaged boundary stays crisp: `agent --help` shows kit commands
  and project commands in separate groups; the manifest still tracks only the
  engine.
- The engine-always-wins rule means a project cannot accidentally (or
  intentionally) redefine `finish`. The cost is that a project recipe _can_ be
  silently inert if it collides — mitigated by the explicit shadow warning on
  every dispatch attempt and its omission from help.
- `bin/agent` does one extra `config_get` per run to read `[recipes].dir`. It
  already reads config for `MAIN_BRANCH`, so this is folded into the same load.
- Backward compatible: no `[recipes]` section and no `.discern/recipes/` dir
  means the default dir simply doesn't exist, and resolution is unchanged.

## Alternatives considered

- **A fixed, non-configurable `.discern/recipes/`.** Simpler, but a config key
  costs little, lets a project point at an existing `tools/` or `bin/recipes/`
  directory, and fits the declarative-config direction. The default keeps the
  zero-config case trivial.
- **Project recipes win over the engine (override semantics).** Rejected:
  letting a project file redefine `finish` is a footgun that can silently break
  the gate the kit exists to provide. Extension, not override.
- **A manifest-tracked but "user-editable" engine file.** Rejected: it muddies
  the managed/seed model the whole upgrade story rests on. A separate unmanaged
  location keeps that model intact.
