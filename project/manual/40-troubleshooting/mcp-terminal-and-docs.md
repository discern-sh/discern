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

When your agent loses its discern tools, a long wait ends early, or a result is hard to read, the work itself is usually fine. This page helps you get the tools back, carry on a wait, and read a result you missed, without running anything twice.

Your agent calls discern's tools over the **Model Context Protocol (MCP)**, the connection coding agents use to call tools. If that connection has a problem, your agent can use the `discern` command line instead. The examples follow a help-pages task that waits for a recipe search task. Ask your agent:

> Find out which part is failing and use the command line while you fix it. If an earlier command may have finished, read its result before you run anything again.

## The discern tools are missing from the session

Your agent can keep working while you fix this. It runs `discern status --json` from the task's worktree, its separate copy of the project, to see where things stand. Then it matches what it sees:

| What your agent sees                                                                                       | What to do                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tools never appeared in this session.                                                                  | Start a fresh session. If they're still missing, follow [The tools don't appear in the agent's session](setup-and-integrations.md#the-tools-dont-appear-in-the-agents-session). |
| `Restart your agent session or reload its MCP servers to replace MCP server v<old> with installed v<new>.` | Do that. The session's discern tools are still running the version from before your upgrade.                                                                                    |
| `The checkout these tools were aimed at is gone`                                                           | The task landed and its worktree was removed. The agent points its next call at the right checkout with `path`.                                                                 |
| A tool works on the wrong checkout.                                                                        | The agent passes the task's full folder path as `path`. Each call takes it separately, and it doesn't move the agent's shell.                                                   |

`path` must be a full path from the root of the disk. A relative one is refused with `` `path` must be an absolute path ``.

The tools are working again when the status tool answers from the right worktree, with no restart notice. The [MCP and results reference](../30-reference/mcp-and-results.md#model-context-protocol-tools) lists every tool and its inputs.

## A long wait ended before it was met

Your agent waits for another task with `discern_await`. Say the help-pages task waits for recipe search to pass its checks. Each call waits as long as your coding agent reliably allows, up to 55 minutes. If search isn't ready by then, the call still returns `ok: true`, with `data.met: false` and a handle to continue it. The wait isn't over. The agent calls again with the newest handle:

```text
discern_await
  path:   /Users/you/projects/recipes.worktrees/help-pages-b41f2c
  resume: C1-BKJD-X4GQ-05
```

On the command line, that's `discern await --resume C1-BKJD-X4GQ-05`, which exits with code `124` while the wait isn't met. Use the handle from your own result. The handle keeps the original condition, and it still notices a change that happened between calls. You don't need a delay or a loop.

The wait is over when `data.met` is `true`, or when you decide the help pages no longer need search.

A refusal is different. It has `ok: false`, and resuming won't help. The result says why:

- `Branch <name> was not found in this repository` means the name is wrong, or the branch is gone and discern has no record of it landing.
- `No checkout holds branch <name>` means the worktree was reclaimed or removed. If a later task holds its work, the result names that task.
- A handle with a typo, or one older than 7 days, can't resume. Start the wait again with its condition.

[Handle a refusal](../10-guides/wait-for-another-task.md#handle-a-refusal) covers these in more detail.

## A call ended with no result

Sometimes your coding agent stops waiting before discern replies. That doesn't tell you whether the command finished. So don't run it again only to see the output. First read the run back:

```sh
discern progress
```

With no handle, it reads the most recent run started in that worktree. With the handle the run announced when it started, such as `R1-H596-N6BT-K5`, it reads that run. Then run `discern status` to see where the task stands.

## You stopped a run, or aren't sure it stopped

How you stopped a run decides whether it's still going:

| What happened                                          | What happens to the run                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| You pressed Ctrl-C, or closed the terminal it ran in.  | discern stops the run and its checks. The command exits with code `130` or `129`. |
| You cancelled the tool call in your coding agent.      | discern cancels the run.                                                          |
| Your coding agent stopped waiting, without cancelling. | The run keeps going until it finishes.                                            |

If you can't tell which of these happened, read the run back. discern has no separate cancel command. You stop a run from wherever it started.

To see where a run got to, your agent runs `discern progress` with its handle. The reading says the run is still going, finished, `was cancelled before finishing`, or `stopped without finishing`. The last means its process died.

If your agent starts the same command while the first is still running, discern refuses and changes nothing: `Another discern operation holds the checkout boundary`. It names the running operation and its handle. Wait for that run, or stop it where it started.

When the agent runs `discern done` again after a stopped run, checks that didn't finish run again. Checks that finished, and that declare their inputs, reuse their results when those inputs haven't changed. A landing that stopped partway has its own recovery: [Recover an interrupted acceptance](../10-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance).

## You need the output of a run that already happened

`discern progress <handle>` returns the run's saved result, with every failure and the command that reproduces it. discern keeps these for up to 7 days. When there are many runs, it drops the oldest finished ones sooner.

Each check's full output is in a file the result names as `output_path`. You can open it yourself in any editor. These files are in your system's temp directory, with names starting `discern-job-` or `discern-diag-`, and discern keeps them for 24 hours. [Files named `discern-…` in the temp directory](crashes-and-local-state.md#files-named-discern--in-the-temp-directory) lists every kind.

Running the command again to see its output costs another run. It can also change the state you were trying to read.

## A docs or map page won't open

`discern docs` reads discern's manual. `discern map` reads your project's own map, the guide to how your project works. If a page name doesn't match, the result says so:

| What you see                                           | What to do                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `no doc matches "<name>". Closest matches:` and a list | Use one of the suggested names.                                                                       |
| `"<name>" matches N docs.`                             | Pick one exact name from the list.                                                                    |
| No suggestion fits.                                    | Search in the words of your task, such as `discern docs --search "resume a wait"`, and open a result. |

`discern docs --list` prints the table of contents. You've found the right page when it covers what you meant. A page with a similar name may belong to a different section.

## The terminal output looks wrong

| What you see                                             | What to do                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `The pager failed (…). Showing the document in discern.` | Read the page as shown. Fix or unset `$PAGER` before using `--pager` again. The default pager is `less -R`. |
| Colors are hard to read.                                 | Use `--theme light` or `--theme dark`, or turn color off with `--no-color` or `NO_COLOR=1`.                 |
| Colors, boxes, or wrapping get in your agent's way.      | Use `--markdown` or `--json`. `--plain` also turns off paging and prompts.                                  |
| A failure message was shortened.                         | Open the file its `output_path` names.                                                                      |

## A browser didn't open

`discern releases` and the docs reader open pages in your browser. If that fails, discern prints the link instead, such as `Couldn't open your browser. Use this link to check for updates:`. Open it yourself. The command itself still worked.

## When to stop

End a wait when the task no longer needs what it was waiting for. Ending it changes neither task's code.

If the restart notice comes back after you've restarted your agent's session, keep the version numbers it shows and report it. If your coding agent keeps cutting off calls before discern can reply, use the command line, and report which agent and command were involved. [Crashes and local state](crashes-and-local-state.md#report-it) explains how to report a problem.
