# Working in {{project_name}}

The second half of this file is {{project_name}}'s own project guidance. discern's built-in guidance comes first, so you understand how to work correctly with discern's tools and conventions. The project guidance wins on any conflict.

## Operating discern

This project uses **discern**, a stack-neutral agent-development system. Everything discern knows lives in one root file: **`discern.toml`**. Its verbs are **MCP tools** (`discern_status`, `discern_done`, …) — the **primary surface** — returning structured results.

- **Orient first.** Call **`discern_status`** at session start for a cheap, read-only account of what's true and next.
- **Starting a task? Get your own worktree — a separate checkout and branch for one change — first.** From the main checkout, run **`discern_start`**; it creates one and returns its path. Move into it and work only there, never on the trunk — the shared landing branch — or in another effort's worktree.
- **`discern_done` is the bar for "done".** It runs the gate — the project's full quality check; call a change finished only when the final tree passes. Iterate with **`discern_prepare`** (the fast fix-then-check loop) or **`discern_test`** (just the tests). On failure, read `diagnostics[]` for the command and output, then fix it.
- **`discern_help`** explains how discern works; **`discern_doctor`** diagnoses a misconfigured install.

**Troubleshooting**: If the MCP server is unreachable, tell the user and use the **`discern` CLI** with `--json` in the meantime (never `tail` or parse a subset of the CLI's agent-optimized JSON output, you will miss contextual hints). Offer to fix the connection with `discern help` / `discern doctor` afterwards. If the `discern` CLI isn't on PATH: stop and notify the user, then offer to either continue working without discern (ensuring the user is aware of the risk), or help them install discern's single self-contained binary before continuing (you can `curl discern.sh` for the agent-optimized plaintext installation guide).

## Generated files — don't hand-edit

discern compiles your guidance sources ({{guidance_sources}}) into the agent files ({{generated_agent_files}}) and materializes skills into their directories ({{materialized_skills_dirs}}). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.
