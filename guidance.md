# Working in the discern repo

discern is a portable, stack-neutral **agentic-development system**: one command
scaffolds a quality gate, an isolated git-worktree workflow, an
author-once→compile-everywhere agent-instruction pipeline, and a map/ADR
discipline into any project.

**This repo is both the tool and a user of it — it runs on its own gate.**

All the instructions you've already seen (the ones _above_ "Working in the
discern repo") are _the same instructions_ discern bundles and ships to other
coding agents, working in _their_ user's projects, to help them navigate their
own way around discern. All the instructions from _here onwards_ are for
**you**: an agent working on discern _itself_.

## What's in the repo

discern is **one self-contained Deno binary** — the installer verbs and the
engine are the same program, with no second copy committed alongside it to keep
in sync.

- **`src/`** — the whole binary. Installer verbs (`setup`, `doctor`, `upgrade`,
  `config`, `preset`) **and** the TypeScript engine: `src/engine/**` (the gate,
  the parallel/serial job runner, scope classification, standards, the worktree
  lifecycle + identity, the guideline compiler, the dispatcher), sharing
  `src/shared/**` (config reader, capability constants, feature toggles, POSIX
  `cksum`, root discovery). Compiled to a single binary via `deno task build`.
- **`templates/`** — the **distribution surface** the binary lays down or
  materializes into a project: the config template (`discern.toml.tmpl`), the
  settings template, the gitignore fragment, the **bundled built-in guidance**
  (`templates/guidance/*.md`), and the **bundled skills**
  (`templates/skills/**`).

## The footprint: one root `discern.toml`

A project's entire discern footprint is a single root file, **`discern.toml`**.
Everything else is bundled in the binary, a **config-pointed** location the user
chooses (with discoverable defaults — `guidance.md`, `./skills`, `./recipes`),
or a generated **output** (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are compiled,
committed outputs; vendor-specific files and paths are materialized). Every
subsystem is core (ADR 0101) — `[capabilities]` is the gate's command table, and
the one per-skill knob is `[skills].exclude`.

## ⚠️ Edit in place — there is no managed copy to sync

The rules:

- **The engine and installer are TypeScript under `src/**` — edit them in
  place.** There is no second copy, no hash tracking, no drift to detect. The
  gate (`discern done`) type-checks and tests them.
- **`templates/**` is the distribution surface** — edit the seed/skill/guidance
  _source_ here (keep it generic; see below). To reflect a bundled-skill or
  built-in-guidance edit in this repo's own skills and guidelines, run
  `discern refresh` (or `upgrade`).
- **`CLAUDE.md` / `AGENTS.md` are generated** from discern's built-in guidance
  (`templates/guidance/*`) plus this repo's `guidance.md` — never hand-edit
  them. Edit `guidance.md` and recompile.
- **`.claude/skills/` is a materialized artifact (gitignored)** — the binary
  republishes it from `templates/skills/**`. Don't hand-edit; edit the source
  under `templates/skills/`.

**Agent guidance is yours.** Customise it by editing `guidance.md` (this file) —
never `templates/`, which only holds the generic built-in guidance _other_
projects receive. Then run `discern refresh` to recompile the agent files
(`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/etc.) — committed generated files you never
hand-edit (ADR 0128); `discern done` fails if one drifts from its source, so
commit the refreshed copies with the source change. Keep the prose
provider-agnostic: one source compiles to every agent. Nothing overwrites your
`guidance.md`.

| To change…                                      | Edit…                                     | Then run                           |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------- |
| the gate / the engine / the dispatcher / a verb | `src/engine/**`, `src/main.ts` (in place) | `discern done`                     |
| an installer command                            | `src/commands/**` (in place)              | `discern done`                     |
| a bundled skill                                 | `templates/skills/…`                      | `discern refresh` (re-materialize) |
| the built-in discern guidance                   | `templates/guidance/*.md`                 | `discern refresh`                  |
| a seed file users receive                       | `templates/…`                             | —                                  |
| this guidance (yours)                           | `guidance.md`                             | `discern refresh`                  |
| project config (yours)                          | `discern.toml`, `deno.json`               | —                                  |

## Keep the shipped surface generic

`templates/` (the seed files, the bundled skills, **and** the built-in guidance)
is the **distribution surface**: every project receives it verbatim, in every
language and domain. Its content — and any user-facing engine output (help text,
messages) — must therefore stay domain-neutral: examples, placeholders, and
prose use generic stand-ins ("the project", "a tool that does X"), never the
vocabulary of one domain. The trap is subtle: you're usually reasoning about a
_specific_ repo at the same time (the one discern is installed into, or one
you're testing against), and its domain bleeds into a generic skill or doc.
Before editing under `templates/`, check that every example reads correctly for
any project in any field — if a word only fits one domain, it doesn't belong
there. And don't "fix" a leak by banning domain words in the gate: a denylist
just relocates the same vocabulary into tracked test history — this rule,
applied while editing, is the safeguard.

One vocabulary **is** gated, because it's structural rather than open-ended:
**internal ADR citations never ship**. An "(ADR 0034)" in an error message,
upgrade note, or template is repo-internal shorthand no other project's users or
agents can follow. Cite ADRs in code comments, `map/`, and commit messages; keep
shipped strings self-contained (`tests/adr_vocab_guard_test.ts` enforces this —
string literals under `src/`, all text under `templates/`). The concept word
"ADR" stays legal everywhere: discern ships an ADR discipline.

## The gate

- `discern prepare` — fast inner loop: fix + check, no tests.
- `discern done` — full gate (run from the repo root): `deno fmt` (fix) →
  `deno lint` + `deno check` (check) ∥ `deno task test` (test). This is the repo
  running its **own** TS engine, so a regression in the engine surfaces here.

## Running discern from source

Use **`discern <cmd> --json`** — here, it points to a local-dev wrapper, not a
binary, and runs the nearest discern engine it finds. So from a worktree it will
run _that worktree's_ in-progress engine. It's the closest thing to what an end
user runs, so the generic `discern` guidance above applies verbatim. (One
exception: `discern mcp` always runs from the **main** checkout only.)

`deno task dev <cmd> --json` is a fallback — reach for it only if you
specifically need to. (If you do: don't put `--` before the subcommand —
`deno task dev -- upgrade` makes the CLI parser print help, a `deno task` quirk
the wrapper doesn't share.)

**Never** use the `dist/` binaries while developing — they bundle a frozen
snapshot of `templates/` and the engine compiled at build time.

The MCP `discern_*` tools are a separately-spawned, long-lived server running
the **main** checkout's engine, not your worktree's — so for branch-only changes
(a bundled skill, guidance, or engine edit not yet on `main`) they can report
stale results against main, not your branch. Trust the engine run from source —
`discern done` — over the MCP `discern_*` tools whenever they disagree.

Everything supports discern's own **`--json`** flag; always pass it for
optimised machine-readable output. It reaches the underlying `discern <cmd>`
exactly as an end user would, so discern's full range is open to you too.

## Testing

`deno task test` is the authority on correctness, engine included: the
`tests/engine_*` suite scaffolds the seed surface into temp dirs and drives the
TS engine via `deno task dev <verb>` (with a `discern` PATH shim so recipes and
hooks resolve the binary like a real install). It is the behavioral parity
oracle for the engine. If a bad engine change ever breaks `discern done` itself,
run `deno task test` directly. Add engine coverage to `tests/engine_*_test.ts`;
installer coverage to the other `tests/*_test.ts`. Iterate on one suite with
`deno task test tests/<name>_test.ts` (or `--filter <name>`) instead of running
the whole suite each loop.

## Conventions & gotchas

- **Strict TS, strict lint.** `deno.json` turns on the strict compiler set
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`/`Parameters`, …) and a strict lint set: explicit return and
  module-boundary types, no non-null assertions (`!`), no `process`/node globals
  (import from `node:process`), no thrown literals, `eqeqeq`. Match the
  surrounding code and write to these the first time — the gate enforces every
  rule, so fighting the linter just costs a `done` loop.
- **Several artifacts and schemas are generated.** The `deno task codegen`
  command rewrites `map/10-installer/config-reference.md`, `schema/*.json`, and
  `types/*.d.ts` automatically. The codegen command is wired in to discern's own
  `[capabilities.build]` step (the `discern.toml` template stays hand-authored —
  ADR 0005/0026).
- **Keep `map/` current with the change.** The `map/` tree is the source of
  truth and must not drift from code — update the affected docs in the same
  commit. `map/` and root `*.md` fire no gate (a neutral scope); `map/` alone is
  held to the Vale `prose` check and the `[standards.prose]` density ceiling.
- Keep commits **atomic**: one logical change per commit, step by step.
- **Commit messages** must start with a **subject** - one imperative line
  summarizing the change (e.g. "Add retry to upload path"), no trailing period;
  then follow with a **body** (when the change is non-trivial) explaining _why_
  the change was made and any consequences or trade-offs, not a restatement of
  the diff. Wrap at ~72 cols. Use bullets for multiple distinct points.

## Adding or changing a verb

- **Plan/apply.** Every effectful verb computes a pure, read-only plan, then a
  thin executor applies it (ADR 0027) — that split is what gives `--dry-run`
  (render the plan, change nothing) and `--json` for free.
- **One result envelope.** A verb returns a single `DiscernResult`
  ([`src/shared/result.ts`](src/shared/result.ts)); `--json` serializes it and
  the human output renders from it (ADR 0028). Don't `console.log` ad-hoc output
  from a verb.
- **MCP is a first-class surface.** Each tool in
  [`src/engine/mcp/server.ts`](src/engine/mcp/server.ts) is backed by a
  `*Result(root, …)` core the CLI shares; the verb-parity guard
  (`tests/engine_verb_parity_test.ts`) ties the `TOOLS` table back to the CLI
  verb list. Exposing a read/run verb means extracting that core first (ADR
  0045/0041).

## Fix the class, not the instance

A bug is rarely alone. Before fixing one, name the _class_ of defect as a
checkable predicate, then write a check that fails on **every** member — a
parameterized test, a lint or structural-search rule, an architectural test that
iterates the canonical set — and leave it in the gate as a permanent guard so
the class can't silently return. Drive the check off the single source of truth
(a registry, enum, or type), never a hand-copied list, so a new member
auto-enrols. The **`discern-cure-a-bug`** skill walks the full procedure. This
is already wired for discern's closed sets — CLI verbs, capabilities, agent
providers, MCP tools, the config schema — by forcing-function guards
(`engine_verb_parity_test.ts`, `agent_parity_test.ts`,
`engine_mcp_surface_test.ts`, `config_codegen_test.ts`): add a member to its
single source and the satellites must match or the gate fails (ADR 0051).
Maintain this practice with new development going forward.

## Decisions

Architecture decisions live in `map/_adr/` (0001+, several dozen and counting) —
browse them with `discern help --adr --json`. Add one for any notable or
hard-to-reverse change. ADRs move fast, so skim the most recent few before a
significant change — a current ADR usually explains why something is the way it
is.
