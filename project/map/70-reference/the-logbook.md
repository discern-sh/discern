---
title: The logbook
description: What discern records about its own verb runs, where the file lives, and how to read, delete, or disable it.
order: 50
aliases:
  - logbook
  - usage recording
  - operational history
---

# The logbook

_One line of local, metadata-only history per verb run: what's in it, where it lives, and the switch that stops it._

discern keeps a logbook of its own use. Every verb run (CLI or MCP, pass or fail) appends one JSON line to a plain-text file under `.git`, shared by all of the repository's worktrees. It exists so later discern versions can answer questions a single run can't: which gate step has been slowing down, how many runs a task needed before green.

- **Read it:** `cat .git/discern/logbook/*.jsonl`
- **Delete it:** remove `.git/discern/logbook/`. Nothing else references it.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops; existing files stay until you delete them.

## What a line contains

Names and numbers only. No code, no prompts, no command output, no file contents.

| Field         | Example                            |
| ------------- | ---------------------------------- |
| `verb`        | `"done"`                           |
| `surface`     | `"cli"` or `"mcp"`                 |
| `branch`      | `"agent/fix-upload-retry"`         |
| `head`        | `"8131f41"` (short commit)         |
| `clean`       | was the working tree clean?        |
| `outcome`     | `"ok"` or `"failed"`               |
| `duration_ms` | wall-clock milliseconds            |
| `steps`       | per-step labels, outcomes, timings |
| `diagnostics` | tool, rule id, file path at most   |
| `epoch`       | a fingerprint of your config       |

Each line carries a schema version, and readers skip lines they don't recognize rather than misreading them.

## It never leaves the machine

The logbook is written under the git admin area, so it lands in no commit and needs no gitignore entry. Nothing transmits it: a test in discern's own quality gate proves the recording code can reach no network interface, so a change that gave it one would fail discern's own build. Recording also never interferes — if the file can't be written, the verb runs as if the logbook didn't exist.

## Rotation and config epochs

Events land in month-stamped files (`2026-07.jsonl`); the newest 12 months are kept, and pruning records what it removed as an event.

The `epoch` fingerprint hashes your config's behavior-relevant settings, section by section, with a standard's `limit` masked out — so `discern standards --pin` doesn't move it, while a real edit (a command, a scope, an input list) does and logs a `config-change` line naming the section that moved.

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the full network, telemetry, and execution contract.
- [Files & ownership](artifact-ownership.md) — the enforced footprint the logbook path belongs to.
