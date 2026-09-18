---
id: troubleshoot-crashes-and-local-state
title: "Crashes and local state"
description: "Recover after a crash, preserve a useful report, and identify local files before removing them."
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

If discern reports a crash, keep its report and inspect the task's state before retrying. If you are here because a local directory looks unfamiliar, use the sections below to identify it before removing anything.

> discern crashed during this task. Read its report and current status, preserve the unfinished work, and follow any recorded recovery action. Tell me what remains unresolved.

## discern crashed

Run `discern status` in the task's checkout and follow the reported recovery. In particular, an interrupted run may still be going and can be [read back](../10-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see), while an interrupted acceptance may already have landed the change. Inspect those facts before repeating an action.

You can recognize an internal crash by:

| Surface      | What you see                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| CLI          | Exit code `70`, with a stderr report naming the version, command, error, stack, and saved report path.                            |
| JSON or MCP  | `ok: false` and `error: "internal_error"`. An MCP call can fail while the server remains available.                               |
| Saved report | A text file under `discern/crash/` in the common Git directory, or a system-temp fallback when repository storage is unavailable. |

A failed project check or a normal refusal is a different result, usually exit `1`. It has its own diagnostic and recovery.

Keep the saved crash report if the problem needs investigation. discern retains the newest twenty reports in the repository and does not upload them. If saving fails, the CLI's stderr report remains the evidence available to copy. An MCP result omits the full stack, so its saved report is particularly useful.

For a bug report, use [discern's issue tracker](https://github.com/discern-sh/discern/issues) and include the report, what you were doing, and whether the documented recovery worked. Review the file before sharing: an error can quote local paths or other details from the command. For a security issue, follow the [security policy](https://github.com/discern-sh/discern/blob/main/SECURITY.md).

You do not need to cause another crash to make a useful report. If the same action keeps crashing, preserve the evidence and investigate or report it before another attempt.

## Files named `discern-…` in the temp directory

No cleanup is normally needed. discern sweeps expired registered artifacts during later gate runs, in bounded batches. The retention threshold is 24 hours; it is not a promise that a background process will remove each file at that exact time.

Use the path from your result to find a log. A similarly named file may belong to another checkout or project.

| Prefix                      | What it holds                                                       |
| --------------------------- | ------------------------------------------------------------------- |
| `discern-job-`              | A gate job's full captured output, available through `output_path`. |
| `discern-diag-`             | The full text behind a truncated diagnostic.                        |
| `discern-crash-`            | A crash report saved in the temp directory.                         |
| `discern-checkpoint-input-` | Structured input for a checkpoint command.                          |
| `discern-self-`             | A fallback command shim used when no repository root is available.  |
| `discern-test-`             | Scaffolding from discern's own tests.                               |

Keep output you need for an investigation before it expires. Leave artifacts used by a running process alone; a filename prefix is not evidence that its owner has finished.

## The `.git/discern` directory

Leave this directory in place during recovery. It contains working records such as Proof, completion and recovery state, the logbook, resource ownership, and wait continuations. Deleting it can remove the evidence needed to finish or recover a task.

In a linked worktree, `.git` is usually a file pointing to Git's administrative storage. Some discern records belong to the common repository; others belong to one worktree. The [runtime-state reference](../30-reference/files-and-ownership.md#runtime-state-inside-git) identifies those lifetimes.

To remove discern from a project, follow [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md). `discern uninstall` checks for registered linked worktrees and recorded external resources before removing runtime state. It retains recovery refs that may be the only names left for user-authored commits.

For a reappeared checkout directory, use the separate [removed-path recovery](worktrees-and-resources.md#removal-failed-or-a-removed-path-came-back). Runtime metadata and a retired checkout need different cleanup procedures.

## The logbook looks empty or off

Read the reported recording state before treating an empty view as a failure:

- **Enabled and empty:** no events have been recorded yet. This is healthy on first use.
- **Disabled:** check the project's logbook configuration if you expected recording.
- **Write denied:** repair access to the named location. That process stops recording after warning; the task itself can continue.
- **Invalid or incomplete history:** preserve the files and use the reported diagnosis. An interrupted command may have a start record without a finish record.

The [Logbook reference](../30-reference/logbook.md#logbook-lifecycle) covers archive, reset, and recovery. Those commands let you review and confirm what will happen to the history; deleting the directory to clear a warning loses the record you are trying to understand.

## When to stop

Stop a retry when the current evidence does not establish that it is appropriate, or when the same crash remains unexplained. Keep the report and any named recovery state so investigation can continue.

Before sharing a report, review what it contains. Before removing state, use the command responsible for that state and read its plan. If it refuses because ownership or a running process is uncertain, resolve that uncertainty first.
