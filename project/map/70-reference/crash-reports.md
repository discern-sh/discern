---
title: Crash reports
description: What discern leaves behind when it fails on a bug in itself — the saved report, exit code 70, the JSON envelope, and what to attach to an issue.
order: 90
aliases:
  - crash
  - crashes
  - crash report
  - exit code 70
  - internal_error
  - DISCERN_CRASH_PROBE
---

# Crash reports

_What discern does when it fails on a bug in itself, and where to find the evidence._

A red check, a refused precondition, or a broken `discern.toml` is a normal result: the command explains itself and exits `1`. A crash is an error discern's own code did not expect. When one happens, discern saves a report, prints what it knows, and exits `70`.

## What a crash leaves behind

- **A stderr frame.** The discern version, the command that was running, the full error and stack, and the saved report's path.
- **A report file.** `.git/discern/crash/<timestamp>-<pid>.txt`: plain text carrying the discern version, Deno runtime, platform, command, error, and stack. The newest 20 reports are kept. Outside a git repository the report lands in the system temp directory; the frame prints the path either way.
- **A logbook line.** [The logbook](the-logbook.md) records the failed run with a `crash` field holding the error's class name and one code location. The message appears only in the report file.
- **Exit code `70`.** Distinct from the ordinary failure exit `1`, so a script can tell "discern hit a bug" from "the check failed". See [CLI exit codes](mcp-and-results.md#cli-exit-codes).

With `--json`, stdout is still one result envelope: `ok: false`, `error: "internal_error"`, and a `message` naming the saved report. Over MCP a crashing tool call returns that same envelope, and the server keeps answering.

Nothing is uploaded. discern makes no network calls, so a crash report exists only on your machine until you share it.

## Reporting one

Attach the report file to a new issue at [github.com/jackwh/discern/issues](https://github.com/jackwh/discern/issues). It carries everything a fix needs to start: the version block, the command, and the stack. The error message can quote paths from your machine, so skim the file before attaching it. If the file is gone, the same text was printed on stderr.

## Trying it

Set `DISCERN_CRASH_PROBE=1` and run any command to see the frame, the report file, the logbook line, and exit `70`:

```bash
DISCERN_CRASH_PROBE=1 discern status
```

Unset the variable to return to normal.
