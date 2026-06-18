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

> Working name. `icculus`, the `agent` runner, and `.icculus/` are placeholders
> pending a final name.

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
deno task dev --help             # run without compiling
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
agent                      # the task runner your agent drives (finish, worktree, guidelines, …)
.icculus/
  config.toml              # the one file you edit: slots, scopes, worktree adapters, ratchets
  engine/                  # the generic shell engine (managed — refreshed by `icculus upgrade`)
  recipes/                 # YOUR own agent commands (unmanaged — never upgraded)
  guidelines/<slug>.md     # author-once agent guidance (you and /bootstrap fill it)
  skills/…                 # portable agent skills (bootstrap, write-adr, handoff-worktree, …)
  brief.md                 # what you told init you're building
  manifest.json            # kit version + managed-file hashes
.claude/settings.json      # Claude Code integration (worktree hooks); merged, never clobbered
# created later by /bootstrap, not at init:
AGENTS.md  CLAUDE.md  …     # per-agent files, COMPILED from .icculus/guidelines/ — never hand-edit
docs/…                     # numbered docs tree + design-principles + _adr + gotchas
TODO.md                    # the shared backlog discipline
```

---

## The config — `.icculus/config.toml`

One file teaches the stack-neutral engine about your project. Every slot
defaults to `:` (a no-op that passes), so a fresh install has a **green gate you
grow into**.

### Slots — the stack-specific commands

Each slot is one shell command (chain tools with `&&`). Its `phase` decides when
and how `agent finish` runs it:

| phase   | when                                                      | examples             |
| ------- | --------------------------------------------------------- | -------------------- |
| `fix`   | first, parallel with `build`; **mutating**                | formatter, codemod   |
| `build` | parallel with `fix`; produces artifacts later phases read | compile, bundle      |
| `check` | after fix+build, parallel with `test`; **read-only**      | linter, type-checker |
| `test`  | parallel with `check`                                     | the test suite       |

A slot with **no `phase`** is a _measurement slot_: the gate never runs it; a
ratchet references it to read a metric on demand (see _Ratchets_ below).

`agent finish` runs `fix → build → check∥test → side-gates → merge-check`, with
**each slot as its own tracked step** (the mutating `fix` slots serially, the
rest concurrently within their stage). `agent tidy` is the fast inner loop:
`fix` then `check`, no build or tests.

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
this way — see _Self-hosting_ below.)

### Scopes — what a change touches

The gate uses scopes to skip irrelevant work (a docs-only change runs no side
gate and gets no preview) and to fire **side gates** only when their area
changed. Classification **fails open**: a path matching nothing counts as real
code, so unknowns run _more_ gates, never fewer.

```toml
[scopes]
neutral     = ["docs/", ".icculus/", ".claude/"]   # no gate needed
web         = ["src/**", "app/**"]                 # real, gated code
previewable = ["public/**"]                        # a person could see it

[scopes.side_gates]
# native = "make -C native check"   # run this when a `native` scope changes
```

A **side gate** is how a sub-component with its own self-contained gate plugs
into `agent finish` (the monorepo / sub-project story). The fired gates — those
whose scope the branch changed — run with the **same model as the slot stages**:
concurrently, output grouped and labelled `side:<scope>`, and a single failure
fails the gate. They honour `[gate].fail_fast` (on by default) like the slot
stages; set it `false` to run every fired gate and see all failures at once.

### Worktree adapters — the two seams

Worktree git mechanics are generic; the **database** and **dev-server** steps
are empty by default. Fill them to give each worktree its own isolated database
and a live dev URL:

```toml
[worktree]
inherit_env = ["APP_KEY"]   # secrets copied from main's .env into a new worktree's .env
port        = true          # deterministic per-worktree dev port

[worktree.db]
clone = "createdb -T @project_slug@_template @db@"
drop  = "dropdb --if-exists @db@"

[worktree.dev_server]
link   = "your-tool link @site@ @dir@"
unlink = "your-tool unlink @site@"

[worktree.setup]
steps = ["npm ci", "npm run build"]   # run once after a worktree is created
```

Adapter command **runtime tokens**, expanded per-worktree just before the
command runs: `@db@` (worktree DB name), `@site@` (derived site name), `@port@`
(derived dev port), `@project_slug@`, `@dir@` (worktree root). They use the
`@…@` delimiter — distinct from the installer's `{{…}}` content tokens (already
substituted at `init`), so the two layers never collide. An empty adapter
command is a clean no-op.

### Ratchets & evidence

A **ratchet** is a number you only ever want to improve — line coverage, a
bundle-size budget, a lint/type-error count, a perf budget. Every ratchet is a
`[ratchets.<name>]` table; there is no built-in or special instance (coverage is
just a conventional name). A ratchet fails if the measured value crosses its
`limit`, _or_ if the `limit` is looser than on `main` (so a floor only rises and
a ceiling only falls). `agent ratchets` holds them all — slow, so it runs **on
demand**, not as part of `agent finish`.

A ratchet's `slot` is a **measurement slot**: an ordinary `[slots.<name>]` with
**no `phase`**, so the gate never runs it; the ratchet runs it on demand. The
slot reports its number by printing one line, `ICCULUS_METRIC <name> <number>`
(last wins) — the only way a metric is read, so incidental output never counts.

```toml
# Coverage — keep line coverage at or above a rising floor:
[slots.coverage]
run = "your-coverage-tool"   # must emit: ICCULUS_METRIC coverage <percent>

[ratchets.coverage]
direction = "up"             # "up" = value should rise; limit is a floor
limit     = 80
slot      = "coverage"

# Bundle size — keep an artifact under a falling ceiling:
[slots.bundlesize]
run = "printf 'ICCULUS_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""

[ratchets.bundle]
metric    = "bundle_bytes"
direction = "down"           # "down" = value should fall; limit is a ceiling
limit     = 500000           # compared vs main: a ceiling may only fall, a floor only rise
slot      = "bundlesize"     # the measurement slot whose output emits the metric

[evidence]
enabled = false              # optionally require per-branch work evidence before finish
```

Each `[ratchets.<name>]` table accepts:

| key         | meaning                                                                                            | default          |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `metric`    | the metric name the slot emits                                                                     | the ratchet name |
| `direction` | `up` (value should rise; `limit` is a **floor**) or `down` (should fall; `limit` is a **ceiling**) | `up`             |
| `limit`     | the floor/ceiling — compared vs `main`, so a floor only rises and a ceiling only falls             | _required_       |
| `slot`      | the measurement `[slots.<name>]` whose output emits the metric                                     | _required_       |

A slot can emit several `ICCULUS_METRIC` lines, so one measurement slot can feed
several ratchets.

### Long-running slots — streaming & fail-fast

```toml
[gate]
stream    = false   # stream slot output live, line-prefixed `── <label> │ …`
fail_fast = true    # cancel in-flight siblings the moment one job fails (default)
```

`fail_fast` is **on by default** — an agent-driven gate wants to abort the
moment a job fails (e.g. cancel a slow `test` the instant a parallel `check`
fails) rather than burn wall-clock finishing it. It applies to every parallel
stage, **side gates included**. Set `fail_fast = false` to run every job to
completion and see all failures in one pass. Cancellation is best-effort: a
command's own grandchildren may briefly linger (portable POSIX sh has no atomic
process-tree kill), but the gate aborts promptly.

`stream` is **off by default** (output is buffered and printed grouped once a
stage finishes). Turn it on for live, line-prefixed feedback on slow slots;
concurrent jobs interleave but stay labelled.

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

| command              | does                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init`               | scaffold the harness into the cwd (fresh or existing repo). Wizard, `--yes` + flags, or `--config <file>` (JSON answers file). `--dry-run`, `--json`, `--force`. Never overwrites a file it can't prove it wrote — see _Managed vs. seed_.                                                                                                             |
| `upgrade`            | run any pending schema migrations, then refresh **managed** files: an edited one is preserved as `<file>.new`; one the kit no longer ships is removed if pristine, kept (with a warning) if you edited it. Refuses a dirty tree unless `--allow-dirty`, so an upgrade stays `git checkout`-revertible. See _Schema migrations_ and _Managed vs. seed_. |
| `doctor`             | verify the install (manifest, schema version, dispatcher, then delegates to `agent doctor`).                                                                                                                                                                                                                                                           |
| `migrate`            | report the install's recorded schema and any pending migration steps (read-only); `--check` exits non-zero when steps are pending. `upgrade` applies them. See _Schema migrations_.                                                                                                                                                                    |
| `config <sub>`       | programmatically edit `.icculus/config.toml`, comments intact — `set-slot`, `set-scope`, `set-side-gate`, `set-ratchet`, `set`. See _Driving icculus programmatically_.                                                                                                                                                                                |
| `add-adapter <name>` | overlay an adapter from `adapters/<name>/`: its files **and** its `adapter.json` config fills. Ships no adapters; see _Writing an adapter_.                                                                                                                                                                                                            |
| `docs [target]`      | browse and read the project's `docs/` tree. No target on a terminal opens an interactive, searchable picker; a target renders that doc (paged). Agent/script surfaces never block on a prompt: `--json` (the index, or a single doc's record), `--raw` (pristine Markdown), `--list` (plain table of contents). See _Browsing the docs_.               |

Global flags: `--json`, `--no-color` (also honours `NO_COLOR` and non-TTY),
`--help`, `--version`.

### Browsing the docs

`icculus docs` is a viewer for the `docs/` tree this kit scaffolds — for people
and agents alike, decided by whether it runs at a terminal.

- **Interactive (a terminal, no target).** A searchable picker (type to filter
  the growing tree) opens each doc in a rendered, paged view — headings, lists,
  GFM tables, fenced code, and clickable (OSC-8) links, wrapped to your
  terminal.
- **Direct (a target).** `icculus docs concepts` (a slug),
  `icculus docs 00-orientation/concepts`, or a full path renders that one doc. A
  bare name that is ambiguous (every subtree has a `README`) lists the
  candidates instead of guessing.
- **For agents & scripts.** Output never blocks on a prompt off a TTY. `--json`
  emits a machine-readable index (or, with a target, that doc's record including
  its raw `content`); `--raw` prints the pristine Markdown source; `--list`
  prints a plain table of contents. `--dir <path>` points at a docs tree
  elsewhere; `--no-pager` and `--width <cols>` tune rendering.

It shows the **user-facing** tree only — `_`-prefixed reference directories
(`_adr`, `_internal`) are excluded to keep the command focused. Point `--dir`
straight at one to read it explicitly (`icculus docs --dir docs/_adr`).

```sh
icculus docs                              # browse interactively (searchable)
icculus docs concepts                     # render one doc (paged)
icculus docs concepts --raw               # the pristine Markdown source
icculus docs --json | jq -r '.docs[].path'   # the index, for tooling
```

The renderer is a small, dependency-light Markdown→terminal pass (it owns its
own rendering rather than shelling out), and the browser lives in the `icculus`
binary, so every install gets it for free with nothing added to the shell
harness — see [ADR 0015](docs/_adr/0015-docs-browser.md).

### Schema migrations

Every install records a `schema_version` in its manifest
([ADR 0014](docs/_adr/0014-versioned-migration-system.md)). When a kit release
needs to transform an existing install — rename a file, restructure the config,
evolve a convention — it ships an ordered **migration** step. `icculus upgrade`
runs every step between the install's recorded version and the kit's, **before**
the file sync (a step may move files the sync then reconciles), then stamps the
new version. One command brings an install fully current; steps are idempotent.

```sh
icculus upgrade          # run pending migrations, then refresh managed files
icculus migrate          # read-only: show the recorded schema and any pending steps
icculus migrate --check  # exit non-zero if migrations are pending (a CI signal)
```

The current schema is **3**. The chain has two steps: `1 → 2` backfills
`[project].main_branch` for installs whose config predates that field, and
`2 → 3` consolidates the install surface under `.icculus/` (the root `agent`,
`.icculus/config.toml`, `.icculus/guidelines`, `.icculus/skills`) — the very
move this layout shipped, carried to existing installs by the chain rather than
a manual cleanup. A current install reports nothing pending. (1.0 was a clean
break with no automated 0.x path; the bespoke 0.x→1.0 `migrate` that
[ADR 0009](docs/_adr/0009-one-point-zero-drop-backward-compat.md) shipped was
retired in favour of this versioned chain — see ADR 0014.)

### Driving icculus programmatically

A scaffolder or CI can drive icculus declaratively, without hand-editing TOML.
`icculus config` makes **comment-preserving** edits to an existing
`.icculus/config.toml` (every subcommand honours `--json` and `--dry-run`):

```sh
icculus config set-slot test --phase test --run "vitest run"
icculus config set-slot bundlesize --run "wc -c < dist/app.js"   # no --phase: a measurement slot
icculus config set-scope native 'native/**' 'native/lib/**'
icculus config set-side-gate native --run "make -C native check"
icculus config set-ratchet bundle --limit 500000 --direction down --slot bundlesize
icculus config set project.main_branch trunk          # type inferred; --string/--number/--bool to force
```

Each finds `.icculus/config.toml` in the cwd, applies the edit (preserving
comments and layout), and writes it back. Light validation matches `doctor`
(slot `--phase` ∈ the known phases, or omit it for a measurement slot; ratchet
`--direction` ∈ `up`/`down`, and `--slot` is required). `coverage` is an
ordinary ratchet name.

To drive a **fresh** install in one shot, `init --config <file>` reads an
**icculus config document** — a JSON file (or `--config -` for stdin) — and
scaffolds non-interactively. Base fields mirror the flags; `slots` / `scopes` /
`side_gates` / `ratchets` are written into the generated `.icculus/config.toml`.
Explicit flags override file values.

```json
{
  "$schema": "https://raw.githubusercontent.com/jackwh/icculus/main/schema/icculus-config.schema.json",
  "version": "1",
  "name": "My App",
  "slug": "my-app",
  "source_globs": ["src/**"],
  "slots": { "test": { "phase": "test", "run": "vitest run" } },
  "scopes": { "native": ["native/**"] },
  "side_gates": { "native": "make -C native check" },
  "ratchets": {
    "coverage": { "direction": "up", "limit": 80, "slot": "coverage" },
    "bundle": { "direction": "down", "limit": 500000, "slot": "bundlesize" }
  }
}
```

```sh
icculus init --config answers.json        # or:  cat answers.json | icculus init --config -
```

The document shape is a **published contract**: a JSON Schema ships at
[`schema/icculus-config.schema.json`](schema/icculus-config.schema.json) — point
your file's `$schema` at it for editor validation. An optional `version` lets
the shape evolve safely (this is version `1`); a document declaring a major this
build doesn't understand is refused rather than misread. The same document is
what an adapter's `adapter.json` carries (below).

### Writing an adapter

An **adapter** packages a reusable overlay so the same stack layer can be
applied to many projects with one command. `icculus add-adapter <name>` reads
`adapters/<name>/` and overlays:

- **Files** — everything in the adapter dir is scaffolded onto the project with
  the same rules as `init`: seed files (project recipes, guideline fragments,
  docs) are write-once; managed files (`.icculus/skills/**`) follow the
  hash-aware overwrite/`.new` rule; `.claude/settings.json` deep-merges.
- **Config fills** — an optional `adapter.json` at the adapter root (metadata,
  never scaffolded) is an **icculus config document** (the same shape
  `init --config` reads, validated against the same schema) whose `slots` /
  `scopes` / `side_gates` / `ratchets` are written into the project's
  `.icculus/config.toml` via the comment-preserving editor.

```
adapters/my-stack/
  adapter.json                          # an icculus config document (+ "description")
  .icculus/recipes/deploy               # a project recipe (seed)
  .icculus/guidelines/my-stack.md       # a guideline fragment (seed)
  .icculus/skills/my-skill/SKILL.md     # a skill (managed)
```

`add-adapter` honours `--json` and `--dry-run`. The kit **bundles no adapters**
(stack-neutral); a single project layering its own stack usually just uses
`init --config` / `config` (above). A worked fake example lives at
`tests/fixtures/adapters/example/`.

### `agent` (the installed task runner)

| command                              | does                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `agent finish`                       | the full quality gate. Run before calling any task done. `--json` for a machine-readable report.         |
| `agent tidy`                         | fixers + checks, no build/test — the fast inner loop.                                                    |
| `agent test`                         | run the test-phase slots.                                                                                |
| `agent ratchets`                     | hold every metric ratchet — each `[ratchets.<name>]` (slow; not part of `finish`).                       |
| `agent worktree:exit`                | graduate this worktree's branch into the main checkout.                                                  |
| `agent worktree:teardown` / `:prune` | discard a worktree / sweep stale ones.                                                                   |
| `agent guidelines`                   | compile `.icculus/guidelines/*` → each agent's file (`AGENTS.md`, `CLAUDE.md`, …) + refresh skill links. |
| `agent doctor`                       | health-check the harness (slots resolve, git worktrees work, …).                                         |

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
  "slots": [
    { "name": "lint", "phase": "check", "status": "ok", "duration_s": 4 }
  ],
  "side_gates": [{ "scope": "native", "status": "skipped", "duration_s": 0 }],
  "scopes_changed": ["web"],
  "failed_stage": null
}
```

Each `[slots.<name>]` runs as its own tracked job, so results are reported **per
slot** (`{name, phase, status, duration_s}`): `status` is `ok` / `failed` /
`noop` (a no-op slot) / `skipped` (a real slot whose stage aborted before it
ran). Side-gates report `ok` / `failed` for those that fired and `skipped` for
those whose scope didn't change. `failed_stage` names the stage that failed (or
is `null`).

---

## How it works

- **Auto-discovery, no registries.** `agent` finds the project root (nearest
  `.icculus/config.toml`), then runs `.icculus/engine/<recipe>` (mapping
  `worktree:exit` → `worktree-exit`), falling back to a project recipe under
  `.icculus/recipes/`. Drop a new recipe in and it's available. The installer
  walks `templates/` the same way — nothing hardcodes the file list.
- **Config without a runtime.** The engine reads `.icculus/config.toml` through
  a tiny POSIX `awk` reader (`.icculus/engine/lib/`). No Node, no Deno, no
  jq-the-config at runtime.
- **Managed vs. seed.** `agent`, `.icculus/engine/**`, and `.icculus/skills/**`
  are **managed** (kit-owned, refreshed by `upgrade`) — the set is **declared in
  `templates/managed.json`**, not hardcoded, so it's visible from the template
  tree and an adapter can mark overlay files it owns. Managed files are
  hash-tracked in the manifest, so both `init` and `upgrade` refresh one in
  place **only** when its on-disk bytes still match what the kit last wrote; if
  you edited it — or a same-named file was already there before Icculus — your
  copy is left untouched and the kit's version is written alongside as
  `<file>.new` for you to merge. A managed file the kit _stops_ shipping is
  removed on upgrade when it's still pristine (kept, with a warning, if you
  edited it), so renames and removals reach installs cleanly rather than leaving
  orphans behind. Everything else — `.icculus/config.toml`, your docs,
  guidelines, `TODO.md` — is **seed**: written once, then yours.
- **Author once, compile everywhere — agent-agnostic.** Write your guidance and
  skills once under `.icculus/`; `agent guidelines` compiles them to every
  agent's own instruction file, so one repo can drive Claude Code, Codex,
  Gemini, and others — even several at once — with no divergence. The per-agent
  copies (`CLAUDE.md`, …) are generated and gitignored; `AGENTS.md`, the
  cross-agent standard, is tracked so compiled-guidance changes still surface in
  review.

---

## Self-hosting

This repository **is installed with its own harness** — icculus develops on the
same kit it ships, running on its own harness. `icculus init` was run at the
root, so the root `agent`, the `.icculus/` engine, and the `.icculus/skills`
live here as a committed copy of `templates/`. The repo's day-to-day quality
gate is `agent finish` itself (see
[ADR 0010](docs/_adr/0010-self-host-the-harness.md)):

```sh
./agent finish   # deno fmt (fix) → deno lint + deno check + deno task selfcheck (check) ∥ deno task test (test)
./agent tidy     # the fast inner loop: fix + check, no tests
```

**`templates/` is the source of truth; the root install is a managed mirror of
it.** A `selfcheck` gate slot (≡ `icculus upgrade --check`, exposed as
`deno task selfcheck`) fails the gate if any _managed_ file — the root `agent`,
`.icculus/engine/**`, `.icculus/skills/**` — drifts from `templates/`. Heal it
with `deno task selfsync` (≡ `icculus upgrade`), which propagates `templates/` →
the install. So the golden rule is: to change the engine, a recipe, or a shipped
skill, **edit `templates/` and run `deno task selfsync`** — never the root copy.
Everything else `init` wrote (`.icculus/config.toml`, `docs/`,
`.icculus/guidelines/`, `TODO.md`) is _seed_: yours to edit directly, never
distributed.

The installer↔install lifecycle — `init` → `finish` → `upgrade` (drift detection
and healing included) — is also exercised hermetically by the test suite
(`deno task test` scaffolds the real `templates/` into temp dirs and shells out
to the root `agent`), so a `templates/` change is validated whether or not the
root install is synced yet. CI runs the same gate (`agent finish`) on every push
and PR.

---

## Developing the kit

```sh
deno task dev init --yes --name Demo      # run the CLI from source
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
- ✅ Declarative config — `icculus config` + `init --config` (comment-preserving
  programmatic edits), and a documented `add-adapter` contract (file overlay +
  config fills).
- ✅ **Docs browser** (`icculus docs`) — an interactive, searchable viewer with
  a dependency-light terminal Markdown renderer, plus agent-facing
  `--json`/`--raw`/`--list` surfaces (ADR 0015).
- ✅ 465 tests covering both the installer (`src/`) and the POSIX engine recipes
  (a scaffold-and-shell-out harness in `tests/engine_*`), with `src/` line
  coverage held at a rising floor by `[ratchets.coverage]` (enforced on every
  PR).

Follow-ups:

- **Bundled stack adapters** (`add-adapter node`, `python`, …): the adapter
  contract is complete and documented (see _Writing an adapter_), but no adapter
  is bundled yet — that stays stack-neutral. For now, `/bootstrap` detects your
  stack and proposes slot fills directly, or drive it with `init --config`.
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
