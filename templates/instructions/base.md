# Working in {{project_name}}

discern's built-in instructions appear first. {{project_name}}'s own instructions follow the divider and take precedence where they conflict.

## Operating discern

discern gives each development task an isolated workspace, runs the project's configured checks, records completion evidence, and controls how changes land on the shared branch. Its configuration lives in **`discern.toml`**. Use its **MCP tools** as the primary interface.

- **Orient first.** Call **`discern_status`** at the start of every session, including investigation-only and resumed sessions. It reports current state and the next action without running checks or changing the project.
- **Use the effort's worktree before editing.** An effort is one task carried through implementation and review. Continue in its existing worktree across feedback and resumed sessions. For a new effort requiring edits, call **`discern_start`** from the main checkout and move your file operations to the returned path. Read-only investigation does not require creating a worktree.
- **Finish through `discern_done`.** It verifies the configured gate: the checks required to call the change complete. Use **`discern_prepare`** or a diagnostic's reproduce command while iterating. Follow the finishing sequence below before reporting completion.
- **Follow the reported next action.** Use the result's diagnostics and recovery instructions instead of bypassing them with raw Git or shell operations. If the remedy cannot be followed, use **`discern_docs`** for the relevant procedure or report the unresolved condition to the owner.
- **Find the right reference.** **`discern_docs`** explains discern; **`discern_map`** reads the current project's documentation; **`discern_doctor`** diagnoses installation problems.

**When MCP is unavailable:** tell the owner and use the **`discern` CLI**, with `--markdown` for readable results or `--json` for structured fields. Read the reported state, diagnostics, recovery instructions, and any owner relay or Proof. If output is truncated, retrieve its structured or stored view; never repeat an effectful command just to recover omitted output. Offer `discern doctor` afterwards. If the CLI is also unavailable, stop and let the owner choose between installing discern (`curl discern.sh` explains how) and continuing without its protections.

## Communicating with the owner

Explain discern's findings through their consequences for the requested work: what happened, what remains unverified, and what you will do next. Match the owner's technical familiarity; explain unfamiliar terms when needed. Distinguish observed facts from suspected causes. Continue authorized investigation and repair before asking the owner to resolve routine implementation choices. When a decision is needed, present the supported tradeoff, your recommendation, and what approval would authorize. Keep completion claims within the available evidence.

## Generated files — don't hand-edit

discern compiles the project's instruction sources ({{instruction_sources}}) into the agent files ({{generated_agent_files}}) and materializes skills into their directories ({{materialized_skills_dirs}}). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.
