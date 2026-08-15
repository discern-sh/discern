---
title: The Logbook
description: What discern records about its own verb runs, where the files live, and how to read, archive, reset, or disable them.
order: 90
aliases:
  - logbook
  - usage recording
  - operational history
---

# The Logbook

_The Logbook is a local activity record containing metadata rather than code or output._

With recording on and `discern.toml` readable, each command-line interface (CLI) verb run and each Model Context Protocol (MCP) invocation resolved to that project adds an event. Effectful verbs add paired start and completion events with one invocation id. All worktrees share plain-text files under `.git`.

An MCP call whose explicit `path` falls outside every discern project returns `not_initialized` and records nothing. No project Logbook or readable consent setting applies to that path.

- **Read active history:** `discern patterns` reports the findings ([practice patterns](../20-quality-gate/patterns.md)). `cat .git/discern/logbook/*.jsonl` shows the raw active lines.
- **List and read sealed history:** `discern patterns archives`, then `discern patterns --logbook-file <filename>`. Add `--stats`, `--all`, or `--json` as needed.
- **Seal active history:** `discern patterns archive` (preview with `--dry-run`). A confirmed terminal action starts a fresh active Logbook and preserves the sealed event lines for later reports.
- **Delete active history:** `discern patterns reset` (preview with `--dry-run`). A confirmed terminal action removes only active history; sealed archives survive.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops. Existing active files remain until you archive or reset them.

## What it powers

Setting `[project].logbook = false` stops new evidence for every feature below. `discern patterns` can still read existing history.

- the practice report (`discern patterns`): behavior, Gate-fit, funnel, and trajectory findings over accumulated runs
- each worktree's last action and work in flight: the fleet survey's `last_action` and `running` columns
- fleet activity times that include verb runs, so a long test run does not appear dormant
- configuration-change attribution and each Standard's limit history: the `config-change` and `pin` events
- `tip-adoption` counts: whether each shown tip's invited verb ran before that tip appeared again
- advisory findings on `status`, the `done` Proof, and `improvement`
- wait estimates when concurrent test runs queue, and contention readings
- the in-flight check on the contained-worktree offer; an installation with recording off uses a one-hour inactivity period

## Where findings appear

Each detector declares a scope and a tier. Scope selects the reader. Tier controls whether a working command may run it ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

| Reader                | Findings it carries                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`        | The canonical summary for 1 inline branch finding after a qualifying green Proof, held to a higher threshold; `discern patterns` carries its full evidence.                |
| `discern status`      | The canonical summary and next step for inline session findings after setup finishes.                                                                                      |
| `discern improvement` | Complete inline project findings in the advisory `data.history.findings` group.                                                                                            |
| `discern patterns`    | Every finding: plain summary followed by concrete observed evidence, up to 3 attention pointers, family blocks, Standard sparklines, and insufficient-evidence accounting. |

The working commands inspect at most the newest 200 events. `patterns` reads the full retained stream. Every route is advisory. Findings change no command outcome, exit code, failed Gate stage, score, Proof identity, or acceptance decision.

The shared result contract keeps one meaning across these routes. A finding's `summary` states the condition in plain language; `observed` carries its count, denominator, named subject and conditions, and any material limitation. `brief` is retained as an exact compatibility alias of `summary`. Investigations use the same two layers and retain `interpretation` as an exact compatibility alias of `summary`. Shorter routes project the canonical summary instead of maintaining separate claims.

## What a line contains

Each line contains names and numbers. It excludes code, prompts, command output, and file contents.

| Field          | Example                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `kind`         | `"begin"`, `"verb"`, or a rarer event kind                              |
| `invocation`   | the opaque id joining a start and completion                            |
| `writer`       | `"1.2.0"` (which discern wrote it)                                      |
| `verb`         | `"done"`                                                                |
| `surface`      | `"cli"` or `"mcp"`                                                      |
| `driver`       | session, mode, CI, spawning invocation, and possible agent signals      |
| `branch`       | `"agent/fix-upload-retry"`                                              |
| `head`         | `"<short commit ID>"`                                                   |
| `clean`        | was the working tree clean?                                             |
| `tree`         | a checksum of the uncommitted diff                                      |
| `outcome`      | `"ok"`, `"failed"`, `"partial"`, or `"refused"`                         |
| `failed_stage` | the Gate stage that went red                                            |
| `crash`        | error class name and one code location                                  |
| `duration_ms`  | end-to-end wall-clock milliseconds                                      |
| `waited_ms`    | test-run slot-wait milliseconds on capped runs                          |
| `target`       | page served, miss, new branch, or queued command                        |
| `flags`        | `["force"]` (names without values)                                      |
| `change`       | files/insertions/deletions/commits vs the trunk                         |
| `scopes`       | the configured scopes touched                                           |
| `steps`        | per-step labels, stages, outcomes, timings                              |
| `validation`   | versioned validation-start and execution evidence                       |
| `diagnostics`  | tool, rule id, file path at most                                        |
| `hint_ids`     | stable ids of advice delivered with the result                          |
| `tip_ids`      | stable ids of desk tips shown during the run                            |
| `standards`    | each Standard's measurement, limit, margin, and Gate-owned pin decision |
| `consent`      | consent source and matched scopes on accept                             |
| `landing`      | recovery, trunk, worktree, and branch effects                           |
| `epoch`        | a fingerprint of your config                                            |

`partial` marks an error after an irreversible effect. `crash` appears only when discern encounters an unexpected throw and holds the error's class name, such as `"TypeError"`, plus one trimmed code location. The Logbook omits the message and stack. A saved [crash report file](crash-reports.md) holds the full error text. `tip_ids` appears only when the Desk showed a tip and carries the registry id verbatim. The tip-adoption reader joins that id to the tip's declared verbs. The landing-authority detectors that read `consent` are covered in [practice patterns](../20-quality-gate/patterns.md).

Readers skip unknown schema versions, and fields are append-only. `begin` carries run identity. Completion adds outcome and `duration_ms`. Capped runs add `waited_ms`, including `0`; uncapped and older events omit it. Readers derive execution as `duration_ms - (waited_ms ?? 0)` for priors and suite health. End-to-end statistics retain wall time. Other kinds are `config-change`, `pin`, and `prune`.

### Validation evidence

`done` and standalone `test` completion events add `validation`. `state` carries version, capture point, completeness, opaque keyed digests, counts/bytes, elapsed time, and failure categories. `execution` carries mode, writer, opaque config/setup/job-definition digests, job metadata, concurrency, and `passed`, `failed`, `skipped`, `cancelled`, or `unavailable` outcomes.

`done` captures after fix/build; `test` before its group. Blocks record `boundary/not-reached`. Complete state covers HEAD, index/checkout bytes, untracked files, and recursively clean submodules. Sparse/assume-unchanged state stays visible. Dirt, missing initialization, unreadability, unknown state, or a breached budget removes the digest.

`.git/discern/validation-hmac-key` is the regular `0600` key; unsafe targets make evidence incomplete. One 5-second deadline covers key, Git, files, submodules, cryptography, and execution; expiry records `budget/time-limit` without changing the verdict. Caps are 20,000 paths, 64 MiB, 1,000 jobs, and 1 MiB. Events exclude manifests, contents, commands, config/environment values, plain hashes, ignored files, services, clocks, randomness, runtime state, and concurrent processes. Older events without `validation` remain readable ([ADR 0273](../_adr/0273-validation-comparisons-require-complete-keyed-semantic-evidence.md)).

### Possible agent identity signals

`driver.agent_signals` is an optional list of evidence derived when the event is recorded. It supplies no detected-agent verdict. Each item has an `agent`, a `source`, and the marker names that matched. Items can appear together. Their order is not a ranking.

The source explains the marker's lifetime:

- `process-environment` records names such as `CODEX_THREAD_ID` or `GEMINI_CLI`. Their values are never stored.
- `mcp-client` means the MCP client's declared name or title matched a known client name.
- `host-filesystem` is ambient machine state. The current `/opt/.devin` marker can persist after Devin's installation, so it does not mean Devin drove that invocation.

`driver.spawned_by` carries the parent invocation id when the gate's job runner spawned the run: readers classify these as automation and join child to parent.

For an MCP call, `driver.mcp_client` retains the declared `name`, optional `title`, and `version`, capped at 256 characters each. Readers classify it through the current catalog. A newly recognized name attributes old and new events on the next read without changing stored lines. Unknown clients remain visible.

The read-time view preserves non-MCP evidence and merges duplicate agent/source pairs. A current MCP match replaces stored MCP evidence from the same declaration. Without a current match, stored MCP evidence remains. Independent sources that disagree leave the run unattributed.

MCP describes the client implementation. An editor, extension, or proxy may sit between discern and the coding agent. These signals can be absent, inherited, or faked. They never change output, guidance, setup, Gate behavior, or landing authority.

## Local storage only

discern writes the Logbook under the Git administrative area, outside commits and ignore rules. The Logbook writer has no network interface under a test in discern's own Gate. A write failure does not change the verb outcome; the verb continues without recording the event.

## Rotation and config epochs

Events use month-stamped files (`2026-07.jsonl`), and rotation keeps the newest 24 months. A `prune` line records each removed month with counts by verb and outcome, including a separate partial count. These aggregate counts remain after removal of the raw lines.

## Archive and reset lifecycle

[Logbook lifecycle](logbook-lifecycle.md) specifies the terminal confirmation, atomic archive boundary, recovery state, and historical source selector. Historical selection is advisory: Patterns and Stats may read a sealed file, but fleet activity, `status`, Proof hints, queue estimates, and work-in-flight checks always use the active Logbook.

The `epoch` fingerprint hashes behavior-relevant configuration section by section, with a Standard's `limit` masked out. A pin leaves the fingerprint unchanged. An edit to a command, scope, input list, or other behavior-relevant setting changes it and adds a `config-change` line naming the section.

Tip-adoption episodes compare events only when the config epoch, discern writer release, and dominant MCP-client release match. A run on any branch, session, or surface can count. Another setup cannot resolve the episode. Missing setup evidence and the end of history stay censored ([ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

## See also

- [Trust and your data](../00-orientation/trust-and-data.md): the full network, telemetry, and execution contract.
- [Files and ownership](artifact-ownership.md): the enforced footprint the Logbook path belongs to.
- Why identity stays evidence rather than a verdict, and how the shared catalog supports it ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)).
