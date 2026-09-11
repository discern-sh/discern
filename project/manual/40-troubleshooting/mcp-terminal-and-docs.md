---
id: troubleshoot-mcp-terminal-and-docs
title: "MCP, terminal, and docs"
description: "Restore missing agent tools, continue a wait, find a documentation page, or read a result when an interface fails."
order: 50
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-mcp-terminal-and-docs"
  - "Tool-call duration"
  - "MCP timeout"
  - "tool-call timeout"
  - "long MCP calls"
  - "mcp version mismatch"
  - "met false"
  - "exit 124"
  - "pager failed"
  - "docs target not found"
  - "cancel a running gate"
  - "lost output"
---

# MCP, terminal, and docs

If your agent cannot call a discern tool, it can usually continue through the corresponding CLI command. If a result is hard to read, use `--markdown` or `--json`, or open the saved output named in the result.

A useful request is:

> Check which interface is failing and use its supported fallback. If an earlier command may have completed, inspect its result or current state before running it again.

## The discern tools are missing from the session

Use `discern status --markdown` or `--json` from the task's worktree to keep working while you restore the integration. Then choose the relevant repair:

| Symptom                                            | Repair                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tools have never appeared in this session          | Start a fresh session after setup. Have the agent find and invoke the exact registered tool name. If it remains absent, follow [first-time activation](setup-and-integrations.md#the-tools-dont-appear-in-the-agents-session). |
| Results report a version mismatch after an upgrade | Restart the agent session or reload its MCP servers. The existing server process may still be running the earlier build.                                                                                                       |
| A tool runs against the wrong checkout             | Give it the task's absolute `path`. Also check the shell's working directory: a tool changing its target does not move the shell.                                                                                              |

Success means the status tool answers from the intended worktree using the expected version. The [MCP and results reference](../30-reference/mcp-and-results.md#model-context-protocol-tools) lists tool names and parameters.

## A long call ended without an answer

For `discern_await`, look for `ok: true` and `data.met: false`. That means the watch has not finished. Follow its returned continuation with the newest handle:

```
discern_await
  path:   /absolute/path/to/the/worktree
  resume: C1-BKJD-X4GQ-05
```

The CLI form is `discern await --resume C1-BKJD-X4GQ-05`. Replace the example handle with the handle in your result. The continuation preserves the original condition and observations, including a change between calls. No extra sleep or polling loop is needed.

The watch is complete when `data.met` is `true`. Ending it because the dependency no longer matters is also a valid choice. For scripts, an unfinished CLI wait exits `124`.

Other endings need a different action:

- **A refusal (`ok: false`).** Follow its recovery. A branch that does not resolve or a green watch whose worktree is gone cannot be fixed by resuming the old request. See [wait refusals](../10-guides/wait-for-another-task.md#handle-a-refusal).
- **The host cut off a call with no discern result.** Inspect status and available saved output. A transport timeout does not establish whether an effectful command completed, so do not repeat it just to recover the missing display.

Provider limits determine how long a call can reliably wait. The [MCP reference](../30-reference/mcp-and-results.md) and [provider reference](../30-reference/platforms-and-providers.md) describe those limits.

## Stopping the call did not stop the work

Interrupting a tool call, closing a terminal, or a host giving up on a long call stops only the waiting. The checks or landing that call started keep running on your machine until they finish or are cancelled through discern itself.

Have the agent read the run back first with the handle it announced when it started (`discern progress R1-…`), or with no handle for the latest run from that workspace. The reading says whether the run is still going, what it has counted and which checks have failed so far, and its result once it finishes. A run that is still active finishes on its own; a run whose process died reads as stopped without finishing and needs [recovery](../10-guides/recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation). Starting the same command again while the first is alive gets a refusal, not a second run.

## You need the output of a run that already happened

For a run that announced a handle, `discern progress <handle>` returns its retained result, with every failure and its reproduce command, for up to seven days. For a check's complete transcript, a result keeps each check's output in a file and names the path as `output_path`, on the check's step and on any diagnostic whose text was shortened. You can open that file yourself in any editor; you do not need the agent to read it for you. The files sit in your system's temp directory under names starting `discern-job-` (a check's complete output) or `discern-diag-` (the full text behind a shortened diagnostic), and discern keeps them for 24 hours. [Files named `discern-…` in the temp directory](crashes-and-local-state.md#files-named-discern--in-the-temp-directory) lists every prefix.

Repeating the command to see its output again costs another run and can change the state you were trying to read.

## A docs or map target won't resolve

Use a path returned by discern:

- **Ambiguous target:** choose one exact path from the listed candidates.
- **No match:** try a suggested path, or run `discern docs` or `discern map` without a target to read its index. Search in the language of your task, then open a returned path.

Use `docs` for discern's manual and `map` for the project's own documentation. You have resolved the problem when the returned page describes the topic you intended; a similarly named page may belong to a different section.

## The terminal output looks broken

Choose the smallest presentation fix:

| Symptom                                        | What to do                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The pager failed                               | Read the plain output discern prints instead. Fix or unset `$PAGER` before the next paged read; the default is `less -R`. |
| Color is unreadable                            | Set `NO_COLOR=1`.                                                                                                         |
| Decoration or wrapping gets in the agent's way | Request `--markdown` or `--json` for subsequent commands.                                                                 |
| A diagnostic was truncated                     | Open its `output_path` or the saved output named in the result.                                                           |

For an effectful command that already ran, retrieve its existing result or inspect status before deciding whether any new action is needed.

## A browser didn't open

Open the URL printed in the result in your browser. A failed browser launch does not, by itself, mean the preceding command failed; read the command's own outcome separately.

## When to stop

End a watch when its dependency no longer matters. If a version mismatch persists after restarting the MCP server, keep the installed and reported version information for a report. If the host repeatedly cuts off a call before discern can return a result, use the CLI where available and report the affected provider and command.
