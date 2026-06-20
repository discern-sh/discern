# icculus

**A portable agentic-development harness you can drop into any project, in one
command.**

`icculus` scaffolds a small, opinionated set of safety rails for working with
coding agents — a compound quality gate, an isolated git-worktree workflow, an
author-once → compile-everywhere agent-instruction pipeline, and a documentation
/ principles / ADR / TODO discipline — into any repository, in any language, for
any coding agent. The orchestration is stack-neutral; the few stack-specific
commands live behind named **capabilities** in a single config file you fill in
(or let your own coding agent propose). Guidance is authored once and compiled
to each agent's own file, so Claude Code, Codex, Gemini, and others can work in
the same repo — even several at once.

> Working name. `icculus` and `.icculus/` are placeholders pending a final name.

---

## The idea

**You declare what your project can do — format, lint, typecheck, test, build —
once.** Icculus turns those declarations into the rails — a gate, isolated
worktrees, agent guidance — that every agent works within. The engine never
learns your stack; it only runs your capabilities.

Everything fits in **four layers**:

1. **The gate — your definition of done.** _Capabilities_ (the commands above),
   _scopes_ (which part of the repo a change touches, each able to carry its own
   sub-gate), and _ratchets_ (numbers that may only improve).
2. **The workspace — isolated worktrees.** A throwaway `git worktree` per
   change, plus _worktree settings_ (a per-worktree database, dev-server, env,
   port) so agents never collide in your main checkout.
3. **The agent surface — what agents read and run.** _Guidelines_ (always-on,
   compiled to each agent's file), _skills_ (on-demand), and _recipes_ (your own
   `icculus` verbs).
4. **The ownership model — who owns what.** **Yours** (committed seed files,
   written once then never touched) vs. **the binary's** (gitignored,
   re-published artifacts — skills and the compiled agent files, always safe to
   overwrite), with _presets_ layering a reusable stack on top.

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

The engine doesn't know what a test _is_. It runs "the test capability." You
tell it the command once.

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

The engine is **compiled into the `icculus` binary** — the target project keeps
only a TOML config and its own seed files, and never needs Deno. macOS and Linux
are supported; Windows needs WSL.

---

## Quickstart

```sh
cd your-project              # fresh or existing repo (git required)
icculus init                 # walk the wizard — name, slug, what you're building
# → in your coding agent:
/bootstrap                   # fills principles/docs/guidelines + proposes capability fills
# day to day:
icculus finish               # the full quality gate — run before calling work done
icculus worktree:exit        # graduate a worktree's branch back to main for review
```

`init` writes your seed files and materializes the bundled skills; it **merges**
into an existing `.claude/settings.json` rather than clobbering it. `/bootstrap`
is a shipped skill that has _your own_ coding agent author the project-specific
content and sniff the repo to propose the capability fills — no API key, no
provider lock-in.

---

## What gets installed

```
.icculus/
  config.toml              # the one file you edit: capabilities, checks, scopes, worktree settings, ratchets
  guidelines/<slug>.md     # author-once agent guidance (you and /bootstrap fill it)
  brief.md                 # what you told init you're building
  recipes/README.md        # how to drop in YOUR own icculus commands (the dir is yours)
  skills/…                 # portable agent skills, materialized from the binary (gitignored)
.claude/
  settings.json            # Claude Code integration (worktree hooks); merged, never clobbered
  skills/…                 # symlinks → ../../.icculus/skills/<skill> (gitignored)
.gitignore                 # appended fragment (ignores the binary's re-published artifacts)
# created later by /bootstrap, not at init:
AGENTS.md  CLAUDE.md  …     # per-agent files, COMPILED from .icculus/guidelines/ — never hand-edit
docs/…                     # numbered docs tree + design-principles + _adr + gotchas
TODO.md                    # the shared backlog discipline
```

The engine itself never lands on disk — it is compiled into the `icculus` binary
on your `PATH`.

---

## The config — `.icculus/config.toml`

One file teaches the stack-neutral engine about your project. You declare what
the project can do; an omitted capability is simply **knowably absent**, so a
fresh install with nothing wired is still a **green gate you grow into**
(nothing to run passes) — and `icculus doctor` reports which capabilities are
filled.

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

`icculus finish` runs `fix → build → check∥test → scope-gates → merge-check`,
with **each capability (and check) as its own tracked job** (the mutating
fix-stage work serially, the rest concurrently within their stage).
`icculus
tidy` is the fast inner loop: the fix-stage then the check-stage
capabilities, no build or tests.

**Worked example — how `icculus` wires _itself_ (a Deno project):**

```toml
[capabilities]
format    = "deno fmt"
lint      = "deno lint"
typecheck = "deno check src/main.ts"
test      = "deno task test"
```

With those four capabilities filled, `icculus finish` formats, lints,
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
paths   = ["docs/", ".icculus/", ".claude/"]   # changes here need no gate
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
`gate = "..."` — a command (the **former "side gate"**) that `icculus finish`
runs only when that scope changed, the way a sub-component with its own
self-contained gate plugs into the gate (the monorepo / sub-project story).
There are no reserved scope names: a path matching no scope is real, gated code
by default.

The fired `gate`s — those whose scope the branch changed — run with the **same
model as the capability stages**: concurrently, output grouped and labelled
`scope:<name>`, and a single failure fails the gate. They honour
`[gate].fail_fast` (on by default) like the capability stages; set it `false` to
run every fired gate and see all failures at once.

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
a ceiling only falls). `icculus ratchets` holds them all — slow, so it runs **on
demand**, not as part of `icculus finish`.

Each ratchet **inlines its own `run`** — the command that measures it. That
command reports its number by printing one line,
`ICCULUS_METRIC <metric>
<number>` (last wins) — the only way a metric is read,
so incidental output never counts.

```toml
# Coverage — keep line coverage at or above a rising floor:
[ratchets.coverage]
direction = "up"             # "up" = value should rise; limit is a floor
limit     = 80
run       = "your-coverage-tool"   # must emit: ICCULUS_METRIC coverage <percent>

# Bundle size — keep an artifact under a falling ceiling:
[ratchets.bundle]
metric    = "bundle_bytes"
direction = "down"           # "down" = value should fall; limit is a ceiling
limit     = 500000           # compared vs main: a ceiling may only fall, a floor only rise
run       = "printf 'ICCULUS_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""
```

Each `[ratchets.<name>]` table accepts:

| key         | meaning                                                                                            | default          |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `metric`    | the metric name the `run` emits                                                                    | the ratchet name |
| `direction` | `up` (value should rise; `limit` is a **floor**) or `down` (should fall; `limit` is a **ceiling**) | `up`             |
| `limit`     | the floor/ceiling — compared vs `main`, so a floor only rises and a ceiling only falls             | _required_       |
| `run`       | the command that measures it — its output emits the `ICCULUS_METRIC` line                          | _required_       |

A `run` can emit several `ICCULUS_METRIC` lines, so one command can feed several
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

### Project recipes — your own `icculus` commands

Drop an executable script (with a `# desc:` line) into `.icculus/recipes/` and
it becomes a first-class `icculus <name>` command, listed by `icculus --help`
under **Project recipes**. This directory is **yours** — written once, never
touched by `icculus upgrade` — so you extend the command surface without forking
the engine.

```toml
[recipes]
dir = ".icculus/recipes"    # where your recipes live (default; point it anywhere)
```

A recipe is a language-agnostic executable: the binary execs the match on an
unknown verb with the `ICCULUS_*` environment exported. It reads config via the
`icculus config get|array|has|subsections|keys` surface and worktree identity
via `icculus worktree-name --db|--site|--port` — no shell library to source.

```sh
cat > .icculus/recipes/reset-fixtures <<'SH'
#!/usr/bin/env sh
# desc: reset local fixtures to a known state
db=$(icculus config get worktree.db.clone)   # read config without parsing TOML
echo "Resetting fixtures…"
# ...your commands...
SH
chmod +x .icculus/recipes/reset-fixtures
icculus reset-fixtures
```

The **engine always wins** on a name collision: a project recipe named like a
built-in (`finish`, `worktree:exit`, …) is ignored with a warning, so the core
gate can never be redefined by a project file.

---

## Command reference

### `icculus` (the installer)

| command             | does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`              | scaffold your seed files into the cwd (fresh or existing repo) and materialize the bundled skills. Wizard, `--yes` + flags, or `--config <file>` (JSON answers file). `--dry-run`, `--json`, `--force`. Never overwrites a seed file you already have — see _Yours vs. the binary's_.                                                                                                                                                                                                 |
| `upgrade`           | refresh the project to match the installed binary: run any pending config-schema migrations → re-materialize the bundled skills → recompile guidelines → stamp `[meta].schema_version`. Refuses a dirty tree unless `--allow-dirty`, so an upgrade stays `git checkout`-revertible. `--dry-run`, `--json`, `--check` (config migrations pending?). Getting a _newer binary_ is a separate axis (`install.sh` / `brew upgrade`). See _Schema migrations_ and _Yours vs. the binary's_. |
| `doctor`            | verify the install: the config parses, the schema is current (`[meta].schema_version` vs the binary), every `[capabilities]` key is known, and capability/check commands resolve on `PATH`.                                                                                                                                                                                                                                                                                           |
| `migrate`           | report the install's recorded `[meta].schema_version` and any pending config-schema migration steps (read-only); `--check` exits non-zero when steps are pending. `upgrade` applies them. See _Schema migrations_.                                                                                                                                                                                                                                                                    |
| `config <sub>`      | programmatically edit `.icculus/config.toml`, comments intact — `set-capability`, `set-check`, `set-scope`, `set-ratchet`, `set`. See _Driving icculus programmatically_.                                                                                                                                                                                                                                                                                                             |
| `add-preset <name>` | overlay a preset from `presets/<name>/`: its files **and** its `preset.json` config fills. Ships no presets; see _Writing a preset_.                                                                                                                                                                                                                                                                                                                                                  |
| `docs [target]`     | browse and read the project's `docs/` tree. No target on a terminal opens an interactive, searchable picker; a target renders that doc (paged). Agent/script surfaces never block on a prompt: `--json` (the index, or a single doc's record), `--raw` (pristine Markdown), `--list` (plain table of contents). See _Browsing the docs_.                                                                                                                                              |

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
binary, so every install gets it for free with nothing added to the project —
see [ADR 0015](docs/_adr/0015-docs-browser.md).

### Schema migrations

Every install records a `[meta].schema_version` in its config
([ADR 0014](docs/_adr/0014-versioned-migration-system.md)). When a release needs
to transform an existing install — restructure the config, prune a retired file,
evolve a convention — it ships an ordered **migration** step. `icculus upgrade`
runs every step between the install's recorded version and the binary's,
**before** it re-materializes skills and recompiles guidelines, then stamps the
new version. One command brings an install fully current; steps are idempotent.

```sh
icculus upgrade          # run pending migrations, re-materialize skills, recompile guidelines
icculus migrate          # read-only: show the recorded schema and any pending steps
icculus migrate --check  # exit non-zero if migrations are pending (a CI signal)
```

The current schema is **5**. The chain: `1 → 2` backfills
`[project].main_branch` for installs whose config predates that field; `2 → 3`
consolidates the install surface under `.icculus/`; `3 → 4` converts
`[slots]`→`[capabilities]`/`[checks]`, inlines each ratchet's `run`, folds
side-gates into a scope's `gate`, and drops `[evidence]`
([ADR 0017](docs/_adr/0017-capabilities-model.md),
[ADR 0018](docs/_adr/0018-vocabulary-consolidation.md)); and `4 → 5` prunes a
pre-existing on-disk shell engine (the retired `agent` dispatcher and
`.icculus/engine/**`) from an upgrading install
([ADR 0019](docs/_adr/0019-single-binary-ts-engine.md)) — each move carried to
existing installs by the chain rather than a manual cleanup. A current install
reports nothing pending. (1.0 was a clean break with no automated 0.x path; the
bespoke 0.x→1.0 `migrate` that
[ADR 0009](docs/_adr/0009-one-point-zero-drop-backward-compat.md) shipped was
retired in favour of this versioned chain — see ADR 0014.)

### Driving icculus programmatically

A scaffolder or CI can drive icculus declaratively, without hand-editing TOML.
`icculus config` makes **comment-preserving** edits to an existing
`.icculus/config.toml` (every subcommand honours `--json` and `--dry-run`):

```sh
icculus config set-capability test "vitest run"               # a known capability; stage is derived
icculus config set-check licenses --stage check --run "./scripts/check-licenses.sh" --provides license-audit
icculus config set-scope native 'native/**' 'native/lib/**' --gate "make -C native check"
icculus config set-ratchet bundle --limit 500000 --direction down --run "wc -c < dist/app.js"
icculus config set project.main_branch trunk          # type inferred; --string/--number/--bool to force
```

Each finds `.icculus/config.toml` in the cwd, applies the edit (preserving
comments and layout), and writes it back. Light validation matches `doctor`
(`set-capability` name ∈ the five known capabilities; `set-check` `--stage` ∈
`fix`/`build`/`check`/`test`; ratchet `--direction` ∈ `up`/`down`, and `--run`
is required). `coverage` is an ordinary ratchet name.

To drive a **fresh** install in one shot, `init --config <file>` reads an
**icculus config document** — a JSON file (or `--config -` for stdin) — and
scaffolds non-interactively. Base fields mirror the flags; `capabilities` /
`checks` / `scopes` / `ratchets` are written into the generated
`.icculus/config.toml`. Explicit flags override file values.

```json
{
  "$schema": "https://raw.githubusercontent.com/jackwh/icculus/main/schema/icculus-config.schema.json",
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
icculus init --config answers.json        # or:  cat answers.json | icculus init --config -
```

The document shape is a **published contract**: a JSON Schema ships at
[`schema/icculus-config.schema.json`](schema/icculus-config.schema.json) — point
your file's `$schema` at it for editor validation. An optional `version` lets
the shape evolve safely (this is version `2`); a document declaring a major this
build doesn't understand is refused rather than misread. The same document is
what a preset's `preset.json` carries (below).

### Writing a preset

A **preset** packages a reusable overlay so the same stack layer can be applied
to many projects with one command. `icculus add-preset <name>` reads
`presets/<name>/` and overlays:

- **Files** — everything in the preset dir is scaffolded onto the project with
  the same rules as `init`: your files (project recipes, guideline fragments,
  docs) are write-once; `.claude/settings.json` deep-merges.
- **Config fills** — an optional `preset.json` at the preset root (metadata,
  never scaffolded) is an **icculus config document** (the same shape
  `init --config` reads, validated against the same schema) whose `capabilities`
  / `checks` / `scopes` / `ratchets` are written into the project's
  `.icculus/config.toml` via the comment-preserving editor.

```
presets/my-stack/
  preset.json                           # an icculus config document (+ "description")
  .icculus/recipes/deploy               # a project recipe (yours)
  .icculus/guidelines/my-stack.md       # a guideline fragment (yours)
```

`add-preset` honours `--json` and `--dry-run`. The kit **bundles no presets**
(stack-neutral); a single project layering its own stack usually just uses
`init --config` / `config` (above). A worked fake example lives at
`tests/fixtures/presets/example/`.

### `icculus` (the engine verbs)

The former engine recipes are first-class `icculus` subcommands — the same
binary that scaffolds also runs the gate and the worktree lifecycle:

| command                                | does                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `icculus finish`                       | the full quality gate. Run before calling any task done. `--json` for a machine-readable report.         |
| `icculus tidy`                         | fixers + checks, no build/test — the fast inner loop.                                                    |
| `icculus test`                         | run the `test` capability.                                                                               |
| `icculus ratchets`                     | hold every metric ratchet — each `[ratchets.<name>]` (slow; not part of `finish`).                       |
| `icculus worktree:exit`                | graduate this worktree's branch into the main checkout.                                                  |
| `icculus worktree:teardown` / `:prune` | discard a worktree / sweep stale ones.                                                                   |
| `icculus guidelines`                   | compile `.icculus/guidelines/*` → each agent's file (`AGENTS.md`, `CLAUDE.md`, …) + refresh skill links. |

`worktree:ensure`, `worktree-name`, and `changed-scopes` round out the set (the
worktree hooks call them). Run `icculus --help` for the live list — it also
lists **your own** recipe under `.icculus/recipes/` (see _Project recipes_
above), kept clearly separate and never touched by `upgrade`.

**Structured gate output.** `icculus finish --json` emits a single JSON object
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

- **Auto-discovery, no registries.** `icculus` finds the project root (nearest
  `.icculus/config.toml`), dispatches a built-in verb to the compiled-in engine,
  and on an unknown verb execs the matching project recipe under
  `.icculus/recipes/` (a built-in always wins, warning on a same-named recipe).
  Drop a new recipe in and it's available — nothing hardcodes the file list.
- **One binary, no runtime in the project.** The engine is TypeScript compiled
  into the `icculus` binary (`src/engine/**`), so the project carries only a
  TOML config — no Node, no Deno, no shell engine on disk. The runtime config
  reader is `@std/toml`; recipes that need a value call `icculus config get`
  rather than parsing TOML themselves.
- **Yours vs. the binary's.** Ownership is two buckets. **Yours** —
  `.icculus/config.toml`, your guidelines, brief, recipes, docs, `TODO.md`, the
  merged `.claude/settings.json` — is written once at `init`, then never
  touched: `upgrade` leaves it alone. **The binary's** — the materialized skills
  under `.icculus/skills/**`, their `.claude/skills/**` symlinks, and the
  compiled `CLAUDE.md`/`AGENTS.md` — is gitignored and always safe to overwrite,
  so `upgrade` simply re-publishes it from the bundled copy. (A real,
  non-symlink `.claude/skills/<name>` directory of your own is left alone.) The
  engine is the limit case of "the binary's" — not even on disk. There is no
  managed-file machinery: no content hashes, no `.new` files, no orphan
  reconciliation, no drift detection.
- **Author once, compile everywhere — agent-agnostic.** Write your guidance and
  skills once under `.icculus/`; `icculus guidelines` compiles them to every
  agent's own instruction file, so one repo can drive Claude Code, Codex,
  Gemini, and others — even several at once — with no divergence. The per-agent
  copies (`CLAUDE.md`, …) are generated and gitignored; `AGENTS.md`, the
  cross-agent standard, is tracked so compiled-guidance changes still surface in
  review.

---

## Self-hosting

This repository **runs on its own harness** — icculus develops on the same
engine it ships. `icculus init` was run at the root, so its own seed files
(`.icculus/config.toml`, `.icculus/guidelines/`, …) live here. Because the
engine is compiled into the binary rather than committed, there is **no second
copy and nothing to drift** — the repo runs its own engine straight from source
via the `gate` task in `deno.json`:

```sh
deno task dev finish   # deno fmt (fix) → deno lint + deno check (check) ∥ deno task test (test)
deno task dev tidy     # the fast inner loop: fix + check, no tests
```

(`deno task dev` is `deno run -A src/main.ts`, so this is the same code path a
released `icculus finish` takes — just from source. ADR 0019 records the
cutover; it supersedes [ADR 0010](docs/_adr/0010-self-host-the-harness.md),
whose drift-detection guard is now moot.) Everything `init` wrote
(`.icculus/config.toml`, `docs/`, `.icculus/guidelines/`, `TODO.md`) is _yours_:
edited in place, never distributed.

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
`templates/` holds only the **seed and skill files bundled into the binary** —
the config template, guidelines stub, brief, recipes README, settings template,
gitignore fragment, and the `skills/` materialized at `init`/`upgrade` — not an
engine. Adding an engine verb? Wire it in `src/engine/dispatch.ts` (the
dispatcher) and add its module under `src/engine/**`; `--help` picks it up.

---

## Status & roadmap

Working, verified, and committed:

- ✅ Installer (`init`/`upgrade`/`doctor`/`add-preset`), single-binary build +
  release pipeline.
- ✅ Stack-neutral gate engine: capabilities, checks, scopes (with gates),
  **named metric ratchets**, and **structured `icculus finish --json`**.
- ✅ **Project-owned recipes** (`.icculus/recipes/`) — your own `icculus`
  commands, written once and never touched by `upgrade`.
- ✅ Worktree harness with database / dev-server / env / port worktree settings.
- ✅ Author-once guidelines compiler + portable skills.
- ✅ Docs / principles / ADR / TODO scaffolding + the `/bootstrap` seeding
  skill.
- ✅ Declarative config — `icculus config` + `init --config` (comment-preserving
  programmatic edits), and a documented `add-preset` contract (file overlay +
  config fills).
- ✅ **Docs browser** (`icculus docs`) — an interactive, searchable viewer with
  a dependency-light terminal Markdown renderer, plus agent-facing
  `--json`/`--raw`/`--list` surfaces (ADR 0015).
- ✅ A wide test suite covering both the installer and the TypeScript engine
  (`src/engine/**`), including hermetic scaffold-and-run harnesses in
  `tests/engine_*`, with `src/` line coverage held at a rising floor by
  `[ratchets.coverage]` (enforced on every PR).

Follow-ups:

- **Bundled stack presets** (`add-preset node`, `python`, …): the preset
  contract is complete and documented (see _Writing a preset_), but no preset is
  bundled yet — that stays stack-neutral. For now, `/bootstrap` detects your
  stack and proposes capability fills directly, or drive it with
  `init --config`.
- **Publishing**: the GitHub slug is wired to `jackwh/icculus` (override with
  `ICCULUS_REPO`); wire up the release before distributing.
- **`inherit_env` ordering**: a worktree that relies on `[worktree.inherit_env]`
  needs its `.env` to exist before the inherit step (a db/dev-server setting or
  a `setup` step typically creates it). Documented in the worktree recipe.

---

## Provenance

The practices here were extracted from a production application's mature
agentic-development harness and generalised: the orchestration is lifted intact,
while the stack-specific pieces — build tools, framework, native targets — are
dropped or pushed behind the capabilities, checks, and worktree settings above.
