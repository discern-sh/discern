# Working with discern

This project uses **discern**, a stack-neutral agent-development system.
Everything discern knows lives in one root file: **`discern.toml`**. Its verbs
are **MCP tools** (`discern_status`, `discern_done`, …) — the **primary surface** —
returning structured results.

This file is compiled — discern's built-in operating guidance first, then the
project's own guidance, the more specific authority: it wins on any conflict.

## Operating discern

- **Orient first.** Call **`discern_status`** at session start for a cheap,
  read-only account of what's true and next.
- **Starting a task? Get your own worktree — a separate checkout and branch for
  one change — first.** From the main checkout, run **`discern_start`**; it creates
  one and returns its path. Move into it and work only there, never on the trunk —
  the shared landing branch — or in another effort's worktree.
- **`discern_done` is the bar for "done".** It runs the gate — the project's full
  quality check; call a change finished only when the final tree passes. Iterate with
  **`discern_prepare`** (the fast fix-then-check loop) or **`discern_test`** (just
  the tests). On failure, read `diagnostics[]` for the command and output, then
  fix it.
- **`discern_help`** explains how discern works; **`discern_doctor`** diagnoses a
  misconfigured install.

If the MCP server is **unreachable**, tell the user and use the **`discern` CLI**
with `--json` meanwhile — never `tail` its agent-optimised output. Offer to fix
the connection with `discern help` / `discern doctor` afterwards.

## Generated files — don't hand-edit

discern compiles your guidance sources (`guidance.md`) into the agent files
(`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) and materializes skills into their directories
(`.claude/skills`, `.agents/skills`). To change what you read, edit the source and run
**`discern refresh`** — edits to a generated file are overwritten on the next
compile.

## Isolated worktree workflow

discern keeps each task in its own **linked git worktree** so parallel work
doesn't collide. It provisions per-worktree external
**resources**; read one with `discern identity --resource <name>`.

- **`discern_start`** — from the main checkout, create your isolated worktree
  (branch prefix `agent/`, forked from `main`) and re-root
  into the returned path: cd in, or start a session there. Can't change your
  working root? Prefix every shell command with `cd <path> &&` and pass `path`
  to every discern tool. Already in a worktree? Stay there.
- **`discern_update`** brings `main` into your branch when behind
  and reports upstream overlap. Idempotent — call it directly instead of
  pre-checking with git or hand-merging; it performs its own preconditions and
  gives the exact next step if it refuses. To build on unlanded work instead,
  `start` and `update` both take `from` (any ref) — work composes below the
  trunk; only `accept` lands on it.
- **`discern_accept`** is only for an explicit user handoff/land request. After
  a green `discern done` run on a completed task, relay the receipt to your owner and stop;
  call it only once they explicitly ask to land (unless pre-authorized).
  It lands on the trunk (`main`) — fast-forwarded, the worktree
  removed, the merged branch deleted — and refreshes the trunk checkout it
  leaves behind.

While iterating, use `discern_prepare`, `discern_test`, or a targeted project
command. When the final tree is ready, commit it first, then run
`discern_done` once on the clean HEAD — that recorded receipt is the one
acceptance honors; a later commit invalidates it.

Acceptance requires a clean worktree and lands committed branch history only.

**Never edit a worktree from outside it without one of those moves, and never
start work in one you didn't create.** A clean tree doesn't mean it's free; the ones
`discern_status` lists are other efforts in flight, not a pool to claim from.

## Quality standards

Standards are **numbers that can never get worse**: metrics held at a `limit`
that may only improve versus `main` — a floor that may only rise
(`up`), or a ceiling that may only fall (`down`) — so a branch can never loosen
one. Standards are **slow and
on-demand**, NOT part of `discern_done`: run **`discern_standards`** as needed.
Non-dry-run standards require a clean worktree, with a force override reserved for
standard authoring or debugging.

**Never loosen one to pass.** A limit loosened versus `main` is the
regression a standard exists to catch — move the *metric* the right way, never the
limit.

## Skills

discern makes **skills** — focused, reusable task playbooks — discoverable to
**you**; reach for one when a task matches. **`discern skills list`** shows the set.

When a session yields a durable lesson — a correction, a hard-won procedure, an
unrecorded decision — **offer to capture it** with the
`discern-teach-the-project` skill at a natural pause, so future sessions
inherit it.

## The map & decisions

The tree at `map/` is the **map** — the agent-maintained account of this
codebase, browsable with **`discern_map`**. Agents write it and keep it current;
humans read it to audit what their agents understand; a stale map is a defect.
Never touch documentation the user didn't point discern at — the map is the only
tree discern maintains. Record significant or hard-to-reverse decisions as
**Architecture Decision Records** under `map/_adr/`.

---

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
or a generated **output** (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are gitignored
build artifacts; as vendor-specific files and paths are materialized). Every
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
(`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/etc.) — gitignored build artifacts you
never hand-edit (ADR 0034); `discern done` fails if one drifts from its source.
Keep the prose provider-agnostic: one source compiles to every agent. Nothing
overwrites your `guidance.md`.

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

