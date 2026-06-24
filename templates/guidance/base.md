# Working with the discern harness

This project uses **discern**, a stack-neutral agentic-development harness. discern
is one self-contained binary; everything it knows about *this* project lives in a
single root file, **`discern.toml`**. There is no hidden state directory — what you
see in the tree is what there is.

## Calling discern

discern's gate and observation verbs are also **MCP tools** (`discern_status`,
`discern_finish`, …, served by `discern mcp`); every verb runs from the **`discern`
CLI**. Prefer a tool when it exists — it returns the same result as a structured
object, ready to read. If the discern MCP server isn't reachable, say so and
suggest looking into it once the task is done; until then use the CLI
(`discern <verb>`), passing `--json` whenever you parse the output — in `--json`
mode a verb prints exactly one machine-readable result object and nothing else.

## Orient first — `discern_status`

Call **`discern_status`** at the start of a session to see what's true right now and
what to do next. It is pure observation — read-only, it never runs the gate or
touches anything — so it is cheap to call reflexively. It reports the current
branch and how far it sits from the integration branch, whether the tree is clean,
which scopes changed, and what the gate *would* fire, plus advisory next-step
hints (never an unverified pass/fail). The view follows where you run it: from a
linked worktree it shows that worktree's own state; from the main checkout it leads
with a survey of every worktree in flight (pass `--all` to add that survey from a
worktree, `--local` to suppress it). It sits alongside two setup-facing verbs that
answer different questions: **`discern_doctor`** asks *"is it correctly
installed?"* and **`discern_audit`** asks *"is the setup any good?"*.

## The quality gate (always on)

Run the gate before you call any change done:

- **`discern_finish`** — the full gate. It runs the project's configured commands,
  grouped into stages: a `fix` stage (formatters/codemods, run first), then `check`
  (lint, type-check) and `test` in parallel, with `build` slotted in as configured.
  A clean finish is the bar for "done".
- **`discern_prepare`** — the fast inner loop: the `fix` then `check` stages only, no
  tests or build. Use it while iterating.
- **`discern_test`** — just the test command.

The commands themselves live under `[capabilities]` (the five known ones —
`format`, `build`, `lint`, `typecheck`, `test`) and `[checks.<name>]` (anything
custom) in `discern.toml`. If a stage has no command configured, it passes
trivially — a fresh install is a green gate you grow into. Run **`discern_doctor`**
to see what is wired and to validate the install.

## Auditing the setup

Where the gate asks "did this change pass?", **`discern_audit`** asks "is this
setup any good?". It scores the project against a best-practices checklist (tests
wired, substantive guidance, docs and decision records, a quality ratchet,
per-worktree resources for anything shared) and ranks the weakest areas, with the
exact fix and why it matters for each. Some rules it decides itself; others it
**surfaces for you to judge** against the cited material (e.g. the project's own
guidance) — a `?` review item. Run it to find where to invest, then act:

- **`discern_audit`** — the weakest-first report (interactive in the CLI). Read its
  `data.categories[].rules` (each with a `fix` and `teach`) and `…[].reviews` (each
  a question plus the material to judge it against), and improve them.
- **`discern_audit --category <name>`** focuses one area; **`--min-score <n>`**
  exits non-zero below a floor (a CI/agent gate).

## What's yours, and what's generated

Two kinds of file live in the tree:

- **Yours** — edit freely, tracked in git: `discern.toml`, your guidance sources
  (`[guidance].sources`, default `guidance.md`), your authored skills under
  `[skills].dir`, your recipes under `[recipes].dir`.
- **Generated** — never hand-edit: the compiled agent files (`AGENTS.md`,
  `CLAUDE.md`, and siblings — including the one you are reading now) and the
  materialized `.claude/skills/`. `discern refresh` recompiles them, plus the MCP
  wiring, from discern's built-in guidance plus your sources.

So change what an agent reads at the source — edit a `[guidance].sources` file and
re-run `discern refresh` — never the generated file, which the next compile
overwrites. This is gate-backed, not a plea: the generated files are gitignored
build artifacts (so the reviewable diff is your source), and `discern_status` /
`discern_finish` recompile in memory and flag any that has drifted (ADR 0034) — a
stale or hand-edited one fails the gate instead of slipping through.

Add your own `discern` commands as **recipes**: drop an executable carrying a
`# desc: ...` line into `[recipes].dir` (default `./recipes`) and it becomes a
first-class `discern <name>` command, self-contained — it reads config via
`discern config get <key>`.
