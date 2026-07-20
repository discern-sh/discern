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

discern keeps a logbook of its own use: every verb run (CLI or MCP, pass or fail) appends one JSON line to a plain-text file under `.git`, shared by every worktree. It exists so later versions can answer what a single run can't: which gate step has been slowing down, how many runs a task needed before green, where a metric stood six months ago.

- **Read it:** `cat .git/discern/logbook/*.jsonl`
- **Delete it:** remove `.git/discern/logbook/`. Nothing else references it.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops; existing files stay until you delete them.

## What a line contains

Names and numbers only. No code, no prompts, no command output, no file contents.

| Field          | Example                                         |
| -------------- | ----------------------------------------------- |
| `writer`       | `"1.2.0"` — which discern wrote it              |
| `verb`         | `"done"`                                        |
| `surface`      | `"cli"` or `"mcp"`                              |
| `driver`       | session hint; `--json`, terminal, CI in use     |
| `branch`       | `"agent/fix-upload-retry"`                      |
| `head`         | `"8131f41"` (short commit)                      |
| `clean`        | was the working tree clean?                     |
| `tree`         | a checksum of the uncommitted diff              |
| `outcome`      | `"ok"`, `"failed"`, or `"refused"`              |
| `failed_stage` | the gate stage that went red                    |
| `duration_ms`  | wall-clock milliseconds                         |
| `target`       | the `help` topic or `map` page read             |
| `flags`        | `["force"]` — names, never values               |
| `change`       | files/insertions/deletions/commits vs the trunk |
| `scopes`       | the configured scopes touched                   |
| `steps`        | per-step labels, outcomes, timings              |
| `diagnostics`  | tool, rule id, file path at most                |
| `standards`    | each standard's limit and measured value        |
| `epoch`        | a fingerprint of your config                    |

Each line carries a schema version; readers skip lines they don't recognize, and fields only accrete. Three rarer kinds sit beside the verb line: `config-change` when your config genuinely changes (section names, never values), `pin` when `discern standards --pin` tightens a limit (old bound, new bound, measured value — your ratchet's history), and `prune` when rotation removes old months.

## It never leaves the machine

The logbook is written under the git admin area, so it lands in no commit and needs no gitignore entry. Nothing transmits it: a test in discern's own gate proves the recording code can reach no network interface, so a change giving it one would fail discern's own build. Recording also never interferes — if the file can't be written, the verb runs as if the logbook didn't exist.

## Rotation and config epochs

Events land in month-stamped files (`2026-07.jsonl`); the newest 24 months are kept. Pruning is loud: removals land as a `prune` line digesting each removed month (counts by verb and outcome), so coarse trends outlive the raw lines.

The `epoch` fingerprint hashes your config's behavior-relevant settings, section by section, with a standard's `limit` masked out — so a pin doesn't move it, while a real edit (a command, a scope, an input list) does and logs a `config-change` line naming the section that moved.

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the full network, telemetry, and execution contract.
- [Files & ownership](artifact-ownership.md) — the enforced footprint the logbook path belongs to.
