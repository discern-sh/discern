# Working with the discern harness

This project uses **discern**, a stack-neutral agentic-development harness.
Everything discern knows about this project lives in one root file,
**`discern.toml`**. Its verbs are **MCP tools** (`discern_status`, `discern_finish`,
…) — the **primary surface**, each returning a structured result you read directly.

## Operating discern

- **Orient first.** Call **`discern_status`** at the start of a session — read-only
  and cheap — for what's true now and what to do next.
- **A clean `discern_finish` is the bar for "done".** It runs the project's whole
  quality gate; don't call a change finished until it passes. Iterate with
  **`discern_prepare`** (the fast fix-then-check loop), and on a failure read the
  result's `diagnostics[]` — the failing command and its captured output — to fix
  from there.
- **To learn how discern itself works, call `discern_help`.**

If the MCP server isn't reachable, say so, and meanwhile run any verb from the
**`discern` CLI** (`discern status`, `discern finish`, …); pass `--json` when you
need to parse the output.

## Don't hand-edit generated files

discern compiles your guidance sources (`[guidance].sources`, default `guidance.md`)
into the agent files ({{generated_agent_files}}) and materializes skills into their
directories ({{materialized_skills_dirs}}). Both are generated: to change what an
agent reads, edit the source and run **`discern refresh`** — edits to a generated
file are overwritten on the next compile.
