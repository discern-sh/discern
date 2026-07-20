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

discern keeps a logbook of its own use. Every verb run (CLI or MCP, pass or fail) appends one JSON line to a plain-text file under `.git`, shared by all of the repository's worktrees. It exists so later discern versions can answer questions a single run can't: which gate step has been slowing down, how many runs a task needed before green, where a metric stood six months ago.

- **Read it:** `cat .git/discern/logbook/*.jsonl`
- **Delete it:** remove `.git/discern/logbook/`. Nothing else references it.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops; existing files stay until you delete them.

## What a line contains

Names and numbers only. No code, no prompts, no command output, no file contents.

| Field          | Example                                              |
| -------------- | ---------------------------------------------------- |
| `writer`       | `"1.2.0"` — the discern version that wrote the line  |
| `verb`         | `"done"`                                             |
| `surface`      | `"cli"` or `"mcp"`                                   |
| `driver`       | a session hint; were `--json`, a terminal, CI in use |
| `branch`       | `"agent/fix-upload-retry"`                           |
| `head`         | `"8131f41"` (short commit)                           |
| `clean`        | was the working tree clean?                          |
| `tree`         | a checksum of the uncommitted diff, when dirty       |
| `outcome`      | `"ok"`, `"failed"`, or `"refused"`                   |
| `failed_stage` | which gate stage went red (`"test"`, `"merge"`)      |
| `duration_ms`  | wall-clock milliseconds                              |
| `target`       | the `help` topic or `map` page a run looked up       |
| `flags`        | flag names passed (`["force"]`) — never values       |
| `change`       | files/insertions/deletions/commits vs the trunk      |
| `scopes`       | which configured scopes the change touched           |
| `steps`        | per-step labels, outcomes, timings                   |
| `diagnostics`  | tool, rule id, file path at most                     |
| `standards`    | each standard's limit and measured value             |
| `epoch`        | a fingerprint of your config                         |

Each line carries a schema version, and readers skip lines they don't recognize rather than misreading them. Fields only accrete — a line written on day one stays readable forever.

Beyond the everyday verb line there are three rarer kinds: a `config-change` line when your config genuinely changes (section names only, never values), a `pin` line when `discern standards --pin` tightens a limit (the old and new bound and the measured value — your ratchet's history, readable straight back out), and a `prune` line when rotation removes old months.

## It never leaves the machine

The logbook is written under the git admin area, so it lands in no commit and needs no gitignore entry. Nothing transmits it: a test in discern's own quality gate proves the recording code can reach no network interface, so a change that gave it one would fail discern's own build. Recording also never interferes — if the file can't be written, the verb runs as if the logbook didn't exist.

## Rotation and config epochs

Events land in month-stamped files (`2026-07.jsonl`); the newest 24 months are kept. Pruning is loud: the removals land as a `prune` line carrying a small digest of each removed month — run counts by verb and outcome — so coarse trends outlive the raw lines.

The `epoch` fingerprint hashes your config's behavior-relevant settings, section by section, with a standard's `limit` masked out — so `discern standards --pin` doesn't move it, while a real edit (a command, a scope, an input list) does and logs a `config-change` line naming the section that moved.

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the full network, telemetry, and execution contract.
- [Files & ownership](artifact-ownership.md) — the enforced footprint the logbook path belongs to.
