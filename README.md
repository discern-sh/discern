# `discern`

Machines write the code now. **`discern` is where your judgment still lives**.

---

Coding agents can turn out days of work in minutes.

But trusting them, or getting their work safely into a shared codebase? That part never sped up.

`discern` solves this problem:

1. **Point as many agents at a problem as you want**. Each one works in its own sealed copy, so they never trip over each other and you never untangle a mess two of them made at once.
2. **Switch between agents whenever you like**. A single source-of-truth ensures they all treat your codebase predictably.
3. **Stop babysitting and let them run**. When they're finished, you'll have a regression-proof change that not only passes every test, but improves coverage too.

Nothing reaches `main` until it clears the same standards you'd hold a person to:

* `discern` doesn't write code, run a model, or require API keys.
* It works with all the agents you already use.
* It works with whatever language you already write.

`discern` is the layer that keeps a human in charge of the work the machines increasingly do.

And it's been built with care, by a human who shares all the same doubts as you about shipping code nobody understands.

`discern` automates the hard parts correctly – leaving you with more time to *build*, and less time to *babysit*. 

---

**[`discern`](https://discern.sh) is a portable agentic-development harness you can drop into any project, in one
command.**

`discern` scaffolds a small, opinionated set of safety rails for working with
coding agents — a compound quality gate, an isolated git-worktree workflow, an
author-once → compile-everywhere agent-instruction pipeline, and a documentation
/ principles / ADR / TODO discipline — into any repository, in any language, for
any coding agent. The orchestration is stack-neutral; the few stack-specific
commands live behind named **capabilities** in a single config file you fill in
(or let your own coding agent propose). Guidance is authored once and compiled
to each agent's own file, so Claude Code, Codex, Gemini, and others can work in
the same repo — even several at once. The entire footprint in your project is
**one root file, `discern.toml`** — everything else is bundled in the binary or
written out by it.

---

## The idea

**You declare what your project can do — format, lint, typecheck, test, build —
once.** `discern` turns those declarations into the rails — a gate, isolated
worktrees, agent guidance — that every agent works within. The engine never
learns your stack; it only runs your capabilities.

Everything fits in **four layers**:

1. **The gate — your definition of done.** _Capabilities_ (the commands above),
   _scopes_ (which part of the repo a change touches, each able to carry its own
   sub-gate), and _ratchets_ (numbers that may only improve).
2. **The workspace — isolated worktrees.** A throwaway `git worktree` per
   change, plus _worktree settings_ (a per-worktree database, dev-server, env,
   port) so agents never collide in your main checkout.
3. **The agent surface — what agents read and run.** _Guidance_ (always-on,
   compiled to each agent's file), _skills_ (on-demand), and _recipes_ (your own
   `discern` verbs). Each is the binary's built-in set ⊕ your own additions at a
   config-pointed path, yours overriding a built-in of the same name.
4. **The ownership model — who owns what.** **Yours** — `discern.toml` and the
   files you opt into (`guidance.md`, `skills/`, `recipes/`), written by you and
   never touched by `upgrade` — vs. **the binary's** (the bundled engine,
   guidance, and skills, plus the gitignored artifacts it re-publishes: the
   materialized skills and the compiled agent files, always safe to overwrite),
   with _presets_ layering a reusable stack on top.

A separate **`[features]`** switchboard toggles whole subsystems (worktrees,
ratchets, guidance, skills, docs) on or off — distinct from the capabilities of
layer 1.

---

## Why

A good agentic workflow needs the same rails on every project: one command that
fixes-builds-checks-tests before work is called done; throwaway worktrees so an
agent can't trample your main checkout; agent guidance written once and compiled
to every agent's file; and a docs/decision discipline that keeps context from
rotting. Re-deriving those rails per project is wasteful and they drift.
`discern` extracts the proven version of them (lifted from a production
codebase) and makes them installable and upgradable — without assuming your
language, test runner, or build tool.

The engine doesn't know what a test _is_. It runs "the test capability." You
tell it the command once.

---

## Install

**Single binary (recommended)** — no runtime needed:

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

This downloads the right prebuilt binary for your OS/arch from the latest GitHub
release and installs it to `~/.local/bin` (or `/usr/local/bin`).

**From source** (requires [Deno](https://deno.com)):

```sh
git clone https://github.com/jackwh/discern && cd discern
deno task dev --help             # run without compiling
deno task build                  # compile per-platform binaries → dist/
```

The engine is **compiled into the `discern` binary** — the target project keeps
only the root `discern.toml` (plus whatever guidance, skills, and recipes you
opt into), and never needs Deno. macOS and Linux are supported; Windows needs
WSL.

---

## Quickstart

```sh
cd your-project              # fresh or existing repo (git required)
discern init                 # walk the wizard — name, slug, what you're building
# → ask your coding agent to run:
discern bootstrap            # fills principles/docs/guidance + proposes capability fills
discern bootstrap done       # validate and record that setup is complete
# day to day:
discern prepare              # fast inner loop: fixers + checks, no build/test
discern finish               # full definition-of-done gate
discern graduate             # graduate the isolated worktree branch back for review
discern refresh              # refresh generated agent files/skills/integration artifacts
```

`init` writes a single `discern.toml`, compiles the agent files, and
materializes the bundled skills into `.claude/skills/`; it **merges** into an
existing `.claude/settings.json` rather than clobbering it. Nothing of yours
appears until you opt in — `guidance.md`, a `skills/` dir, a `recipes/` dir
surface in the open as you fill them. `discern bootstrap` is a command that has
_your own_ coding agent author the project-specific content and sniff the repo
to propose the capability fills — no API key, no provider lock-in.

---

## What gets installed

A fresh `discern init` lands **one file you own**, plus the generated agent
files and the two integration files:

```
discern.toml               # the one file you edit: features, capabilities, checks, scopes, worktree settings, ratchets, guidance/skills/recipes pointers
AGENTS.md                  # cross-agent guidance, COMPILED from the built-ins + your sources — TRACKED, never hand-edit
CLAUDE.md                  # Claude Code's copy of the same — gitignored
.claude/
  settings.json            # Claude Code integration (worktree hooks); merged, never clobbered
  skills/…                 # the materialized skill set (gitignored): built-ins copied, yours symlinked
.gitignore                 # appended fragment (ignores the binary's re-published artifacts)
```

As you opt in, **your** files appear in the open at paths you control (the
defaults shown):

```
guidance.md                # author-once agent guidance (you and `discern bootstrap` fill it); [guidance].sources
skills/…                   # YOUR authored skills — yours override a built-in of the same name; [skills].dir
recipes/…                  # YOUR own discern commands (the dir is yours); [recipes].dir
brief.md                   # what you told init you're building (captured only when non-empty)
# also grown by discern bootstrap:
docs/…                     # numbered docs tree + design-principles + _adr + gotchas
TODO.md                    # the shared backlog discipline
```

The engine, the built-in harness guidance, and the built-in skills all live
**inside the `discern` binary** on your `PATH` — none of them land on disk.
There is no longer a hidden `.discern/` directory: the whole footprint is the
single `discern.toml` plus the files above.

---

## The config — `discern.toml`

One root file teaches the stack-neutral engine about your project. You declare
what the project can do; an omitted capability is simply **knowably absent**, so
a fresh install with nothing wired is still a **green gate you grow into**
(nothing to run passes) — and `discern doctor` reports which capabilities are
filled.

### Features — which subsystems are on

`[features]` is a switchboard over whole subsystems — `worktrees`, `ratchets`,
`guidance`, `skills`, `docs` — **each default `true`**. Set one to `false` and
that feature vanishes coherently: its verbs disappear from `--help` (and error
"feature disabled" if invoked), its built-in guidance section is omitted from
the compiled agent files, its hooks aren't written into `.claude/settings.json`,
and `discern doctor` skips its checks. The gate, `config`, and `doctor` are core
and always on, so they aren't listed here.

```toml
[features]
worktrees = true   # the isolated git-worktree workflow (worktree / worktree:* verbs)
ratchets  = true   # never-loosen metric floors (the `ratchets` verb)
guidance  = true   # compile agent files from built-in + your sources
skills    = true   # bundled + authored skills, materialized into .claude/skills/
docs      = true   # the `docs` browser over your docs/ tree
```

> A **feature** is not a **capability**. `[features]` toggles subsystems on and
> off; `[capabilities]` (below) is the gate's command table (format / build /
> lint / typecheck / test). Different sections, different jobs — don't conflate
> them.

### Capabilities — what your project can do

`[capabilities]` is a small, **closed** vocabulary of the five things a project
gate cares about. Each is one line — a capability name mapped to a command (or
an array of commands run in order). The engine **derives the gate stage** from
the name, so you never write a scheduling keyword:

| capability  | derived stage | runs when                                  | examples           |
| ----------- | ------------- | ------------------------------------------ | ------------------ |
| `format`    | fix           | first, serial, **mutating**                | formatter, codemod |
| `build`     | build         | parallel with fix; produces read artifacts | compile, bundle    |
| `lint`      | check         | after fix+build, parallel with test        | linter             |
| `typecheck` | check         | after fix+build, parallel with test        | type-checker       |
| `test`      | test          | parallel with the checks                   | the test suite     |

The set is **closed**: an unknown key under `[capabilities]` is an error that
points you at `[checks]` (below). There is no `:` no-op anymore — **omit** a
capability you don't have and the gate simply skips it.

`discern finish` runs `fix → build → check∥test → scope-gates → merge-check`,
with **each capability (and check) as its own tracked job** (the mutating
fix-stage work serially, the rest concurrently within their stage).
`discern
prepare` is the fast inner loop: the fix-stage then the check-stage
capabilities, no build or tests.

**Worked example — how `discern` wires _itself_ (a Deno project):**

```toml
[capabilities]
format    = "deno fmt"
lint      = "deno lint"
typecheck = "deno check src/main.ts"
test      = "deno task test"
```

With those four capabilities filled, `discern finish` formats, lints,
type-checks, and runs the suite in this exact parallel stage shape. (This repo
is gated exactly this way — see _Self-hosting_ below.)

### Checks — custom gate work

Anything **outside** the five known capabilities — a project-specific gate step
the engine has no opinion about — is a `[checks.<name>]`. Because the engine
can't derive a stage from an unknown name, you state it: `stage` (required —
`fix` / `build` / `check` / `test`), `run` (the command, or a list), and an
optional free-text `provides` label for an audit/readiness report.

A project-specific gate step — say a license audit, or a schema validation the
engine has no opinion about — is the real-world escape hatch:

```toml
[checks.licenses]
stage    = "check"
run      = "./scripts/check-licenses.sh"
provides = "license-audit"

[checks.schema]
stage = "check"
run   = "./scripts/validate-schema.sh"
```

A check runs as its own labelled job, in its declared stage, exactly like a
capability — the only difference is that you supplied the stage.

### Scopes — what a change touches

A scope is a named region of the repo: a `[scopes.<name>]` table with `paths`
(the globs that define it) plus optional attributes. The gate uses scopes to
skip irrelevant work (a docs-only change runs no sub-gate and gets no preview)
and to fire a scope's own **`gate`** only when that scope changed.
Classification **fails open**: a path matching nothing counts as real code, so
unknowns run _more_ gates, never fewer.

```toml
[scopes.docs]
paths   = ["docs/", ".claude/", "skills/"]     # changes here need no gate
neutral = true

[scopes.assets]
paths       = ["public/**"]                    # a person could see it
previewable = true

[scopes.native]
paths = ["native/**"]
gate  = "make -C native check"                 # run this when `native` changed
```

Each scope table accepts: `neutral = true` (changes here need no gate),
`previewable = true` (a person could see them — worth a preview link), and
`gate = "..."` — a command (the **former "side gate"**) that `discern finish`
runs only when that scope changed, the way a sub-component with its own
self-contained gate plugs into the gate (the monorepo / sub-project story).
There are no reserved scope names: a path matching no scope is real, gated code
by default.

The fired `gate`s — those whose scope the branch changed — run with the **same
model as the capability stages**: concurrently, output grouped and labelled
`scope:<name>`, and a single failure fails the gate. They honour
`[gate].fail_fast` (on by default) like the capability stages; set it `false` to
run every fired gate and see all failures at once.

### Guidance — author once, compile everywhere

Your always-on agent guidance lives in **`guidance.md`** at the root — the
default `[guidance].sources` (globs allowed; read only if present). discern's
own built-in harness guidance is bundled in the binary and **always prepended**,
feature-aware (a disabled feature drops its section), so your file is purely
additive. `discern refresh` compiles `[built-in] + [your sources]` into **one
generated file per provider** named in `[guidance].agents` — never hand-edit the
outputs.

```toml
[guidance]
sources = ["guidance.md"]                   # your source(s), relative to root; globs allowed
agents  = ["claude_code", "codex"]          # which provider files to emit
```

The provider → file map: `claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`,
`gemini` → `GEMINI.md`. **`AGENTS.md` is the one tracked agent file**
(generated, carrying a banner that says so — never hand-edit it), so
compiled-guidance changes still surface in review; every other mirror is
gitignored.

### Skills — bundled built-ins ⊕ yours

The effective skill set is discern's **bundled built-ins** (in the binary) plus
**your authored skills** under `[skills].dir` (default `./skills`), where yours
**override a built-in of the same name**. discern materializes the set into
`.claude/skills/` (gitignored): built-ins are **copied**, your authored skills
are **symlinked**, so edits to yours are live.

```toml
[skills]
dir = "skills"   # where your authored skills live (default; read only if present)
```

Manage the set with the new command group: `discern skills list` shows the
effective set and which of yours override which; `discern skills eject <name>`
copies a built-in into `[skills].dir` so you can customize it.

### Worktree settings — the two seams

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

Worktree-command **runtime tokens**, expanded per-worktree just before the
command runs: `@db@` (worktree DB name), `@site@` (derived site name), `@port@`
(derived dev port), `@project_slug@`, `@dir@` (worktree root). They use the
`@…@` delimiter — distinct from the installer's `{{…}}` content tokens (already
substituted at `init`), so the two layers never collide. An empty worktree
command is a clean no-op.

### Ratchets

A **ratchet** is a number you only ever want to improve — line coverage, a
bundle-size budget, a lint/type-error count, a perf budget. Every ratchet is a
`[ratchets.<name>]` table; there is no built-in or special instance (coverage is
just a conventional name). A ratchet fails if the measured value crosses its
`limit`, _or_ if the `limit` is looser than on `main` (so a floor only rises and
a ceiling only falls). `discern ratchets` holds them all — slow, so it runs **on
demand**, not as part of `discern finish`.

Each ratchet **inlines its own `run`** — the command that measures it. That
command reports its number by printing one line,
`DISCERN_METRIC <metric>
<number>` (last wins) — the only way a metric is read,
so incidental output never counts.

```toml
# Coverage — keep line coverage at or above a rising floor:
[ratchets.coverage]
direction = "up"             # "up" = value should rise; limit is a floor
limit     = 80
run       = "your-coverage-tool"   # must emit: DISCERN_METRIC coverage <percent>

# Bundle size — keep an artifact under a falling ceiling:
[ratchets.bundle]
metric    = "bundle_bytes"
direction = "down"           # "down" = value should fall; limit is a ceiling
limit     = 500000           # compared vs main: a ceiling may only fall, a floor only rise
run       = "printf 'DISCERN_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""
```

Each `[ratchets.<name>]` table accepts:

| key         | meaning                                                                                            | default          |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `metric`    | the metric name the `run` emits                                                                    | the ratchet name |
| `direction` | `up` (value should rise; `limit` is a **floor**) or `down` (should fall; `limit` is a **ceiling**) | `up`             |
| `limit`     | the floor/ceiling — compared vs `main`, so a floor only rises and a ceiling only falls             | _required_       |
| `run`       | the command that measures it — its output emits the `DISCERN_METRIC` line                          | _required_       |

A `run` can emit several `DISCERN_METRIC` lines, so one command can feed several
ratchets.

### Long-running jobs — streaming & fail-fast

```toml
[gate]
stream    = false   # stream job output live, line-prefixed `── <label> │ …`
fail_fast = true    # cancel in-flight siblings the moment one job fails (default)
```

`fail_fast` is **on by default** — an agent-driven gate wants to abort the
moment a job fails (e.g. cancel a slow `test` the instant a parallel `check`
fails) rather than burn wall-clock finishing it. It applies to every parallel
stage, **scope gates included**. Set `fail_fast = false` to run every job to
completion and see all failures in one pass. Cancellation kills each job's whole
process group (the engine spawns jobs detached and signals the group), so an
in-flight sibling and its children are torn down promptly.

`stream` is **off by default** (output is buffered and printed grouped once a
stage finishes). Turn it on for live, line-prefixed feedback on slow jobs;
concurrent jobs interleave but stay labelled.

### Project recipes — your own `discern` commands

Drop an executable script (with a `# desc:` line) into `./recipes/` and it
becomes a first-class `discern <name>` command, listed by `discern --help` under
**Project recipes**. This directory is **yours** — written once, never touched
by `discern upgrade` — so you extend the command surface without forking the
engine.

```toml
[recipes]
dir = "recipes"    # where your recipes live (default; point it anywhere, e.g. "tools/")
```

A recipe is a language-agnostic executable: the binary execs the match on an
unknown verb with the `DISCERN_*` environment exported. It reads config via the
`discern config get|array|has|subsections|keys` surface and worktree identity
via `discern worktree-name --db|--site|--port` — no shell library to source.

```sh
cat > recipes/reset-fixtures <<'SH'
#!/usr/bin/env sh
# desc: reset local fixtures to a known state
db=$(discern config get worktree.db.clone)   # read config without parsing TOML
echo "Resetting fixtures…"
# ...your commands...
SH
chmod +x recipes/reset-fixtures
discern reset-fixtures
```

The **engine always wins** on a name collision: a project recipe named like a
built-in (`finish`, `graduate`, …) is ignored with a warning, so the core gate
can never be redefined by a project file.

---

## Command reference

### `discern` (the installer)

| command             | does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`              | scaffold `discern.toml` into the cwd (fresh or existing repo), compile the agent files, and materialize the bundled skills. Wizard, `--yes` + flags, or `--config <file>` (JSON answers file). `--dry-run`, `--json`, `--force`. Never overwrites a file you already have — see _Yours vs. the binary's_.                                                                                                                                                                                       |
| `upgrade`           | refresh the project to match the installed binary: run any pending config-schema migrations → re-materialize the bundled skills → recompile guidance → stamp `[meta].schema_version`. Refuses a dirty tree unless `--allow-dirty`, so an upgrade stays `git checkout`-revertible. `--dry-run`, `--json`, `--check` (config migrations pending?). Getting a _newer binary_ is a separate axis (`install.sh` / `brew upgrade`). See _Upgrading an existing install_ and _Yours vs. the binary's_. |
| `doctor`            | verify the install: the config parses, the schema is current (`[meta].schema_version` vs the binary), every `[capabilities]` key is known, and capability/check commands resolve on `PATH`. Skips checks for any disabled `[features]`.                                                                                                                                                                                                                                                         |
| `migrate`           | report the install's recorded `[meta].schema_version` and any pending config-schema migration steps (read-only); `--check` exits non-zero when steps are pending. `upgrade` applies them. See _Schema migrations_.                                                                                                                                                                                                                                                                              |
| `config <sub>`      | programmatically edit `discern.toml`, comments intact — `set-capability`, `set-check`, `set-scope`, `set-ratchet`, `set`. See _Driving discern programmatically_.                                                                                                                                                                                                                                                                                                                               |
| `skills <sub>`      | manage the effective skill set — `list` (built-ins + yours, showing overrides), `eject <name>` (copy a built-in into `[skills].dir` to customize it). See _Skills_.                                                                                                                                                                                                                                                                                                                             |
| `add-preset <name>` | overlay a preset from `presets/<name>/`: its files **and** its `preset.json` config fills. Ships no presets; see _Writing a preset_.                                                                                                                                                                                                                                                                                                                                                            |
| `docs [target]`     | browse and read the project's `docs/` tree. No target on a terminal opens an interactive, searchable picker; a target renders that doc (paged). Agent/script surfaces never block on a prompt: `--json` (the index, or a single doc's record), `--raw` (pristine Markdown), `--list` (plain table of contents). See _Browsing the docs_.                                                                                                                                                        |

Global flags: `--json`, `--no-color` (also honours `NO_COLOR` and non-TTY),
`--help`, `--version`.

### Browsing the docs

`discern docs` is a viewer for the `docs/` tree this kit scaffolds — for people
and agents alike, decided by whether it runs at a terminal.

- **Interactive (a terminal, no target).** A searchable picker (type to filter
  the growing tree) opens each doc in a rendered, paged view — headings, lists,
  GFM tables, fenced code, and clickable (OSC-8) links, wrapped to your
  terminal.
- **Direct (a target).** `discern docs concepts` (a slug),
  `discern docs 00-orientation/concepts`, or a full path renders that one doc. A
  bare name that is ambiguous (every subtree has a `README`) lists the
  candidates instead of guessing.
- **For agents & scripts.** Output never blocks on a prompt off a TTY. `--json`
  emits a machine-readable index (or, with a target, that doc's record including
  its raw `content`); `--raw` prints the pristine Markdown source; `--list`
  prints a plain table of contents. `--dir <path>` points at a docs tree
  elsewhere; `--no-pager` and `--width <cols>` tune rendering.

It shows the **user-facing** tree only — `_`-prefixed reference directories
(`_adr`, `_internal`) are excluded to keep the command focused. Point `--dir`
straight at one to read it explicitly (`discern docs --dir docs/_adr`).

```sh
discern docs                              # browse interactively (searchable)
discern docs concepts                     # render one doc (paged)
discern docs concepts --raw               # the pristine Markdown source
discern docs --json | jq -r '.docs[].path'   # the index, for tooling
```

The renderer is a small, dependency-light Markdown→terminal pass (it owns its
own rendering rather than shelling out), and the browser lives in the `discern`
binary, so every install gets it for free with nothing added to the project —
see [ADR 0015](docs/_adr/0015-docs-browser.md).

### Schema migrations

Every install records a `[meta].schema_version` in its config
([ADR 0014](docs/_adr/0014-versioned-migration-system.md)). When a release needs
to transform an existing install — restructure the config, prune a retired file,
evolve a convention — it ships an ordered **migration** step. `discern upgrade`
runs every step between the install's recorded version and the binary's,
**before** it re-materializes skills and recompiles guidance, then stamps the
new version. One command brings an install fully current; steps are idempotent.

```sh
discern upgrade          # run pending migrations, re-materialize skills, recompile guidance
discern migrate          # read-only: show the recorded schema and any pending steps
discern migrate --check  # exit non-zero if migrations are pending (a CI signal)
```

The current schema is **6**. The chain: `1 → 2` backfills
`[project].main_branch` for installs whose config predates that field; `2 → 3`
consolidates the install surface under `.discern/`; `3 → 4` converts
`[slots]`→`[capabilities]`/`[checks]`, inlines each ratchet's `run`, folds
side-gates into a scope's `gate`, and drops `[evidence]`
([ADR 0017](docs/_adr/0017-capabilities-model.md),
[ADR 0018](docs/_adr/0018-vocabulary-consolidation.md)); `4 → 5` prunes a
pre-existing on-disk shell engine (the retired `agent` dispatcher and
`.discern/engine/**`) from an upgrading install
([ADR 0019](docs/_adr/0019-single-binary-ts-engine.md)); and `5 → 6` **dissolves
`.discern/`** — it moves the config to the root `discern.toml`, your guidance to
`guidance.md`, recipes to `./recipes/`, and your **authored** skills to
`./skills/` (pristine bundled copies are pruned), adds the `[features]` /
`[guidance]` / `[skills]` sections, and deletes the now-empty `.discern/`
([ADR 0020](docs/_adr/0020-dissolve-discern-dir.md)). Each move is carried to
existing installs by the chain rather than a manual cleanup. A current install
reports nothing pending. (1.0 was a clean break with no automated 0.x path; the
bespoke 0.x→1.0 `migrate` that
[ADR 0009](docs/_adr/0009-one-point-zero-drop-backward-compat.md) shipped was
retired in favour of this versioned chain — see ADR 0014.)

### Upgrading an existing install

Run `discern upgrade` — it brings the install to the current schema. For 5→6 it
dissolves `.discern/` automatically: your config moves to `discern.toml`,
guidance to `guidance.md`, recipes to `./recipes/`, and any **authored** skills
are split out to `./skills/` (pristine bundled copies are pruned). Then review
the moved files and commit. If you keep your own kit of skills, note they move
from `.discern/skills/` to `./skills/`. Recipes that sourced the retired shell
library must be rewritten as standalone executables (read config via
`discern config get`) — `discern doctor` flags any that still do.

### Driving discern programmatically

A scaffolder or CI can drive discern declaratively, without hand-editing TOML.
`discern config` makes **comment-preserving** edits to an existing
`discern.toml` (every subcommand honours `--json` and `--dry-run`):

```sh
discern config set-capability test "vitest run"               # a known capability; stage is derived
discern config set-check licenses --stage check --run "./scripts/check-licenses.sh" --provides license-audit
discern config set-scope native 'native/**' 'native/lib/**' --gate "make -C native check"
discern config set-ratchet bundle --limit 500000 --direction down --run "wc -c < dist/app.js"
discern config set project.main_branch trunk          # type inferred; --string/--number/--bool to force
```

Each finds `discern.toml` in the cwd, applies the edit (preserving comments and
layout), and writes it back. Light validation matches `doctor` (`set-capability`
name ∈ the five known capabilities; `set-check` `--stage` ∈
`fix`/`build`/`check`/`test`; ratchet `--direction` ∈ `up`/`down`, and `--run`
is required). `coverage` is an ordinary ratchet name.

To drive a **fresh** install in one shot, `init --config <file>` reads an
**discern config document** — a JSON file (or `--config -` for stdin) — and
scaffolds non-interactively. Base fields mirror the flags; `capabilities` /
`checks` / `scopes` / `ratchets` are written into the generated `discern.toml`.
Explicit flags override file values.

```json
{
  "$schema": "https://raw.githubusercontent.com/jackwh/discern/main/schema/discern-config.schema.json",
  "version": "2",
  "name": "My App",
  "slug": "my-app",
  "source_globs": ["src/**"],
  "capabilities": { "test": "vitest run", "lint": "eslint ." },
  "checks": {
    "licenses": { "stage": "check", "run": "./scripts/check-licenses.sh" }
  },
  "scopes": {
    "native": { "paths": ["native/**"], "gate": "make -C native check" }
  },
  "ratchets": {
    "coverage": { "direction": "up", "limit": 80, "run": "your-coverage-tool" },
    "bundle": {
      "direction": "down",
      "limit": 500000,
      "run": "wc -c < dist/app.js"
    }
  }
}
```

```sh
discern init --config answers.json        # or:  cat answers.json | discern init --config -
```

The document shape is a **published contract**: a JSON Schema ships at
[`schema/discern-config.schema.json`](schema/discern-config.schema.json) — point
your file's `$schema` at it for editor validation. An optional `version` lets
the shape evolve safely (this is version `2`); a document declaring a major this
build doesn't understand is refused rather than misread. The same document is
what a preset's `preset.json` carries (below).

### Writing a preset

A **preset** packages a reusable overlay so the same stack layer can be applied
to many projects with one command. `discern add-preset <name>` reads
`presets/<name>/` and overlays:

- **Files** — everything in the preset dir is scaffolded onto the project with
  the same rules as `init`: your files (project recipes, guideline fragments,
  docs) are write-once; `.claude/settings.json` deep-merges.
- **Config fills** — an optional `preset.json` at the preset root (metadata,
  never scaffolded) is an **discern config document** (the same shape
  `init --config` reads, validated against the same schema) whose `capabilities`
  / `checks` / `scopes` / `ratchets` are written into the project's
  `discern.toml` via the comment-preserving editor.

```
presets/my-stack/
  preset.json                  # a discern config document (+ "description")
  recipes/deploy               # a project recipe (yours)
  guidance.md                  # a guidance fragment (yours)
```

`add-preset` honours `--json` and `--dry-run`. The kit **bundles no presets**
(stack-neutral); a single project layering its own stack usually just uses
`init --config` / `config` (above). A worked fake example lives at
`tests/fixtures/presets/example/`.

### `discern` (the engine verbs)

The former engine recipes are first-class `discern` subcommands — the same
binary that scaffolds also runs the gate and the worktree lifecycle:

| command                                | does                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern finish`                       | the full quality gate. Run before calling any task done. `--json` for a machine-readable report.                                                                                                  |
| `discern prepare`                      | fixers + checks, no build/test — the fast inner loop.                                                                                                                                             |
| `discern test`                         | run the `test` capability.                                                                                                                                                                        |
| `discern ratchets`                     | hold every metric ratchet — each `[ratchets.<name>]` (slow; not part of `finish`).                                                                                                                |
| `discern graduate`                     | graduate this worktree's branch into the main checkout.                                                                                                                                           |
| `discern worktree:teardown` / `:prune` | discard a worktree / sweep stale ones.                                                                                                                                                            |
| `discern refresh`                      | regenerate the agent files, skills, and integration artifacts — compiles built-in guidance + your `[guidance].sources` → each agent's file (`AGENTS.md`, `CLAUDE.md`, …) + refreshes skill links. |

`worktree:ensure`, `worktree-name`, and `changed-scopes` round out the set (the
worktree hooks call them). Run `discern --help` for the live list — it also
lists **your own** recipes under `[recipes].dir` (`./recipes` by default; see
_Project recipes_ above), kept clearly separate and never touched by `upgrade`.
The list reflects your `[features]`, too: a disabled feature's verbs are hidden.

**Structured gate output.** `discern finish --json` emits a single JSON object
on stdout (human progress goes to stderr) so an agent-driven workflow can
consume the result without scraping:

```json
{
  "ok": true,
  "jobs": [
    {
      "name": "lint",
      "kind": "capability",
      "stage": "check",
      "status": "ok",
      "duration_s": 4
    },
    {
      "name": "licenses",
      "kind": "check",
      "stage": "check",
      "status": "ok",
      "duration_s": 2
    }
  ],
  "scope_gates": [{ "scope": "native", "status": "skipped", "duration_s": 0 }],
  "scopes_changed": ["code"],
  "failed_stage": null
}
```

Each capability and check runs as its own tracked job, so results are reported
**per capability/check** (`{name, kind, stage, status, duration_s}`, with `kind`
∈ `capability` / `check`): `status` is `ok` / `failed` / `skipped` (a job whose
stage aborted before it ran). A no-op gate (nothing wired) reports an empty
`jobs` array. Scope gates report `ok` / `failed` for those that fired and
`skipped` for those whose scope didn't change. `failed_stage` names the stage
that failed (or is `null`).

---

## How it works

- **Auto-discovery, no registries.** `discern` finds the project root (nearest
  `discern.toml`), dispatches a built-in verb to the compiled-in engine, and on
  an unknown verb execs the matching project recipe under `[recipes].dir`
  (`./recipes` by default; a built-in always wins, warning on a same-named
  recipe). Drop a new recipe in and it's available — nothing hardcodes the file
  list.
- **One binary, no runtime in the project.** The engine is TypeScript compiled
  into the `discern` binary (`src/engine/**`), so the project carries only the
  root `discern.toml` — no Node, no Deno, no shell engine on disk. The runtime
  config reader is `@std/toml`; recipes that need a value call
  `discern config
  get` rather than parsing TOML themselves.
- **Bundled built-ins ⊕ yours.** Guidance, skills, and recipes follow one rule:
  the binary ships a built-in set, and you extend or override it at a
  config-pointed path (`[guidance].sources`, `[skills].dir`, `[recipes].dir`),
  yours winning on a name collision. Nothing of yours is hidden in a dotfolder.
- **Yours vs. the binary's.** Ownership is two buckets. **Yours** —
  `discern.toml`, `guidance.md`, your `skills/` and `recipes/`, the brief, docs,
  `TODO.md`, the merged `.claude/settings.json` — is written by you, then never
  touched: `upgrade` leaves it alone. **The binary's** — the bundled engine,
  guidance, and skills, plus the artifacts it re-publishes: the materialized
  `.claude/skills/` (built-ins copied, your authored skills symlinked into
  `[skills].dir`) and the compiled `CLAUDE.md`/`GEMINI.md` — is gitignored and
  always safe to overwrite, so `upgrade` simply re-publishes it. (`AGENTS.md` is
  the one tracked compiled file.) No directory is ever
  part-tracked/part-ignored: `[skills].dir` is 100% yours, `.claude/skills/` is
  100% generated. The engine is the limit case of "the binary's" — not even on
  disk. There is no managed-file machinery: no content hashes, no `.new` files,
  no orphan reconciliation, no drift detection.
- **Author once, compile everywhere — agent-agnostic.** Write your guidance in
  `guidance.md` and your skills under `[skills].dir`; discern prepends its
  always-on built-in harness guidance and `discern refresh` compiles the result
  to every agent's own instruction file, so one repo can drive Claude Code,
  Codex, Gemini, and others — even several at once — with no divergence. The
  per-agent copies (`CLAUDE.md`, …) are generated and gitignored; `AGENTS.md`,
  the cross-agent standard, is tracked so compiled-guidance changes still
  surface in review.

---

## Self-hosting

This repository **runs on its own harness** — discern develops on the same
engine it ships. `discern init` was run at the root, so its own config and
authored content (`discern.toml`, `guidance.md`, …) live here. Because the
engine is compiled into the binary rather than committed, there is **no second
copy and nothing to drift** — the repo runs its own engine straight from source
via the `gate` task in `deno.json`:

```sh
deno task dev finish   # deno fmt (fix) → deno lint + deno check (check) ∥ deno task test (test)
deno task dev prepare  # the fast inner loop: fix + check, no tests
```

(`deno task dev` is `deno run -A src/main.ts`, so this is the same code path a
released `discern finish` takes — just from source. ADR 0019 records the
cutover; it supersedes [ADR 0010](docs/_adr/0010-self-host-the-harness.md),
whose drift-detection guard is now moot.) Everything `init` wrote and everything
since (`discern.toml`, `guidance.md`, `docs/`, `TODO.md`) is _yours_: edited in
place, never distributed.

The installer↔install lifecycle — `init` → `finish` → `upgrade` — is also
exercised hermetically by the test suite (`deno task test` scaffolds a fresh
install into temp dirs and drives the engine), so an engine change is validated
directly. CI runs the same gate (`deno task dev finish`) on every push and PR.

---

## Developing the kit

```sh
deno task dev init --yes --name Demo      # run the CLI from source
deno task test                            # the CLI test suite
deno fmt && deno lint && deno check src/main.ts
deno task build                           # per-platform binaries → dist/
```

`src/` is the whole tool: the installer (`init`/`upgrade`/`doctor`/…) and the
engine (`src/engine/**`, sharing `src/shared/**`) compiled into one binary.
`templates/` holds only the **seed and built-in files bundled into the binary**
— the `discern.toml` template, the gitignore fragment, the always-on harness
`guidance/`, and the built-in `skills/` materialized at `init`/`upgrade` — not
an engine. Adding an engine verb? Wire it in `src/engine/dispatch.ts` (the
dispatcher) and add its module under `src/engine/**`; `--help` picks it up.

---

## Status & roadmap

Working, verified, and committed:

- ✅ Installer (`init`/`upgrade`/`doctor`/`add-preset`), single-binary build +
  release pipeline.
- ✅ **Single-file footprint** — the whole install is one root `discern.toml`
  (schema 6), with `[features]` toggling whole subsystems on/off (ADR 0020).
- ✅ Stack-neutral gate engine: capabilities, checks, scopes (with gates),
  **named metric ratchets**, and **structured `discern finish --json`**.
- ✅ **Project-owned recipes** (`./recipes/`) — your own `discern` commands,
  written once and never touched by `upgrade`.
- ✅ Worktree harness with database / dev-server / env / port worktree settings.
- ✅ Author-once guidance compiler (built-in ⊕ your `guidance.md`) + a
  bundled-plus-authored skill set (`discern skills list`/`eject`).
- ✅ Docs / principles / ADR / TODO scaffolding + the `discern bootstrap`
  seeding command.
- ✅ Declarative config — `discern config` + `init --config` (comment-preserving
  programmatic edits), and a documented `add-preset` contract (file overlay +
  config fills).
- ✅ **Docs browser** (`discern docs`) — an interactive, searchable viewer with
  a dependency-light terminal Markdown renderer, plus agent-facing
  `--json`/`--raw`/`--list` surfaces (ADR 0015).
- ✅ A wide test suite covering both the installer and the TypeScript engine
  (`src/engine/**`), including hermetic scaffold-and-run harnesses in
  `tests/engine_*`, with `src/` line coverage held at a rising floor by
  `[ratchets.coverage]` (enforced on every PR).

Follow-ups:

- **Bundled stack presets** (`add-preset node`, `python`, …): the preset
  contract is complete and documented (see _Writing a preset_), but no preset is
  bundled yet — that stays stack-neutral. For now, `discern bootstrap` detects
  your stack and proposes capability fills directly, or drive it with
  `init --config`.
- **Publishing**: the GitHub slug is wired to `jackwh/discern` (override with
  `DISCERN_REPO`); wire up the release before distributing.
- **`inherit_env` ordering**: a worktree that relies on `[worktree.inherit_env]`
  needs its `.env` to exist before the inherit step (a db/dev-server setting or
  a `setup` step typically creates it). Documented in the worktree recipe.

---

## Provenance

The practices here were extracted from a production application's mature
agentic-development harness and generalised: the orchestration is lifted intact,
while the stack-specific pieces — build tools, framework, native targets — are
dropped or pushed behind the capabilities, checks, and worktree settings above.
