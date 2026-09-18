---
title: Crash reports
description: How discern reports unexpected internal errors across the CLI and MCP, where it saves local evidence, and what to attach to an issue.
order: 100
aliases:
  - crash
  - crashes
  - crash report
  - exit code 70
  - internal_error
---

# Crash reports

_What discern does when it fails on a bug in itself, and where to find the evidence._

A red check, a refused precondition, or a broken `discern.toml` is a normal result: the command explains itself, and the CLI exits `1`. A crash is an error discern's own code did not expect. On the CLI, a crash prints a stderr frame and exits `70`; `--json` also emits a structured result on stdout. Over Model Context Protocol (MCP), only the affected tool call fails, and the server stays available. Both surfaces try to save a local report.

## What discern records

- **A report file, when the write succeeds.** discern first tries `<git-common-dir>/discern/crash/<timestamp>-<pid>-<unique>.txt`. The plain-text file carries the discern version, Deno runtime, platform, command, error, and stack. That directory keeps the newest 20 reports. Outside a Git repository, discern tries the system temp directory instead. If neither write succeeds, crash handling continues without a file.
- **A stderr frame on the CLI.** It names the discern version, command, full error and stack, issue tracker, and saved report path. If the report write failed, the frame says so.
- **A formatted result with `--json`, `--markdown`, and MCP.** Its prepared envelope has `ok: false`, `error: "internal_error"`, and a `message` with the error name, error message, and saved report path when available. It has no `data` or stack. JSON and MCP expose the envelope directly; Markdown presents the same state and recovery action. An MCP tool crash does not stop the server.
- **A Logbook signature when recording is available.** If discern resolves a configured Git project with its Logbook enabled, [the Logbook](the-logbook.md) records a failed event whose `crash` field holds the error class and one code location. It omits the error message and stack. A crash before root or configuration resolution, with unreadable configuration, or with the Logbook disabled leaves no Logbook line.
- **Exit code `70` on the CLI.** This is distinct from the ordinary failure exit `1`, so a script can tell "discern hit a bug" from "the check failed". See [CLI exit codes](mcp-and-results.md#cli-exit-codes). MCP does not exit the server process for a tool crash.

Nothing is uploaded. discern makes no network calls, so a crash report exists only on your machine until you share it.

## Reporting one

Attach the report file to a new issue at [github.com/discern-sh/discern/issues](https://github.com/discern-sh/discern/issues). It includes the version and runtime block, command, full error, and stack. The error can quote paths from your machine, so review the file before attaching it. If a CLI crash could not save the file, copy the error and stack from its stderr frame. An MCP envelope has no stack, so preserve the report file when one was written.
