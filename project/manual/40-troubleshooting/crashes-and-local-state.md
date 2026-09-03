---
id: troubleshoot-crashes-and-local-state
title: "Crashes and local state"
description: "Recognize a crash and report it well, understand the temporary and runtime files discern keeps, and remove local state only through its owner."
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

You're here because discern itself hit a bug, or because files with discern's name on them are sitting on the machine and you're deciding what's safe to do about them. Both have the same underlying promise — everything discern records stays local until you choose to share it, and everything it keeps has an owner responsible for cleaning it up. Knowing the owners is what makes cleanup safe; the failure mode this page prevents is deleting evidence, or another process's state, by hand.

## discern crashed

A red check, a refused precondition, or a broken `discern.toml` is a _normal_ result: the command explains itself and the CLI exits `1`. A crash is different — an error discern's own code didn't expect. You can recognize it on any surface:

- **On the CLI**, a stderr frame names the discern version, the command, the full error and stack, and where the report was saved. The exit code is `70`, distinct from `1`, so scripts can tell "discern hit a bug" from "the check failed".
- **In structured output and over MCP**, the result is `ok: false` with `error: "internal_error"`. An MCP tool crash fails only that call — the server stays available for the next one.
- **Locally**, discern saves a plain-text report when it can: under the repository's Git directory (`discern/crash/`, newest twenty kept), or in the system temp directory when no repository applies. If the write itself fails, the stderr frame says so and remains your copy of the evidence.

Nothing is uploaded anywhere. discern makes no network calls, so a crash report exists only on your machine until you attach it somewhere yourself.

**Recover first, then report.** Run `discern status` to see the current state — a crash mid-command leaves durable state, not guesses, and effectful commands are built to converge when rerun. If the same command crashes the same way twice, stop rerunning: you've confirmed it's reproducible, which is what a report needs.

**Report it well.** Open an issue at [github.com/jackwh/discern/issues](https://github.com/jackwh/discern/issues) and attach the report file — it carries the version, runtime, command, error, and stack. Read it before attaching: the error can quote paths from your machine. When a crash arrived over MCP, the formatted result omits the stack, so the saved report file is the copy worth keeping. For a security issue, follow the repository's `SECURITY.md` instead of posting publicly.

## Files named `discern-…` in the temp directory

Selected command output is kept in your system temp directory for 24 hours so you can inspect it after a run. The most useful family is a Gate job's full output, which results reference as `output_path` so a long log survives the run that produced it. Each family carries a registered prefix:

| Prefix           | What it holds                                                           |
| ---------------- | ----------------------------------------------------------------------- |
| `discern-job-`   | A Gate job's complete captured output.                                  |
| `discern-diag-`  | The full text behind a truncated diagnostic.                            |
| `discern-crash-` | A [crash report](#discern-crashed) written outside any repository.      |
| `discern-self-`  | A fallback command shim for a run that had no repository root.          |
| `discern-test-`  | Scaffolding from discern's own test suite — never from normal commands. |

No action is needed: expired files are swept automatically, in small bounded pages so a burst of Gate runs doesn't stall on cleanup. Deleting them early costs you nothing but the ability to inspect the output they held; leave a `discern-job-` file alone while its Gate is still running, though.

## The `.git/discern` directory

discern's runtime state lives inside the repository's Git directory, out of your working tree and out of your commits. It holds the [Logbook](../30-reference/logbook.md), current Gate Proof, wait continuations, the resource ledger, retired-worktree-path records, and the shim that lets commands the Gate spawns find the engine that started them.

Treat it as owned storage. Nothing in normal use requires touching it, and hand-deleting it destroys real evidence — Proof that acceptance would have reused, Logbook history, the records that make [reappeared-path cleanup](worktrees-and-resources.md#removal-failed-or-a-removed-path-came-back) safe. The supported removal is `discern uninstall`, which takes runtime state with it — and refuses while provisioned worktree resources remain, so nothing external is orphaned by the exit. [Files and ownership](../30-reference/files-and-ownership.md) lists every path discern writes and who owns its lifecycle.

## The Logbook looks empty or off

The Logbook is discern's local record of runs and outcomes, and its quiet states are mostly healthy ones. An enabled Logbook with nothing in it hasn't seen events yet. A denied write warns and disables recording _for that process_ without blocking the work — recording is advisory and never blocks a command. Disabled-by-configuration, invalid, and missed-event states are reported distinctly, so a result telling you recording is off also tells you why. The [Logbook reference](../30-reference/logbook.md) covers storage, rotation, and the archive and reset lifecycle, each an explicit command there.

## When to stop

Stop rerunning after the second identical crash — report it instead. Stop before deleting anything under `.git/discern` or a path another process is writing; both have owners, and both removals have supported commands that verify what hand-deletion would guess. And when a report would leave your machine, the stopping point is yours: review what the file quotes before you attach it.
