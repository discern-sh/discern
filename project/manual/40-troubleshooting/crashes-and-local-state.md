---
id: troubleshoot-crashes-and-local-state
title: "Crashes and local state"
description: "Pick up your task after discern crashes, send a useful report, and find out what a discern file holds before you delete it."
order: 60
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-crashes-and-local-state"
  - "Crash reports"
  - "crash"
  - "crashes"
  - "crash report"
  - "exit code 70"
  - "internal_error"
  - "Temp files & retention"
  - "temp files"
  - "temp directory"
  - "retention"
  - "discern-job files"
  - "self-shim"
  - "report a bug"
  - ".git/discern"
---

# Crashes and local state

If discern crashes, your task's work is still in its **worktree**, the separate copy of the project your agent works in, and discern saves a report you can send us. This page shows how to pick the task up safely and what to put in a bug report.

It also explains the files discern keeps on your machine, so when you find one you don't recognize, you can check what it holds before you delete anything.

## discern crashed

A crash means discern hit a bug of its own. You'll see one of these:

| Where you ran it | What you see                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| A terminal       | The command exits with code `70` and prints ``discern <version> crashed while running `<command>`.``  |
| An agent's tool  | The result has `ok: false` and `error: "internal_error"`. Its message says where the report is saved. |
| The saved report | A text file under `discern/crash/` inside your repository's `.git` folder.                            |

The terminal report goes on to say `This is a bug in discern.` and names the saved file.

Other stops look different: a failing test or a refusal exits with code `1`, and its result names its own next step. A `discern.toml` that can't be read also exits with `1`, with the code `invalid_toml` or `invalid_config`. Stopping a command with Ctrl-C isn't a crash either.

### Check the task before you retry

Say discern crashed while your agent was working on the recipe search task. Ask your agent:

> "discern crashed during the recipe search task. Read the crash report and the task's current status. Keep the unfinished work, follow any recovery status names, and tell me what's still unresolved."

The agent runs `discern status` in the task's worktree before it tries the command again, because the crash may have stopped the command partway, and status shows how far it got:

- A long run may still be going. The agent [reads it back](../20-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) instead of starting it again.
- A landing may have finished before the crash. Status shows whether the change is already on `main`.

If one of discern's tools crashed in your agent's session, the others keep working, so the agent carries on once it knows what state the task is in. The task is back on track when status shows where it stands and the command it retries finishes.

### Keep the report

discern keeps the newest 20 crash reports in your repository and never uploads them. If discern can't save a report in the repository, it saves the report in your system's temp directory instead and removes it after 24 hours, so copy the report somewhere safe if you need it. If discern can't save a report at all, the terminal output is the report, so copy it before you close the terminal.

A tool result in your agent's session leaves out the full error trace, so attach the saved file instead of the result.

### Report it

Open an issue on [discern's issue tracker](https://github.com/discern-sh/discern/issues). Include the report, what you were doing, and whether the recovery worked. Read the report before you share it, because an error can quote local paths from your machine. For a security problem, follow the [security policy](https://github.com/discern-sh/discern/blob/main/SECURITY.md) instead.

You don't need to crash discern again to make a useful report. If the same command crashes a second time, stop retrying it, and send both reports.

## Files named `discern-…` in the temp directory

discern writes a few kinds of file to your system's temp directory. You don't need to clean them up.

| Name starts with            | What it holds                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern-job-`              | The full output of one check. A result names it as `output_path`.                                                                                 |
| `discern-diag-`             | The full text of a failure message that the result shortened.                                                                                     |
| `discern-crash-`            | A crash report that discern couldn't save in the repository.                                                                                      |
| `discern-checkpoint-input-` | Input for the command that decides whether one of your project's review questions, a checkpoint, applies. It exists only while that command runs. |
| `discern-self-`             | A leftover folder discern uses when it runs outside a repository.                                                                                 |
| `discern-test-`             | A leftover folder from discern's own tests.                                                                                                       |

These files expire after 24 hours. `discern done`, `discern prepare`, and `discern test` remove expired ones as they run, at most once an hour and a batch at a time, so a file can stay a little longer.

If you need a command's output for an investigation, copy it before it expires, using the exact path the result names. Most names include the project and worktree, as in `discern-job-recipes-recipe-search-ec0b65-1415354c3920ea7.log`, and a similar name may belong to another task. Leave alone any file a command is still using.

## The `.git/discern` directory

Leave this directory in place, because discern keeps its working records here: Proof (its record of which commands passed), landing permissions you gave in advance, recovery records for interrupted runs and landings, the logbook of what discern's commands did, the list of services such as test databases that each worktree set up, and crash reports. Deleting it can remove what a task needs to finish or recover.

In a task's worktree, `.git` is usually a small file, not a folder, that points to Git's storage in your main checkout. Every worktree shares some of discern's records, and others belong to one worktree. The [runtime state reference](../30-reference/files-and-ownership.md#runtime-state-inside-git) lists which is which.

To take discern out of a project, follow [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md). `discern uninstall` refuses while any task worktree or recorded resource remains, and it keeps every Git reference, including recovery references that may be the only name left for some of your commits.

If a worktree folder came back after discern removed it, that's a different cleanup. See [a removed path came back](worktrees-and-resources.md#removal-failed-or-a-removed-path-came-back).

## The logbook looks empty or off

The **logbook** is discern's local record of what its commands did, such as which command ran and whether it passed. `discern patterns` reads it to find repeated problems. If that report looks empty or wrong, ask your agent to check the logbook. It runs `discern doctor`, which checks the logbook without changing your project:

| What doctor says                                                | What it means                                                      | What to do                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `healthy but empty`                                             | Recording works, and nothing has finished yet.                     | Nothing. It fills up as your agent works.                            |
| `recording is off ([project].record_logbook = false)`           | Your configuration turned recording off.                           | Set `[project].record_logbook = true` if you want a record.          |
| `the environment refused this invocation's logbook write probe` | Something stopped discern writing to the logbook folder.           | Give discern write access to the path doctor names, then retry once. |
| `skipped N invalid or unreadable entries`                       | Some lines couldn't be read. The rest of the history still counts. | Keep the files if you want to find out why.                          |

A command that can't write to the logbook still does its job, and that run goes unrecorded.

To start a fresh history, seal the old one into an archive with `discern patterns seal`. `discern patterns reset` deletes it for good. Both show a preview with `--dry-run`, and both ask you to confirm in a terminal. The [logbook reference](../30-reference/logbook.md#logbook-lifecycle) covers them. Don't delete the folder by hand to clear a warning, because that loses the history you were trying to understand.

## When to stop

Stop retrying when the same command crashes again, or when you can't tell whether a retry is safe. Keep the report and the task's worktree, and send the report.

Before you remove any of discern's files, use the command that owns them and read its preview. If it refuses because a command is still running, or because it can't tell who owns something, sort that out first. Your agent can do the investigating, and you decide what gets deleted.
