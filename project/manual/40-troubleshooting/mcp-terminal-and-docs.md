---
id: troubleshoot-mcp-terminal-and-docs
title: "MCP, terminal, and docs"
description: "Get your agent's discern tools back, keep a wait going, read a result you missed, and open the page you need, without running anything twice."
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

When your agent loses its discern tools, a long wait ends early, or a result is hard to read, the work is usually fine. You can recover without running anything twice.

Your agent calls discern's tools over the **Model Context Protocol (MCP)**. Say it's writing help pages for your recipe app, and waiting for the search task to pass its checks, when its tools disappear. Ask it:

> "Use the command line while you find what's wrong, and read any earlier result before you rerun a command."

## The discern tools are missing from the session

Your agent keeps working through the command line. It starts with `discern status --json` in the task's **worktree**, its separate copy of the project:

| What your agent sees                                                                                       | What to do                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The tools never appeared in this session.                                                                  | See [Setup and integrations](setup-and-integrations.md#the-tools-dont-appear-in-the-agents-session). |
| `Restart your agent session or reload its MCP servers to replace MCP server v<old> with installed v<new>.` | Do that. The session's tools still run the old version.                                              |
| `The checkout these tools were aimed at is gone`                                                           | The task landed and its worktree was removed. The agent passes the right checkout as `path`.         |
| A tool works on the wrong checkout.                                                                        | The agent passes the task's full path as `path` on each call.                                        |

A relative `path` is refused with `` `path` must be an absolute path ``. The tools work again when the status tool answers from the right worktree, with no restart notice.

## A long wait ended before it was met

Each `discern_await` call waits as long as your coding agent reliably allows, up to 55 minutes. If search hasn't passed by then, the call returns `ok: true` with `data.met: false`. The wait isn't over, so the agent calls again with the newest resume handle:

```text
discern_await
  path:   /Users/you/projects/recipes.worktrees/help-pages-b41f2c
  resume: C1-BKJD-X4GQ-05
```

On the command line, `discern await --resume <handle>` exits with code `124` while the wait isn't met. The wait is over when `data.met` is `true`, or when you decide the help pages no longer need search.

A refusal has `ok: false`, and resuming won't help:

- `Branch <name> was not found in this repository`: the name is wrong, or the branch is gone without a recorded landing.
- `No checkout holds branch <name>`: the worktree was reclaimed or removed, and the result names any later task holding its work.
- A mistyped handle, or one older than 7 days, can't resume, so start the wait again.

[Handle a refusal](../20-guides/wait-for-another-task.md#handle-a-refusal) covers each case.

## You stopped a run, or a call ended with no result

A call that ends with no result doesn't show whether the command finished. How the run stopped decides whether it's still going:

| What happened                                         | What happens to the run                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| You pressed Ctrl-C, or closed its terminal.           | discern stops the run and its checks, and the command exits with code `130` or `129`. |
| You cancelled the tool call in your coding agent.     | discern cancels the run.                                                              |
| Your coding agent stopped waiting without cancelling. | The run keeps going until it finishes.                                                |

discern has no separate cancel command, so you stop a run where it started. If you can't tell what happened, your agent [reads the run back](../20-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) with `discern progress` instead of starting it again. The reading shows `was cancelled before finishing` or `stopped without finishing` if the run didn't finish.

Starting the command again while it runs changes nothing: discern refuses with `Another discern operation holds the checkout boundary` until the first run ends. A landing that stopped partway has its own recovery: [Recover an interrupted acceptance](../20-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance).

## You need an earlier run's output

`discern progress <handle>` returns the run's saved result, with every failure and the command that reproduces it, for up to 7 days. When a result shortens a command's output or failure message, it names the file with the full text as `output_path`. These files stay in your system's temp directory for 24 hours, as [Files named `discern-…` in the temp directory](crashes-and-local-state.md#files-named-discern--in-the-temp-directory) explains.

Rerunning a command only to see its output costs another run, and can change the state you wanted to read.

## A docs or map page won't open

`discern docs` reads discern's manual, and `discern map` reads your project's **map**, its guide to how the project works. When a name doesn't match, the result says so:

| What you see                                           | What to do                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `no doc matches "<name>". Closest matches:` and a list | Use a suggested name.                                                                                                   |
| `"<name>" matches N docs.`                             | Pick one from the list.                                                                                                 |
| No suggestion fits.                                    | Search in your task's words, such as `discern docs --search "resume a wait"`, or list pages with `discern docs --list`. |

## The terminal output looks wrong

| What you see                                             | What to do                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `The pager failed (…). Showing the document in discern.` | Read the page as shown. Fix `$PAGER` before using `--pager` again.         |
| Colors are hard to read.                                 | Use `--theme light`, `--theme dark`, or `--no-color`.                      |
| Colors, boxes, or wrapping get in your agent's way.      | Use `--markdown` or `--json`. `--plain` also turns off paging and prompts. |

## A browser didn't open

When discern can't open your browser, it prints the link instead, such as `Couldn't open your browser. Use this link to check for updates:`. The command still worked.

## When to stop

End a wait when the task no longer needs it. Ending it changes neither task's code.

If the restart notice returns after a restart, keep the version numbers it shows and [report it](crashes-and-local-state.md#report-it). If your coding agent keeps cutting off calls before discern replies, use the command line and report the agent and command.
