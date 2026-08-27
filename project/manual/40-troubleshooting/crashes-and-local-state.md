---
id: troubleshoot-crashes-and-local-state
title: "Crashes and local state"
description: "Identify a crash report or temporary/local evidence artifact, preserve useful evidence, and remove it only through its owner."
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
redirect_from:
  - "/docs/reference/crash-reports"
  - "/docs/reference/temp-files-and-retention"
---

# Crashes and local state

Identify a crash report or temporary/local evidence artifact, preserve useful evidence, and remove it only through its owner.

## Crash reports

_What discern does when it fails on a bug in itself, and where to find the evidence._

A red check, a refused precondition, or a broken `discern.toml` is a normal result: the command explains itself, and the CLI exits `1`. A crash is an error discern's own code did not expect. On the CLI, a crash prints a stderr frame and exits `70`; `--json` also emits a structured result on stdout. Over Model Context Protocol (MCP), only the affected tool call fails, and the server stays available. Both surfaces try to save a local report.

### What discern records

- **A report file, when the write succeeds.** discern first tries `<git-common-dir>/discern/crash/<timestamp>-<pid>-<unique>.txt`. The plain-text file carries the discern version, Deno runtime, platform, command, error, and stack. That directory keeps the newest 20 reports. Outside a Git repository, discern tries the system temp directory instead. If neither write succeeds, crash handling continues without a file.
- **A stderr frame on the CLI.** It names the discern version, command, full error and stack, issue tracker, and saved report path. If the report write failed, the frame says so.
- **A formatted result with `--json`, `--markdown`, and MCP.** Its prepared envelope has `ok: false`, `error: "internal_error"`, and a `message` with the error name, error message, and saved report path when available. It has no `data` or stack. JSON and MCP expose the envelope directly; Markdown presents the same state and recovery action. An MCP tool crash does not stop the server.
- **A Logbook signature when recording is available.** If discern resolves a configured Git project with its Logbook enabled, [the Logbook](../30-reference/logbook.md) records a failed event whose `crash` field holds the error class and one code location. It omits the error message and stack. A crash before root or configuration resolution, with unreadable configuration, or with the Logbook disabled leaves no Logbook line.
- **Exit code `70` on the CLI.** This is distinct from the ordinary failure exit `1`, so a script can tell "discern hit a bug" from "the check failed". See [CLI exit codes](../30-reference/mcp-and-results.md#cli-exit-codes). MCP does not exit the server process for a tool crash.

Nothing is uploaded. discern makes no network calls, so a crash report exists only on your machine until you share it.

### Reporting one

Attach the report file to a new issue at [github.com/jackwh/discern/issues](https://github.com/jackwh/discern/issues). It includes the version and runtime block, command, full error, and stack. The error can quote paths from your machine, so review the file before attaching it. If a CLI crash could not save the file, copy the error and stack from its stderr frame. An MCP envelope has no stack, so preserve the report file when one was written.

## Temp files & retention

_discern keeps selected temporary output for 24 hours so you can inspect it after a run. A registry defines each file family and its retention rule._

### Files in your temp directory

Every family carries a registered prefix and a random name:

| Prefix           | What it holds                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `discern-job-`   | A Gate job's full output. Results expose this file as `output_path` so it remains available after the run. |
| `discern-diag-`  | The full text behind a truncated diagnostic.                                                               |
| `discern-crash-` | A crash report written outside any repository ([crash reports](crashes-and-local-state.md)).               |
| `discern-self-`  | A fallback self-shim for a run with no repository root.                                                    |
| `discern-test-`  | Scaffolds from discern's own test suite. Installed runtime commands do not create this family.             |

Each file remains for 24 hours after its run. Gate verbs remove expired files in pages of at most 500. A lock under the shared Git directory limits each repository to one page per hour. A burst of runs therefore scans the temp directory once, and each Gate start performs at most one page of cleanup ([ADR 0216](https://discern.sh/docs/decisions/0216-temp-retention-is-repository-throttled-and-inspection-bounded), [ADR 0249](https://discern.sh/docs/decisions/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded)).

### The self-shim

Commands the Gate runs resolve `discern` to the engine that started them through a small shim script ([ADR 0182](https://discern.sh/docs/decisions/0182-operator-commands-resolve-discern-to-the-running-engine)). The shim normally lives in one content-addressed directory per engine under the worktree's Git administrative area. Every process for that engine shares the directory, and worktree removal removes it. A run with no repository root instead uses a per-process temp directory that the retention sweep removes.

### Removal

Runtime state under `.git/discern/` includes the Logbook, Proofs, locks, and shim. `discern uninstall` removes it, but refuses while the resource ledger still records provisioned resources. [Files and ownership](../30-reference/files-and-ownership.md) lists every registered path and its lifetime.
