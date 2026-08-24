# Working in {{project_name}}

discern's built-in instructions comes first; {{project_name}}'s own instructions fills the second half and wins on any conflict.

## Operating discern

This project uses **discern**, a stack-neutral agent-development system. Everything discern knows lives in one root file: **`discern.toml`**. Its verbs are **MCP tools** (`discern_status`, `discern_done`, …), the **primary surface**.

- **Orient first.** Call **`discern_status`** at session start for a fast read-only account of what's true and next.
- **Keep one worktree for the whole effort.** The worktree carries the effort's branch, identity, and any recorded authority, so review feedback and resumed sessions continue there; a second worktree would split the effort's history and its evidence. If this effort already has a worktree, continue there using its recorded path and pass `path` to every discern tool. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again. For a new effort, run **`discern_start`** from the main checkout and work only at the returned path. Read-only work needs none.
- **`discern_done` is the bar for "done".** Call work finished only after its full gate passes. Iterate with **`discern_prepare`** or a diagnostic's reproduce command; each diagnostic names its location and exact command. With a positive `[gate].concurrent_test_runs`, run direct tests through **`discern queue -- <command>`**. `discern_test` runs the complete test stage on demand. `discern_done` already includes the same test stage, so a final Gate run needs no standalone test preflight.
- **Follow discern's printed next action.** A discern refusal or failure names its own next step in the result, and `hints` are matched to the state you are in. Prefer the stated remedy over improvising around it with raw git or shell — discern gives you instructions which are optimized, deterministic, and fleet-aware.
- **`discern_docs`** explains how discern works; **`discern_doctor`** diagnoses a misconfigured install.

**Troubleshooting**: MCP tools unreachable? Tell the user and use the **`discern` CLI** as a fallback (`--markdown` for a readable result, `--json` for structured fields). Consume the result's state, diagnostics, location, next action, recovery, Proof, and human relay when present. If output is truncated, use the result's structured or retrievable view; never repeat an effectful command merely to recover omitted output. Offer `discern doctor` afterwards. CLI not on PATH? Stop and tell the user: they choose between installing it (`curl discern.sh` explains how) or continuing without discern's protections.

## Generated files — don't hand-edit

discern compiles the project's instruction sources ({{instruction_sources}}) into the agent files ({{generated_agent_files}}) and materializes skills into their directories ({{materialized_skills_dirs}}). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.
