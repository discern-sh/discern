# Working with the discern harness

This project uses **discern**, a stack-neutral agentic-development harness. discern
is one self-contained binary; everything it knows about *this* project lives in a
single root file, **`discern.toml`**. There is no hidden state directory — what you
see in the tree is what there is.

## The quality gate (always on)

Run the gate before you call any change done:

- **`discern finish`** — the full gate. It runs the project's configured commands,
  grouped into stages: a `fix` stage (formatters/codemods, run first), then `check`
  (lint, type-check) and `test` in parallel, with `build` slotted in as configured.
  A clean `finish` is the bar for "done".
- **`discern prepare`** — the fast inner loop: the `fix` then `check` stages only, no
  tests or build. Use it while iterating.
- **`discern test`** — just the test command.

The commands themselves live under `[capabilities]` (the five known ones —
`format`, `build`, `lint`, `typecheck`, `test`) and `[checks.<name>]` (anything
custom) in `discern.toml`. If a stage has no command configured, it passes
trivially — a fresh install is a green gate you grow into. Run **`discern doctor`**
to see what is wired and to validate the install.

## Machine-readable output (`--json`) and MCP

Every `discern` verb accepts **`--json`**, and when you run discern from a tool
call whose output you parse, you should pass it. In `--json` mode the verb emits a
single machine-readable `DiscernResult` and **nothing else** — all human narration
and command output is suppressed, so the combined stdout+stderr is exactly one JSON
object you can parse directly:

- `ok` is the one field every verb sets. A failure also carries `diagnostics[]`:
  each with the failing `tool`, a `message`, the exact `reproduce_cmd`, and the
  command's captured `output` (plus `file`/`line`/`rule` when it emits a recognized
  format) — enough to fix without re-running and scraping stderr.
- `hints[]` carries the same next-step advice the human output would print.
- `steps[]` records what ran; verb-specific detail rides in `data`.

discern also runs as an **MCP server** — **`discern mcp`** exposes the verbs as
tools that return the same envelope as a structured result: `discern_finish`,
`discern_prepare`, `discern_doctor`, `discern_audit`, and `discern_changed_scopes`,
plus `discern_docs` (read the docs tree) and `discern_graduate` (graduate this
worktree's branch) when those features are enabled. Each is the same `--json`
envelope, surfaced natively. If your client has the server configured, prefer the
tools; otherwise call the CLI with `--json`.

## Auditing the setup

Where the gate asks "did this change pass?", **`discern audit`** asks "is this
setup any good?". It scores the project against a best-practices checklist (tests
wired, substantive guidance, docs and decision records, a quality ratchet,
per-worktree resources for anything shared) and ranks the weakest areas, with the
exact fix and why it matters for each. Some rules it decides itself; others it
**surfaces for you to judge** against the cited material (e.g. the project's own
guidance) — a `?` review item. Run it to find where to invest, then act:

- **`discern audit`** — the weakest-first report (interactive on a terminal).
- **`discern audit --json`** — the same result as a machine-readable object; read
  `data.categories[].rules` (each with a `fix` and `teach`) and `…[].reviews`
  (each a question plus the material to judge it against), and improve them. It is
  also exposed as the `discern_audit` MCP tool, so you can pull it natively.
- **`discern audit --category <name>`** focuses one area; **`--min-score <n>`**
  exits non-zero below a floor (a CI/agent gate).

## Generated agent files — never hand-edit

The agent instruction file you are reading (`AGENTS.md`, `CLAUDE.md`, or a sibling)
is a **generated artifact**. It is compiled by `discern refresh` — which
regenerates the generated agent files, the materialized skills, and the
integration artifacts — from discern's built-in harness guidance plus the
project's own `[guidance].sources`. Editing the generated file is pointless — the
next compile overwrites it. To change guidance, edit a source under
`[guidance].sources` (default `guidance.md`) and re-run `discern refresh`.
`AGENTS.md` is committed (so guidance changes show up in review); the other
provider mirrors are gitignored.

## What's yours vs. what's discern's

- **Yours** (edit freely, tracked): `discern.toml`, your guidance sources, your
  authored skills under `[skills].dir`, your recipes under `[recipes].dir`.
- **discern's** (generated, don't hand-edit): the compiled agent files, and the
  materialized `.claude/skills/`.

Custom project commands can be added as **recipes**: drop an executable carrying a
`# desc: ...` line into `[recipes].dir` (default `./recipes`) and it becomes a
first-class `discern <name>` command. A recipe is self-contained: it reads config
by calling the binary (`discern config get <key>`).
