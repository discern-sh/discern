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

If discern crashes, your task's work is still in its **worktree**, the separate copy of the project your agent works in. discern also saves a report you can send us. When you find a discern file you don't recognize, you can check what it holds before deleting it.

## discern crashed

A crash means discern hit a bug of its own. You'll see one of these:

| Where you ran it | What you see                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A terminal       | Exit code `70` and ``discern <version> crashed while running `<command>`.``, then `This is a bug in discern.` and the saved report's path. |
| An agent's tool  | A result with `ok: false` and `error: "internal_error"`, whose message says where the report is saved.                                     |
| The saved report | A file in your repository's `.git/discern/crash/` folder.                                                                                  |

A failing test, a refusal, or an unreadable `discern.toml` (`invalid_toml` or `invalid_config`) isn't a crash: the command exits with code `1`. Stopping a command with Ctrl-C isn't a crash either.

### Check the task before you retry

Say discern crashed during the recipe search task. Ask your agent:

> "discern crashed during recipe search. Read the crash report and the task's status, keep the unfinished work, and tell me what's unresolved."

Your agent runs `discern status` in the task's worktree before retrying, because the crash may have stopped the command partway. A long run may still be going, so your agent [reads it back](../20-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) instead of starting again. Status also shows whether a landing finished before the crash. The task is back on track when status shows where it stands and the retried command finishes.

### Keep the report

discern keeps recent crash reports in your repository and never uploads them. A report it couldn't save there goes to your temp directory for 24 hours, so copy it if you need it. If it couldn't save one at all, copy the terminal output before you close the terminal. Attach the saved file, because a tool result leaves out the full error trace.

### Report it

Open an issue on [discern's issue tracker](https://github.com/discern-sh/discern/issues) with the report, what you were doing, and whether recovery worked. Read the report before you share it, because an error can quote local paths from your machine. For a security problem, follow the [security policy](https://github.com/discern-sh/discern/blob/main/SECURITY.md) instead. If the same command crashes again, stop retrying it and send both reports.

## Files named `discern-…` in the temp directory

discern writes these to your temp directory, and you don't need to clean them up:

| Name starts with            | What it holds                                                                     |
| --------------------------- | --------------------------------------------------------------------------------- |
| `discern-job-`              | The full output of one command. A result names it as `output_path`.               |
| `discern-diag-`             | The full text of a failure message the result shortened.                          |
| `discern-crash-`            | A crash report discern couldn't save in the repository.                           |
| `discern-checkpoint-input-` | Short-lived input for the command that decides whether a review question applies. |
| `discern-self-`             | A leftover folder from running outside a repository.                              |
| `discern-test-`             | A leftover folder from discern's own tests.                                       |

They expire after 24 hours, and `discern done`, `discern prepare`, and `discern test` remove expired ones as they run. To keep a command's output, copy the file the result names, because another task may have one with a similar name.

## The `.git/discern` directory

Leave this directory in place, because deleting it can remove what a task needs to finish or recover. It holds discern's working records, such as Proof (its record of which commands passed), landing permissions you gave in advance, recovery records, and crash reports. In a task's worktree, `.git` is usually a small file pointing to this storage in your main checkout. The [runtime state reference](../30-reference/files-and-ownership.md#runtime-state-inside-git) lists each record.

To take discern out of a project, follow [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md) instead of deleting this directory. If a worktree folder came back after removal, see [a removed path came back](worktrees-and-resources.md#removal-failed-or-a-removed-path-came-back).

## The logbook looks empty or off

The **logbook** is discern's local record of what its commands did, and `discern patterns` reads it to find repeated problems. If that report looks empty or wrong, your agent checks the logbook with `discern doctor`, which changes nothing:

| What doctor says                                                | What it means                                            | What to do                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `healthy but empty`                                             | Recording works, and nothing has finished yet.           | Nothing. It fills up as your agent works.                            |
| `recording is off ([project].record_logbook = false)`           | Your configuration turned recording off.                 | Set it to `true` to record.                                          |
| `the environment refused this invocation's logbook write probe` | Something stopped discern writing to the logbook folder. | Give discern write access to the path doctor names, then retry once. |
| `skipped N invalid or unreadable entries`                       | Some lines couldn't be read, and the rest still count.   | Keep the files to find out why.                                      |

A command that can't write to the logbook still does its job, unrecorded. Don't delete the logbook to clear a warning, because that loses the history you're trying to understand. To start fresh, `discern patterns seal` archives it after you confirm in a terminal. [What stays on your machine](../10-understand/local-control.md) explains what the logbook records.

## When to stop

Stop retrying when the same command crashes again, or when you can't tell whether a retry is safe. Keep the task's worktree, and send the report. Before you remove any of discern's files, use the command that owns them and read its preview. Your agent can investigate, and you decide what gets deleted.
