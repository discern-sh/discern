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
