# Working in {{project_name}}

discern's built-in guidance comes first; {{project_name}}'s own guidance fills the second half and wins on any conflict.

## Operating discern

This project uses **discern**, a stack-neutral agent-development system. Everything discern knows lives in one root file: **`discern.toml`**. Its verbs are **MCP tools** (`discern_status`, `discern_done`, …), the **primary surface**.

- **Orient first.** Call **`discern_status`** at session start for a cheap, read-only account of what's true and next.
- **Keep one worktree for the whole effort.** Review feedback and resumed sessions continue there. If this effort already has a worktree, continue there using its recorded path and pass `path` to every discern tool. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again. For a new effort, run **`discern_start`** from the main checkout and work only at the returned path. Read-only work needs none.
- **`discern_done` is the bar for "done".** Call work finished only after its full gate passes. Iterate with **`discern_prepare`** (fast fix/regenerate/check) or **`discern_test`** (tests); fix failures from `diagnostics[]`. With a positive `[gate].concurrent_test_runs`, run direct tests through **`discern queue -- <command>`**.
- **`discern_docs`** explains how discern works; **`discern_doctor`** diagnoses a misconfigured install.

**Troubleshooting**: MCP tools unreachable? Tell the user and use the **`discern` CLI**: `--markdown` to read, `--json` for structured fields. Read each result whole; never `tail`, `grep`, or script-filter it — a subset drops hints and remedies. Offer `discern doctor` afterwards. CLI not on PATH? Stop and tell the user: they choose between installing it (`curl discern.sh` explains how) and continuing without discern's protections.

## Generated files — don't hand-edit

discern compiles your guidance sources ({{guidance_sources}}) into the agent files ({{generated_agent_files}}) and materializes skills into their directories ({{materialized_skills_dirs}}). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.
