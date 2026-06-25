# Working with the discern harness

This project uses **discern**, a stack-neutral agentic-development harness. discern
is one self-contained binary; everything it knows about *this* project lives in a
single root file, **`discern.toml`**. There is no hidden state directory — what you
see in the tree is what there is.

## Operating discern

discern's verbs are **MCP tools** (`discern_status`, `discern_finish`, …) — the
primary surface, each returning a structured result you read directly. A client
that connects also loads discern's own `instructions`, which say *when* to reach
for each tool; lean on them. The essentials:

- **Orient first.** Call **`discern_status`** at the start of a session — read-only
  and cheap — for what's true now and what to do next.
- **A clean `discern_finish` is the bar for "done".** It runs the project's whole
  quality gate; don't call a change finished until it passes. Iterate with
  **`discern_prepare`** (the fast fix-then-check loop). On a failure, read the
  result's `diagnostics[]` — the failing command and its captured output — and fix
  from there.
- **To learn how discern itself works** — the gate, `discern.toml`, the worktree
  workflow — call **`discern_help`** (or `discern help` on the CLI).

If the MCP server isn't reachable, say so and suggest looking into it once the task
is done; meanwhile every verb runs from the **`discern` CLI** (`discern finish`,
`discern help`, …), so nothing is out of reach. Pass `--json` whenever you parse the
output — in `--json` mode a verb prints exactly one machine-readable result object
and nothing else.

## What's yours, and what's generated

Two kinds of file live in the tree:

- **Yours** — edit freely, tracked in git: `discern.toml`, your guidance sources
  (`[guidance].sources`, default `guidance.md`), your authored skills under
  `[skills].dir`, your recipes under `[recipes].dir`.
- **Generated** — never hand-edit: the compiled agent files ({{generated_agent_files}}
  — including the one you are reading now) and the materialized per-agent skills
  directories ({{materialized_skills_dirs}}). `discern refresh` recompiles them all
  from discern's built-in guidance plus your sources.

So change what an agent reads at the source — edit a `[guidance].sources` file and
re-run `discern refresh` — never the generated file, which the next compile
overwrites. This is gate-backed, not a plea: the generated files are gitignored
build artifacts (so the reviewable diff is your source), and `discern_status` /
`discern_finish` recompile in memory and flag any agent file *or* materialized
skill that has drifted from its source (ADR 0034) — a stale or hand-edited one
fails the gate instead of slipping through.
