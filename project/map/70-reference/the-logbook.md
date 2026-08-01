---
title: The logbook
description: What discern records about its own verb runs, where the file lives, and how to read, delete, or disable it.
order: 80
aliases:
  - logbook
  - usage recording
  - operational history
---

# The logbook

_With recording on and `discern.toml` readable, each CLI verb run and each Model Context Protocol (MCP) invocation resolved to that project adds local, metadata-only history. Effectful verbs add a paired start and completion._

The pair shares an invocation id; worktrees share one plain-text file under `.git`.

An MCP call whose explicit `path` falls outside every discern project returns `not_initialized` and records nothing: no project logbook to host the event, no readable setting to consent to it.

- **Read it:** `discern patterns` reports the findings ([practice patterns](../20-quality-gate/patterns.md)); `cat .git/discern/logbook/*.jsonl` shows the raw lines.
- **Delete it:** `discern patterns reset` (preview with `--dry-run`). Nothing else references the files it removes.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops; existing files stay until you reset them.

## What it powers

Everything here switches off with `[project].logbook = false`; `discern patterns` alone keeps reading existing history.

- the practice report (`discern patterns`) — behavior, gate-fit, funnel, and trajectory findings over accumulated runs
- each worktree's last action and work in flight — the fleet survey's `last_action` and `running` columns
- fleet activity times that include verb runs — a long test run no longer reads as dormancy
- config-change attribution and each standard's limit history — the `config-change` and `pin` events
- `tip-adoption` counts — whether each shown tip's invited verb ran before that tip appeared again
- advisory findings on `status`, the `done` receipt, and `improvement`
- wait estimates when concurrent test runs queue
- the in-flight check on the contained-worktree offer — a logbook-off install falls back to a one-hour quiet period

## Where findings appear

Each detector declares a scope and a tier. Scope selects the reader. Tier controls whether a working command may run it ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

| Reader                | Findings it carries                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`        | Inline branch findings after a qualifying green receipt, capped at 1 line and held to a higher bar.                                                                          |
| `discern status`      | Inline session findings as observation-plus-next-step hints after setup is complete.                                                                                         |
| `discern improvement` | Inline project findings in the advisory `data.history.findings` group.                                                                                                       |
| `discern patterns`    | Every finding: up to 3 attention pointers, blocks grouped by family and standard sparklines for humans, globally strength-ranked JSON, and insufficient-evidence accounting. |

The working commands inspect at most the newest 200 events. `patterns` reads the full retained stream. Every route is advisory: findings change no command outcome, exit code, failed gate stage, score, receipt identity, or acceptance decision.

## What a line contains

Names and numbers only. No code, no prompts, no command output, no file contents.

| Field          | Example                                         |
| -------------- | ----------------------------------------------- |
| `kind`         | `"begin"`, `"verb"`, or a rarer event kind      |
| `invocation`   | the opaque id joining a start and completion    |
| `writer`       | `"1.2.0"` — which discern wrote it              |
| `verb`         | `"done"`                                        |
| `surface`      | `"cli"` or `"mcp"`                              |
| `driver`       | session, mode, CI, and possible agent signals   |
| `branch`       | `"agent/fix-upload-retry"`                      |
| `head`         | `"<short commit ID>"`                           |
| `clean`        | was the working tree clean?                     |
| `tree`         | a checksum of the uncommitted diff              |
| `outcome`      | `"ok"`, `"failed"`, `"partial"`, or `"refused"` |
| `failed_stage` | the gate stage that went red                    |
| `crash`        | error class name and one code location          |
| `duration_ms`  | wall-clock milliseconds                         |
| `target`       | `map`/`docs` page served, miss, or new branch   |
| `flags`        | `["force"]` — names, never values               |
| `change`       | files/insertions/deletions/commits vs the trunk |
| `scopes`       | the configured scopes touched                   |
| `steps`        | per-step labels, stages, outcomes, timings      |
| `diagnostics`  | tool, rule id, file path at most                |
| `hint_ids`     | stable ids of advice delivered with the result  |
| `tip_ids`      | stable ids of desk tips shown during the run    |
| `standards`    | each standard's limit and measured value        |
| `consent`      | consent source and matched scopes on accept     |
| `landing`      | recovery, trunk, worktree, and branch effects   |
| `epoch`        | a fingerprint of your config                    |

`partial` marks an error after an irreversible effect. `crash` appears only when the run died on an unexpected throw (a bug in discern) and holds the error's class name, such as `"TypeError"`, plus one trimmed code location. The logbook omits the message and stack; a saved [crash report file](crash-reports.md) holds the full error text. `tip_ids` appears only when the desk showed a tip and carries the registry id verbatim. The tip-adoption reader joins that id to the tip's declared verbs. The landing-authority detectors that read `consent` are covered in [practice patterns](../20-quality-gate/patterns.md).

Each line carries a schema version. Readers skip unknown lines, and fields only accrete. `begin` carries the writer, verb, surface, driver evidence, branch, commit, config epoch, and invocation id; completion adds outcome and duration. Rarer kinds are `config-change` (section names, never values), `pin` (old bound, new bound, measured value), and rotation's `prune`.

### Possible agent identity signals

`driver.agent_signals` is an optional list of evidence derived when the event is recorded. It supplies no detected-agent verdict. Each item has an `agent`, a `source`, and the marker names that matched. Items can appear together. Their order is not a ranking.

The source explains the marker's lifetime:

- `process-environment` records names such as `CODEX_THREAD_ID` or `GEMINI_CLI`. Their values are never stored.
- `mcp-client` means the MCP client's declared name or title matched a known client name.
- `host-filesystem` is ambient machine state. The current `/opt/.devin` marker can persist after Devin's installation, so it does not mean Devin drove that invocation.

For an MCP call, `driver.mcp_client` retains the declared `name`, optional `title`, and `version`, capped at 256 characters each. Readers classify it through the current catalogue. A newly recognized name attributes old and new events on the next read without changing stored lines. Unknown clients remain visible.

The read-time view preserves non-MCP evidence and merges duplicate agent/source pairs. A current MCP match replaces stored MCP evidence from the same declaration. Without a current match, stored MCP evidence remains. Independent sources that disagree leave the run unattributed.

MCP describes the client implementation. An editor, extension, or proxy may sit between discern and the coding agent. These signals can be absent, inherited, or faked. They never change output, guidance, setup, gate behavior, or landing authority.

## It never leaves the machine

The logbook is written under the git admin area, so it lands in no commit and needs no gitignore entry. Nothing transmits it: a test in discern's own gate proves the recording code can reach no network interface. Recording also never interferes — if the file can't be written, the verb runs as if the logbook didn't exist.

## Rotation and config epochs

Events land in month-stamped files (`2026-07.jsonl`), and rotation keeps the newest 24 months. Pruning is loud: removals land as a `prune` line digesting each removed month (counts by verb and outcome, including a separate partial count), so coarse trends outlive the raw lines.

The `epoch` fingerprint hashes your config's behavior-relevant settings, section by section, with a standard's `limit` masked out — so a pin doesn't move it, while a real edit (a command, a scope, an input list) does and logs a `config-change` line naming the section that moved.

Tip-adoption episodes compare events only when the config epoch, discern writer release, and dominant MCP-client release match. A run on any branch, session, or surface can count. Another setup cannot resolve the episode. Missing setup evidence and the end of history stay censored ([ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the full network, telemetry, and execution contract.
- [Files & ownership](artifact-ownership.md) — the enforced footprint the logbook path belongs to.
- Why identity stays evidence rather than a verdict, and how the shared catalogue supports it ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)).
