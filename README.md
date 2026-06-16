# icculus

**A portable agentic-development harness you can drop into any project, in one
command.**

`icculus` scaffolds a small, opinionated set of safety rails for working with
coding agents — a compound quality gate, an isolated git-worktree workflow, an
author-once → compile-everywhere agent-instruction pipeline, and a documentation
/ principles / ADR / TODO discipline — into any repository, in any language, for
any coding agent. The orchestration is stack-neutral; the few stack-specific
commands live behind named **slots** in a single config file you fill in (or let
your own coding agent propose). Guidance is authored once and compiled to each
agent's own file, so Claude Code, Codex, Gemini, and others can work in the same
repo — even several at once.

> Working name. `icculus`, `bin/agent`, and `.icculus/` are placeholders pending
> a final name.

---

## Why

A good agentic workflow needs the same rails on every project: one command that
fixes-builds-checks-tests before work is called done; throwaway worktrees so an
agent can't trample your main checkout; agent guidance written once and compiled
to every agent's file; and a docs/decision discipline that keeps context from
rotting. Re-deriving those rails per project is wasteful and they drift.
`icculus` extracts the proven version of them (lifted from a production
codebase) and makes them installable and upgradable — without assuming your
language, test runner, or build tool.

The engine doesn't know what a test _is_. It runs "the test slot." You tell it
the command once.

---

## Install

**Single binary (recommended)** — no runtime needed:

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/icculus/main/install.sh | sh
```

This downloads the right prebuilt binary for your OS/arch from the latest GitHub
release and installs it to `~/.local/bin` (or `/usr/local/bin`).

**From source** (requires [Deno](https://deno.com)):

```sh
git clone https://github.com/jackwh/icculus && cd icculus
deno task dev -- --help          # run without compiling
deno task build                  # compile per-platform binaries → dist/
```

The **installed harness is pure POSIX shell + a TOML config** — the target
project never needs Deno. macOS and Linux are supported; Windows needs WSL.

---

## Quickstart

```sh
cd your-project              # fresh or existing repo (git required)
icculus init                 # walk the wizard — name, slug, what you're building
# → in your coding agent:
/bootstrap                   # fills principles/docs/guidelines + proposes slot fills
# day to day:
agent finish                 # the full quality gate — run before calling work done
agent worktree:exit          # graduate a worktree's branch back to main for review
```

`init` writes the harness and records a manifest; it **merges** into an existing
`.claude/settings.json` rather than clobbering it. `/bootstrap` is a shipped
skill that has _your own_ coding agent author the project-specific content and
sniff the repo to propose the slot fills — no API key, no provider lock-in.

---

## What gets installed

```
icculus.toml               # the one file you edit: slots, scopes, worktree adapters, ratchets
bin/agent                  # the task runner your agent drives (finish, worktree, guidelines, …)
.icculus/
  engine/                  # the generic shell engine (managed — refreshed by `icculus upgrade`)
  recipes/                 # YOUR own agent commands (unmanaged — never upgraded)
  brief.md                 # what you told init you're building
  manifest.json            # kit version + managed-file hashes
.ai/
  guidelines/<slug>.md     # author-once agent guidance (you and /bootstrap fill it)
  skills/…                 # portable agent skills (coding-principles, grill-me, write-adr, …)
AGENTS.md  CLAUDE.md  …     # per-agent files, COMPILED from .ai/ — never hand-edit
.claude/settings.json      # Claude Code integration (worktree hooks); merged, never clobbered
docs/…                     # numbered docs tree + design-principles + _adr + gotchas
TODO.md                    # the shared backlog discipline
```

---

## The config — `icculus.toml`

One file teaches the stack-neutral engine about your project. Every slot
defaults to `:` (a no-op that passes), so a fresh install has a **green gate you
grow into**.

### Slots — the stack-specific commands

Each slot is one shell command (chain tools with `&&`). Its `phase` decides when
and how `agent finish` runs it:

| phase      | when                                                      | examples             |
| ---------- | --------------------------------------------------------- | -------------------- |
| `fix`      | first, parallel with `build`; **mutating**                | formatter, codemod   |
| `build`    | parallel with `fix`; produces artifacts later phases read | compile, bundle      |
| `check`    | after fix+build, parallel with `test`; **read-only**      | linter, type-checker |
| `test`     | parallel with `check`                                     | the test suite       |
| `coverage` | on demand via `agent finish:coverage` (slow)              | coverage measurement |

`agent finish` runs `fix∥build → check∥test → side-gates → merge-check`.
`agent tidy` is the fast inner loop: `fix` then `check`, no build or tests.

**Worked example — how `icculus` wires _itself_ (a Deno project):**

```toml
[slots.format]
phase = "fix"
run   = "deno fmt"

[slots.lint]
phase = "check"
run   = "deno lint"

[slots.typecheck]
phase = "check"
run   = "deno check src/main.ts"

[slots.test]
phase = "test"
run   = "deno task test"
```

With those four slots filled, `agent finish` formats, lints, type-checks, and
runs the suite in this exact parallel phase shape. (This repo is gated exactly
this way — see _Dogfooding_ below.)

### Scopes — what a change touches

The gate uses scopes to skip irrelevant work (a docs-only change runs no side
gate and gets no preview) and to fire **side gates** only when their area
changed. Classification **fails open**: a path matching nothing counts as real
code, so unknowns run _more_ gates, never fewer.

```toml
[scopes]
neutral     = ["docs/", ".ai/", ".claude/"]   # no gate needed
web         = ["src/**", "app/**"]            # real, gated code
previewable = ["public/**"]                   # a person could see it

[scopes.side_gates]
# native = "make -C native check"   # run this when a `native` scope changes
```

A **side gate** is how a sub-component with its own self-contained gate plugs
into `agent finish` (the monorepo / sub-project story). The fired gates — those
whose scope the branch changed — run with the **same model as the slot phases**:
every fired gate runs concurrently, output is grouped and labelled
`side:<scope>`, and a single failure fails the gate (all gates still run, so you
see every failure at once).

### Worktree adapters — the two seams

Worktree git mechanics are generic; the **database** and **dev-server** steps
are empty by default. Fill them to give each worktree its own isolated database
and a live dev URL:

```toml
[worktree]
inherit_env = ["APP_KEY"]   # secrets copied from main's .env into a new worktree's .env
port        = true          # deterministic per-worktree dev port

[worktree.db]
clone = "createdb -T {{project_slug}}_template {{db}}"
drop  = "dropdb --if-exists {{db}}"

[worktree.dev_server]
link   = "your-tool link {{site}} {{dir}}"
unlink = "your-tool unlink {{site}}"

[worktree.setup]
steps = ["npm ci", "npm run build"]   # run once after a worktree is created
```

Adapter command tokens, substituted before the command runs: `{{db}}` (worktree
DB name), `{{site}}` (derived site name), `{{port}}` (derived dev port),
`{{project_slug}}`, `{{dir}}` (worktree root). An empty adapter command is a
clean no-op.

### Ratchets & evidence

A **ratchet** is a number you only ever want to improve. `coverage_min` is the
built-in: a floor enforced by `agent finish:coverage`, which fails if coverage
drops below it _or_ if the floor is lower than on `main` (so it only ever
rises).

```toml
[ratchets]
coverage_min = 0.0          # never-lower floor, enforced by `agent finish:coverage`

[evidence]
enabled = false             # optionally require per-branch work evidence before finish
```

**Named metric ratchets** generalise that to any number — lint/type-error
counts, bundle size, a perf budget, type-coverage. A slot reports a metric by
printing a line `ICCULUS_METRIC <name> <number>` (last wins); a
`[ratchets.<name>]` table sets the floor/ceiling. `agent finish:ratchets` holds
them all (slow; on demand, like `finish:coverage`).

```toml
[slots.bundlesize]
phase = "coverage"          # the on-demand phase, so a normal finish won't run it
run   = "printf 'ICCULUS_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""

[ratchets.bundle]
metric    = "bundle_bytes"
direction = "down"          # "down" = value should fall; limit is a ceiling
                            # "up"   = value should rise; limit is a floor (like coverage)
limit     = 500000          # compared vs main: a ceiling may only fall, a floor only rise
slot      = "bundlesize"    # the slot whose output emits the metric
```

Each `[ratchets.<name>]` table accepts:

| key         | meaning                                                                                            | default          |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `metric`    | the metric name the slot emits                                                                     | the ratchet name |
| `direction` | `up` (value should rise; `limit` is a **floor**) or `down` (should fall; `limit` is a **ceiling**) | `up`             |
| `limit`     | the floor/ceiling — compared vs `main`, so a floor only rises and a ceiling only falls             | _required_       |
| `slot`      | the `[slots.<name>]` whose output emits the metric                                                 | _required_       |

The metric-emission convention is one line per metric —
`ICCULUS_METRIC <name>
<number>` (the last wins) — so a slot can report several
metrics at once. The coverage ratchet additionally accepts a trailing `NN%` (the
legacy shape). The name `coverage` is reserved for the built-in instance.

### Project recipes — your own `agent` commands

Drop an executable script (with a `# desc:` line) into `.icculus/recipes/` and
it becomes a first-class `agent <name>` command, listed by `agent --help` under
**Project recipes**. This directory is **yours** — never managed, never
refreshed by `icculus upgrade` — so you extend the command surface without
forking the engine.

```toml
[recipes]
dir = ".icculus/recipes"    # where your recipes live (default; point it anywhere)
```

```sh
cat > .icculus/recipes/reset-fixtures <<'SH'
#!/usr/bin/env sh
# desc: reset local fixtures to a known state
. "$ICCULUS_LIB/bootstrap.sh"   # optional: config_get, info/ok/die, run_parallel
heading "Resetting fixtures…"
# ...your commands...
SH
chmod +x .icculus/recipes/reset-fixtures
agent reset-fixtures
```

The **engine always wins** on a name collision: a project recipe named like a
built-in (`finish`, `worktree:exit`, …) is ignored with a warning, so the core
gate can never be redefined by a project file. A recipe run via `agent <name>`
inherits the harness paths, so it can source `"$ICCULUS_LIB/bootstrap.sh"` for
the same `config_get` / `info`·`ok`·`die` / `run_parallel` surface the engine
uses.

---

## Command reference

### `icculus` (the installer)

| command              | does                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`               | scaffold the harness into the cwd (fresh or existing repo). Wizard or `--yes` + flags; `--dry-run`, `--json`, `--force`. Never overwrites a file it can't prove it wrote — see _Managed vs. seed_. |
| `upgrade`            | refresh only **managed** engine files. A managed file you edited is preserved; the new version lands as `<file>.new`.                                                                              |
| `doctor`             | verify the install (manifest, dispatcher, then delegates to `agent doctor`).                                                                                                                       |
| `add-adapter <name>` | overlay a bundled stack adapter (mechanism present; see _Roadmap_).                                                                                                                                |

Global flags: `--json`, `--no-color` (also honours `NO_COLOR` and non-TTY),
`--help`, `--version`.

### `agent` (the installed task runner)

| command                              | does                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `agent finish`                       | the full quality gate. Run before calling any task done. `--json` for a machine-readable report.    |
| `agent tidy`                         | fixers + checks, no build/test — the fast inner loop.                                               |
| `agent test`                         | run the test-phase slots.                                                                           |
| `agent finish:coverage`              | the coverage ratchet (slow; not part of `finish`).                                                  |
| `agent finish:ratchets`              | hold every metric ratchet — coverage + each `[ratchets.<name>]` (slow; not part of `finish`).       |
| `agent worktree:exit`                | graduate this worktree's branch into the main checkout.                                             |
| `agent worktree:teardown` / `:prune` | discard a worktree / sweep stale ones.                                                              |
| `agent guidelines`                   | compile `.ai/guidelines/*` → each agent's file (`AGENTS.md`, `CLAUDE.md`, …) + refresh skill links. |
| `agent doctor`                       | health-check the harness (slots resolve, git worktrees work, …).                                    |

Run `agent --help` for the live list. Recipes are auto-discovered: an adapter's
recipe under `.icculus/engine/` shows up automatically, and so does **your own**
recipe under `.icculus/recipes/` (see _Project recipes_ above) — kept clearly
separate and never touched by `upgrade`.

**Structured gate output.** `agent finish --json` emits a single JSON object on
stdout (human progress goes to stderr) so an agent-driven workflow can consume
the result without scraping:

```json
{
  "ok": true,
  "phases": [{ "name": "check", "status": "ok", "duration_s": 4 }],
  "side_gates": [{ "scope": "native", "status": "skipped", "duration_s": 0 }],
  "scopes_changed": ["web"],
  "failed_stage": null
}
```

`status` is `ok` / `failed` / `noop` per phase; side-gates report `ok` /
`failed` for those that fired and `skipped` for those whose scope didn't change.
`failed_stage` names the stage that failed (or is `null`). Results are per
**phase** (slots within a phase run joined) plus per side-gate.

---

## How it works

- **Auto-discovery, no registries.** `bin/agent` finds the project root (nearest
  `icculus.toml`), then runs `.icculus/engine/<recipe>` (mapping `worktree:exit`
  → `worktree-exit`), falling back to a project recipe under
  `.icculus/recipes/`. Drop a new recipe in and it's available. The installer
  walks `templates/` the same way — nothing hardcodes the file list.
- **Config without a runtime.** The engine reads `icculus.toml` through a tiny
  POSIX `awk` reader (`.icculus/engine/lib/`). No Node, no Deno, no
  jq-the-config at runtime.
- **Managed vs. seed.** `bin/agent`, `.icculus/engine/**`, and `.ai/skills/**`
  are **managed** (kit-owned, refreshed by `upgrade`). They are hash-tracked in
  the manifest, so both `init` and `upgrade` refresh a managed file in place
  **only** when its on-disk bytes still match what the kit last wrote; if you
  edited it — or a same-named file was already there before Icculus — your copy
  is left untouched and the kit's version is written alongside as `<file>.new`
  for you to merge. Everything else — `icculus.toml`, your docs, guidelines,
  `TODO.md` — is **seed**: written once, then yours.
- **Author once, compile everywhere — agent-agnostic.** Write your guidance and
  skills once under `.ai/`; `agent guidelines` compiles them to every agent's
  own instruction file, so one repo can drive Claude Code, Codex, Gemini, and
  others — even several at once — with no divergence. The per-agent copies
  (`CLAUDE.md`, …) are generated and gitignored; `AGENTS.md`, the cross-agent
  standard, is tracked so compiled-guidance changes still surface in review.

---

## Dogfooding

This repository is itself gated by the harness it ships. Running `icculus init`
here and wiring the four Deno slots above yields a green `agent finish` that
runs `deno fmt` ∥ build, then `deno lint` + `deno check` ∥ the test suite — the
same parallel phase shape every installed project gets. The end-to-end install →
gate → worktree round-trip → upgrade flow is exercised by the test suite
(`deno task test`).

---

## Developing the kit

```sh
deno task dev -- init --yes --name Demo   # run the CLI from source
deno task test                            # the CLI test suite
deno fmt && deno lint && deno check src/main.ts
deno task build                           # per-platform binaries → dist/
```

`templates/` **is the source of truth** for everything an installed project
receives — edit there, never in an installed copy. `src/` is the installer.
Adding a new engine recipe? Drop it in `templates/.icculus/engine/` with a
`#!/usr/bin/env sh` shebang and a `# desc:` line; the dispatcher and `--help`
pick it up.

---

## Status & roadmap

Working, verified, and committed:

- ✅ Installer (`init`/`upgrade`/`doctor`/`add-adapter`), single-binary build +
  release pipeline.
- ✅ Stack-neutral gate engine: slots, scopes, **first-class side-gates**
  (parallel / grouped / aggregated), **named metric ratchets**, evidence, and
  **structured `agent finish --json`**.
- ✅ **Project-owned recipes** (`.icculus/recipes/`) — your own `agent`
  commands, unmanaged and never touched by `upgrade`.
- ✅ Worktree harness with database / dev-server / env / port adapter seams.
- ✅ Author-once guidelines compiler + portable skills.
- ✅ Docs / principles / ADR / TODO scaffolding + the `/bootstrap` seeding
  skill.
- ✅ 95 tests covering both the installer (`src/`) and the POSIX engine recipes
  (a scaffold-and-shell-out harness in `tests/engine_*`).

Follow-ups:

- **Bundled stack adapters** (`add-adapter node`, `python`, …): the overlay
  mechanism ships; no adapters are bundled yet. For now, `/bootstrap` detects
  your stack and proposes slot fills directly — usually all you need.
- **Publishing**: the GitHub slug is wired to `jackwh/icculus` (override with
  `ICCULUS_REPO`); wire up the release before distributing.
- **`inherit_env` ordering**: a worktree that relies on `[worktree.inherit_env]`
  needs its `.env` to exist before the inherit step (a db/dev-server adapter or
  a `setup` step typically creates it). Documented in the worktree recipe.

---

## Provenance

The practices here were extracted from a production application's mature
agentic-development harness and generalised: the orchestration is lifted intact,
while the stack-specific pieces — build tools, framework, native targets — are
dropped or pushed behind the slots and adapters above.
