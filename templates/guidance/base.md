# Working with the discern harness

This project uses **discern**, a stack-neutral agentic-development harness.
Everything discern knows about this project lives in one root file,
**`discern.toml`**. Its verbs are **MCP tools** (`discern_status`, `discern_finish`,
…) — the **primary surface**, each returning a structured result you read directly.

## Operating discern

- **Orient first.** Call **`discern_status`** at the start of a session — read-only
  and cheap — for what's true now and what to do next.
- **Starting a task? Get your own worktree first.** If you're on the main checkout,
  run **`discern_start`** before you begin: it creates an isolated worktree for your
  work and returns its path. Nothing relocates you — re-root into that path (cd in,
  or start a session there) and work from inside it. Never work on the trunk, or in
  a worktree you didn't create. (See *Isolated worktree workflow* below.)
- **`discern_finish` is the bar for "done".** It runs the project's whole quality
  gate; don't call a change finished until it passes. Iterate with
  **`discern_prepare`** (the fast fix-then-check loop) or **`discern_test`** (just
  the tests); on a failure read the result's `diagnostics[]` — the failing command
  and its captured output — and fix from there.
- **`discern_help`** explains how discern works; **`discern_doctor`** diagnoses a
  misconfigured install.

If the MCP server is **unreachable**:

1. **Tell the user** — they should know about the misconfiguration; MCP is
   discern's intended surface. Then continue working.
2. Meanwhile, run any verb from the **`discern` CLI** (`discern status`, …)
   with `--json` for structured output. Don't `tail` it — the output is
   already agent-optimised, and you will miss information.
3. When you finish working, **offer to help fix** the MCP connection —
   `discern help` and `discern doctor` can assist.

## Generated files — don't hand-edit

discern compiles your guidance sources ({{guidance_sources}}) into the agent files
({{generated_agent_files}}) and materializes skills into their directories
({{materialized_skills_dirs}}). To change what you read, edit the source and run
**`discern refresh`** — edits to a generated file are overwritten on the next
compile.
