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

discern keeps a logbook of its own use: every verb run through the command line or Model Context Protocol (MCP), pass or fail, appends one JSON line to a plain-text file under `.git`, shared by every worktree. It exists so later versions can answer what a single run can't: which gate step has been slowing down, how many runs a task needed before green, where a metric stood six months ago.

- **Read it:** `discern patterns` reports the findings ([practice patterns](../20-quality-gate/patterns.md)); `cat .git/discern/logbook/*.jsonl` shows the raw lines.
- **Delete it:** `discern patterns reset` (preview with `--dry-run`). Nothing else references the files it removes.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops; existing files stay until you reset them.

## Where findings appear

Each detector declares a scope and a tier. Scope selects the reader. Tier controls whether a working command may run it ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

| Reader                | Findings it carries                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `discern done`        | Inline branch findings after a qualifying green receipt, capped at 1 line and held to a higher bar. |
| `discern status`      | Inline session findings as observation-plus-next-step hints after setup is complete.                |
| `discern improvement` | Inline project findings in the advisory `data.history.findings` group.                              |
| `discern patterns`    | Every finding, including batch detectors and insufficient-evidence accounting.                      |

The working commands inspect at most the newest 200 events. `patterns` reads the full retained stream. Every route is advisory: findings change no command outcome, exit code, failed gate stage, score, receipt identity, or acceptance decision. Set `[project].logbook = false` to suppress every working-command finding as well as future recording.

## What a line contains

Names and numbers only. No code, no prompts, no command output, no file contents.

| Field          | Example                                         |
| -------------- | ----------------------------------------------- |
| `writer`       | `"1.2.0"` — which discern wrote it              |
| `verb`         | `"done"`                                        |
| `surface`      | `"cli"` or `"mcp"`                              |
| `driver`       | session, mode, CI, and possible agent signals   |
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
| `steps`        | per-step labels, stages, outcomes, timings      |
| `diagnostics`  | tool, rule id, file path at most                |
| `standards`    | each standard's limit and measured value        |
| `epoch`        | a fingerprint of your config                    |

Each line carries a schema version. Readers skip lines they don't recognize, and fields only accrete. Rarer kinds sit beside the verb line: `config-change` when your config genuinely changes (section names, never values), `pin` when `discern standards --pin` tightens a limit (old bound, new bound, measured value — your ratchet's history), and `prune` when rotation removes old months.

### Possible agent identity signals

`driver.agent_signals` is an optional list of evidence. It supplies no detected-agent verdict. Each item has an `agent`, a `source`, and the marker names that matched. Several items can appear together, and their order is not a ranking.

The source explains the marker's lifetime:

- `process-environment` records names such as `CODEX_THREAD_ID` or `GEMINI_CLI`. Their values are never stored.
- `mcp-client` means the MCP client's declared name or title matched a known client name.
- `host-filesystem` is ambient machine state. The current `/opt/.devin` marker can persist after Devin's installation, so it does not mean Devin drove that invocation.

For an MCP call, `driver.mcp_client` also retains the client's declared `name`, optional `title`, and `version`. Each field has a 256-character cap. MCP describes the client implementation. An editor, extension, or proxy may sit between discern and the coding agent. These signals can be absent or inherited, and clients can fake them. discern records them for cautious interpretation. They never change output, guidance, setup, or gate behavior.

## It never leaves the machine

The logbook is written under the git admin area, so it lands in no commit and needs no gitignore entry. Nothing transmits it: a test in discern's own gate proves the recording code can reach no network interface, so a change giving it one would fail discern's own build. Recording also never interferes — if the file can't be written, the verb runs as if the logbook didn't exist.

## Rotation and config epochs

Events land in month-stamped files (`2026-07.jsonl`), and rotation keeps the newest 24 months. Pruning is loud: removals land as a `prune` line digesting each removed month (counts by verb and outcome), so coarse trends outlive the raw lines.

The `epoch` fingerprint hashes your config's behavior-relevant settings, section by section, with a standard's `limit` masked out — so a pin doesn't move it, while a real edit (a command, a scope, an input list) does and logs a `config-change` line naming the section that moved.

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the full network, telemetry, and execution contract.
- [Files & ownership](artifact-ownership.md) — the enforced footprint the logbook path belongs to.
- Why identity stays evidence rather than a verdict, and how the shared catalogue supports it ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)).
