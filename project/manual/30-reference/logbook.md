---
id: reference-logbook
title: "Logbook"
description: "Look up local Logbook fields, storage, epochs, rotation, archive/reset lifecycle, and practice-stat definitions."
order: 100
publish: true
kind: reference
aliases:
  - "reference-logbook"
  - "practice stats"
  - "discern patterns --stats"
  - "stats"
  - "brag"
  - "bragging rights"
  - "vanity metrics"
  - "The Logbook"
  - "usage recording"
  - "operational history"
  - "Logbook lifecycle"
  - "logbook archive"
  - "logbook reset"
  - "historical logbook"
redirect_from:
  - "/docs/quality-gate/practice-stats"
  - "/docs/reference/the-logbook"
  - "/docs/reference/logbook-lifecycle"
---

# Logbook

Look up local Logbook fields, storage, epochs, rotation, archive/reset lifecycle, and practice-stat definitions.

Prerequisite: Logbook recording must be enabled for new evidence. Existing active or sealed history remains readable after recording is disabled.

## Practice stats

_`discern patterns --stats` reads the [Logbook](logbook.md) for what went well and renders a card of plain counts, each with its denominator beside it._

```sh
discern patterns --stats
```

### What the card counts

| Section              | Counts                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted             | Changes accepted and the branches they came from; lines added and removed with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak.                                  |
| The Gate             | `done` runs and greens, the red runs the Gate stopped, the longest and current green streaks, first-try greens per branch, and hours of checks run across `done`, `prepare`, and `test`.                                          |
| Validation workflows | Clean, dirty, and unknown `prepare`, `test`, and `done` entry states; success, failure, and retry counts by route; test-first changes that later reached a clean committed Gate; evidence coverage and current dirty-state shape. |
| Pace                 | Starts that ended in an accepted change, measured start-to-accept cycles with the median and fastest times and how many finished inside a day, and the acceptance cadence across the span.                                        |
| Standards            | Limits tightened and how many Standards they cover, the average measured trend, and the most improved Standard.                                                                                                                   |
| Checkpoints          | Per-checkpoint economics: efforts fired, servings, declarations with unchanged-subject and unmet splits, variances across landed efforts, abandoned open questions, median time to declare. Most-served rows; remainder counted.  |
| Agents               | Attributed agent identities with their runs, usage series, and green-`done` shares.                                                                                                                                               |
| Breadth              | Branches driven, active days out of the span, the day the most branches were active, and the most changes in flight at one instant.                                                                                               |

An accepted change is a successful `accept`, and its scale reads from the recorded change counts. Streaks count consecutive `done` runs in stream order. A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](../20-understand/evidence-and-improvement.md#what-the-detectors-watch) matches them. A cycle therefore needs both ends on record: an accept whose start predates the Logbook counts as accepted without adding a cycle.

For the overlap reading, a branch is in flight from its first analyzed event to its last. A pause inside that window stays in flight. A branch stops counting after its last event, and the trunk is not a change. The Standards trend normalizes each Standard to its own first reading, direction-adjusted so improvement is always positive. That shared scale lets a coverage floor and a byte-size ceiling average into one line, and lets "most improved" compare like-for-like. The Agents section uses the same cohort boundary as the detectors: the card counts identities below the reporting minimums without listing them, and always states the unattributed share.

### Validation workflow cycles

A validation workflow run is an analyzed `prepare`, `test`, or `done`; recorded `clean` is its entry state. Complete, incomplete, legacy, and unattributed evidence share one run denominator. At the standalone-test boundary, complete dirty validation counts tracked-only, untracked-only, mixed, or unclassified state without filenames. Full-Gate evidence follows mutating pre-groups, so a dirty entry remains unclassified instead of mixing moments.

A validation workflow cycle links recorded events on one branch under one config epoch ([ADR 0275](https://discern.sh/docs/decisions/0275-validation-workflows-use-stream-bounded-change-cycles)). A successful `start` for a reused branch, a successful `accept`, or an epoch change closes it. After a clean green Gate, a later dirty entry or different recorded HEAD begins another cycle. A run without an epoch stands alone.

A commit does not automatically end a cycle. Dirty pre-commit validation at one HEAD and the later clean `done` at its new committed HEAD stay in the same cycle. The test-first route begins dirty, the commit-first route begins clean, and an unknown first entry remains unattributed. The narrower pre-commit-to-clean-Gate count requires a dirty run, a later distinct recorded HEAD, and a clean green `done` on that later HEAD. Cycle construction uses the recorded stream only, so archived reports have the same result without consulting the current Git graph.

Each route reports cycles, branches, runs, successful and failed runs, cycles that reached a clean Gate, cycles with a failure, and retries. A retry is every validation run after the first inside the same stream-defined cycle. The counts describe route shape; they do not prescribe an order or treat pre-commit testing as a defect.

Workflow cohort rows appear only when at least two identity cohorts clear the shared `COHORT_MINIMUMS`. Every speaking cohort carries cycle and run denominators, and the section retains below-minimum and unattributed cycle/run remainders. These task-confounded counts do not rank agents or imply capability.

Once the span holds 2 days, cadence sparklines sit beside the Accepted, Gate, Standards, Agents, and Breadth headings. Each listed agent carries its own usage series, and the shares render as filled bars beside their denominators. The same series ride the JSON (`per_day`, `greens_per_day`, `trend`, `branches_per_day`), capped at 24 points. A longer span folds whole days into each point and states the fold in `series_days_per_point`.

### The rules of the surface

Every number is a count or duration from the same analysis population the detectors read: CI runs, `--dry-run` previews, and setup-era events stay out. The card assigns no score, grade, or rank. The Logbook never leaves the machine, so there is no external corpus for comparison ([ADR 0229](https://discern.sh/docs/decisions/0229-practice-stats-are-counted-local-and-never-comparative)). Each number can be re-derived from the checkout.

`--json` carries the counts as `data.stats`, and over MCP `discern_patterns` takes `stats: true`. Without the flag the payload carries no stats key at all.

Stats is a separate counted projection of the same local evidence. It does not rewrite Pattern summaries or turn cohort counts into a comparison. Use the default `discern patterns` report when a finding's condition, evidence, limitation, and next action are the question.

A single accepted change keeps `biggest` and `best day` off the card, since either would restate the change itself, and streaks of one stay quiet. An empty Logbook says there are no stats yet and suggests checking back.

### Where it lives in code

| Concern                                | Source                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The computation                        | [`stats.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/stats.ts)                                                                                                                                            |
| Identity thresholds and cohort routing | [`cohorts.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/cohorts.ts)                                                                                                                                        |
| The flag, the card, and the wire       | [`patterns.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/patterns.ts)                                                                                                                                      |
| Counts proven from synthetic streams   | [`stats_test.ts`](https://github.com/jackwh/discern/blob/main/tests/stats_test.ts)                                                                                                                                               |
| Black-box CLI and archive coverage     | [`engine_patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_patterns_test.ts), [`engine_logbook_lifecycle_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_logbook_lifecycle_test.ts) |

## The Logbook

_The Logbook is a local activity record containing metadata rather than code or output._

With recording on and `discern.toml` readable, each command-line interface (CLI) verb run and each Model Context Protocol (MCP) invocation resolved to that project adds an event. Effectful verbs add paired start and completion events with one invocation id. All worktrees share plain-text files under `.git`.

An MCP call whose explicit `path` falls outside every discern project returns `not_initialized` and records nothing. No project Logbook or readable consent setting applies to that path.

- **Read active history:** `discern patterns` reports the findings ([practice patterns](../20-understand/evidence-and-improvement.md)). `cat .git/discern/logbook/*.jsonl` shows the raw active lines.
- **List and read sealed history:** `discern patterns archives`, then `discern patterns --logbook-file <filename>`. Add `--stats`, `--all`, or `--json` as needed.
- **Seal active history:** `discern patterns archive` (preview with `--dry-run`). A confirmed terminal action starts a fresh active Logbook and preserves the sealed event lines for later reports.
- **Delete active history:** `discern patterns reset` (preview with `--dry-run`). A confirmed terminal action removes only active history; sealed archives survive.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops. Existing active files remain until you archive or reset them.

### What it powers

Setting `[project].logbook = false` stops new evidence for every feature below. `discern patterns` can still read existing history.

- the practice report (`discern patterns`): behavior, Gate-fit, funnel, and trajectory findings over accumulated runs
- each worktree's last action and work in flight: the fleet survey's `last_action` and `running` columns
- fleet activity times that include verb runs, so a long test run does not appear dormant
- configuration-change attribution and each Standard's limit history: the `config-change` and `pin` events
- `tip-adoption` counts: whether each shown tip's invited verb ran before that tip appeared again
- advisory findings on `status`, the `done` Proof, and `improvement`
- wait estimates when concurrent test runs queue, and contention readings
- the in-flight check on the contained-worktree offer; an installation with recording off uses a one-hour inactivity period
- observed checkpoint economics (`discern checkpoints`)
- Logbook storage checks in `discern doctor`

### Where findings appear

Each detector declares a scope and a tier. Scope selects the reader. Tier controls whether a working command may run it ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

| Reader                | Findings it carries                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`        | The canonical summary for 1 inline branch finding after a qualifying green Proof, held to a higher threshold; `discern patterns` carries its full evidence.                |
| `discern status`      | The canonical summary and next step for inline session findings after setup finishes.                                                                                      |
| `discern improvement` | Complete inline project findings in the advisory `data.history.findings` group.                                                                                            |
| `discern patterns`    | Every finding: plain summary followed by concrete observed evidence, up to 3 attention pointers, family blocks, Standard sparklines, and insufficient-evidence accounting. |

The working commands inspect at most the newest 200 events. `patterns` reads the full retained stream. Every route is advisory. Findings change no command outcome, exit code, failed Gate stage, score, Proof identity, or acceptance decision.

The shared result contract keeps one meaning across these routes. A finding's `summary` states the condition in plain language; `observed` carries its count, denominator, named subject and conditions, and any material limitation. `brief` is retained as an exact compatibility alias of `summary`. Investigations use the same two layers and retain `interpretation` as an exact compatibility alias of `summary`. Shorter routes project the canonical summary instead of maintaining separate claims.

### What a line contains

Each line contains names and numbers. It excludes code, prompts, command output, and file contents.

The current event schema major is `1`. Readers skip an unknown major and tolerate additive fields. Every event has `schema`, `at`, optional `writer`, and one of these `kind` values:

Invocation `surface` is `cli` or `mcp`. Completion `outcome` is `ok`, `failed`, `partial`, or `refused`. The lifecycle action names are `archive` and `reset`.

| `kind` | Stored contract |
| --- | --- |
| `begin` | Invocation id, verb, surface, driver facts, branch, head, and config epoch captured before an effectful run. |
| `verb` | One completed invocation with outcome, duration, and any available result metadata. |
| `config-change` | Branch, changed config-section names, and the new epoch fingerprint. Values are not stored. |
| `pin` | Branch, Standard name, previous limit, new limit, and measured value. |
| `prune` | Aggregate digests for raw month shards removed by rotation. |

| Field          | Example                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `schema`       | `1`                                                                     |
| `at`           | ISO 8601 UTC timestamp                                                  |
| `kind`         | `"begin"`, `"verb"`, or a rarer event kind                              |
| `invocation`   | the opaque id joining a start and completion                            |
| `writer`       | `"1.2.0"` (which discern wrote it)                                      |
| `tree`         | a checksum of the uncommitted diff                                      |
| `outcome`      | `"ok"`, `"failed"`, `"partial"`, or `"refused"`                         |
| `failed_stage` | the Gate stage that went red                                            |
| `crash`        | error class name and one code location                                  |
| `duration_ms`  | end-to-end wall-clock milliseconds                                      |
| `waited_ms`    | test-run slot-wait milliseconds on capped runs                          |
| `gate_ran`     | whether this `done` invocation executed Gate work                       |
| `target`       | page served, miss, new branch, or queued command                        |
| `flags`        | `["force"]` (names without values, including `rerun` when requested)    |
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
| `checkpoints`  | checkpoint servings, declarations, variances, abandoned open questions  |
| `epoch`        | a fingerprint of your config                                            |

`partial` marks an error after an irreversible effect. `crash` appears only when discern encounters an unexpected throw and holds the error's class name, such as `"TypeError"`, plus one trimmed code location. The Logbook omits the message and stack. A saved [crash report file](../40-troubleshooting/crashes-and-local-state.md) holds the full error text. `tip_ids` appears only when the Desk showed a tip and carries the registry id verbatim. The tip-adoption reader joins that id to the tip's declared verbs. The landing-authority detectors that read `consent` are covered in [practice patterns](../20-understand/evidence-and-improvement.md). `checkpoints` carries the open-question and variance lifecycle as metadata — ids, conclusions, revision flags, definition and subject fingerprints, and elapsed times; the unmet rationale never lands here.

Readers skip unknown schema versions, and fields are append-only. `begin` carries run identity. Completion adds outcome and `duration_ms`. Capped runs add `waited_ms`, including `0`; uncapped and older events omit it. Readers derive execution as `duration_ms - (waited_ms ?? 0)` for priors and suite health. End-to-end statistics retain wall time. Other kinds are `config-change`, `pin`, and `prune`.

For `done`, `gate_ran: false` marks current-Proof reuse. `--rerun` records `rerun`; compatible `done --confirmed` retains `confirmed`, and detectors recognize both.

#### Validation evidence

`done` and standalone `test` completion events add `validation`. `state` carries version, capture point, completeness, opaque keyed digests, counts/bytes, elapsed time, and failure categories. `execution` carries mode, writer, opaque config/setup/job-definition digests, job metadata, concurrency, and `passed`, `failed`, `skipped`, `cancelled`, or `unavailable` outcomes.

`done` captures after fix/build; `test` before its group. Blocks record `boundary/not-reached`. Complete state covers HEAD, index/checkout bytes, untracked files, and recursively clean submodules. Sparse/assume-unchanged state stays visible. Dirt, missing initialization, unreadability, unknown state, or a breached budget removes the digest.

`.git/discern/validation-hmac-key` is the regular `0600` key; unsafe targets make evidence incomplete. One 5-second deadline covers key, Git, files, submodules, cryptography, and execution; expiry records `budget/time-limit` without changing the verdict. Caps are 20,000 paths, 64 MiB, 1,000 jobs, and 1 MiB. Events exclude manifests, contents, commands, config/environment values, plain hashes, ignored files, services, clocks, randomness, runtime state, and concurrent processes. Older events without `validation` remain readable ([ADR 0273](https://discern.sh/docs/decisions/0273-validation-comparisons-require-complete-keyed-semantic-evidence)).

#### Possible agent identity signals

`driver.agent_signals` is an optional list of evidence derived when the event is recorded. It supplies no detected-agent verdict. Each item has an `agent`, a `source`, and the marker names that matched. Items can appear together. Their order is not a ranking.

The source explains the marker's lifetime:

- `process-environment` records names such as `CODEX_THREAD_ID` or `GEMINI_CLI`. Their values are never stored.
- `mcp-client` means the MCP client's declared name or title matched a known client name.
- `host-filesystem` is ambient machine state. The current `/opt/.devin` marker can persist after Devin's installation, so it does not mean Devin drove that invocation.

`driver.spawned_by` carries the parent invocation id when the gate's job runner spawned the run: readers classify these as automation and join child to parent.

For an MCP call, `driver.mcp_client` retains the declared `name`, optional `title`, and `version`, capped at 256 characters each. Readers classify it through the current catalog. A newly recognized name attributes old and new events on the next read without changing stored lines. Unknown clients remain visible.

The read-time view preserves non-MCP evidence and merges duplicate agent/source pairs. A current MCP match replaces stored MCP evidence from the same declaration. Without a current match, stored MCP evidence remains. Independent sources that disagree leave the run unattributed.

MCP describes the client implementation. An editor, extension, or proxy may sit between discern and the coding agent. These signals can be absent, inherited, or faked. They never change output, instructions, setup, Gate behavior, or landing authority.

### Local storage only

discern writes the Logbook under the Git administrative area, outside commits and ignore rules. The Logbook writer has no network interface under a test in discern's own Gate. A write failure does not change the verb outcome; the verb continues without recording the event.

Doctor treats an enabled empty Logbook as healthy, including on first use. Disabled, invalid, and write-denied states stay distinct. Unmatched begin events remain interruption or crash evidence and do not affect the storage-health result. Environmental denial warns and disables recording for the process; it does not block setup ([ADR 0320](https://discern.sh/docs/decisions/0320-setup-plans-own-write-authority-and-activation-recovery)).

### Rotation and config epochs

Events use month-stamped files (`2026-07.jsonl`), and rotation keeps the newest 24 months. A `prune` line records each removed month with counts by verb and outcome, including a separate partial count. These aggregate counts remain after removal of the raw lines.

### Archive and reset lifecycle

[Logbook lifecycle](logbook.md) specifies the terminal confirmation, atomic archive boundary, recovery state, and historical source selector. Historical selection is advisory: Patterns and Stats may read a sealed file, but fleet activity, `status`, Proof hints, queue estimates, and work-in-flight checks always use the active Logbook.

The `epoch` fingerprint hashes behavior-relevant configuration section by section, with a Standard's `limit` masked out. A pin leaves the fingerprint unchanged. An edit to a command, scope, input list, or other behavior-relevant setting changes it and adds a `config-change` line naming the section.

Tip-adoption episodes compare events only when the config epoch, discern writer release, and dominant MCP-client release match. A run on any branch, session, or surface can count. Another setup cannot resolve the episode. Missing setup evidence and the end of history stay censored ([ADR 0236](https://discern.sh/docs/decisions/0236-tip-adoption-clears-evidence-per-tip-across-setups)).

### See also

- [Trust and your data](../20-understand/local-control.md): the full network, telemetry, and execution contract.
- [Files and ownership](files-and-ownership.md): the enforced footprint the Logbook path belongs to.
- Why identity stays evidence rather than a verdict, and how the shared catalog supports it ([ADR 0166](https://discern.sh/docs/decisions/0166-agent-identity-is-advisory-logbook-evidence)).

## Logbook lifecycle

_Archive preserves the active evidence for later reports. Reset permanently removes only the active evidence._

### Preview and authorize

```sh
discern patterns archive --dry-run
discern patterns reset --dry-run
discern patterns archive
discern patterns reset
```

The previews report the event count, date span, source files, bytes, and archive destination or deletion scope. They remain read-only under pipes, CI, `--plain`, `--json`, and `--markdown`.

Apply is a CLI-only owner action. It requires terminal input and output, operation outside CI and global `--plain`, and an explicit affirmative selection from a confirmation that defaults to **Keep**. Reset offers **Keep** or **Delete**; archive offers **Keep** or **Archive**. Pipes, `--json`, and `--markdown` apply refuse, and no flag or environment bypass exists. Declining changes no file or lifecycle state. Both actions refuse while active history contains another fresh unmatched invocation ([ADR 0272](https://discern.sh/docs/decisions/0272-logbook-lifecycle-actions-require-terminal-confirmation)).

### Archive boundary and recovery

Archive atomically detaches `logbook/`, then copies the month shards' raw JSON Lines into a synced UTC-named file under `logbook-archives/`. A numeric suffix prevents collisions. `epoch.json` remains recorder state and is omitted. The final name is published atomically; only then is the detached source removed. A sealing failure leaves that source under `logbook-recovery/` and reports its path.

A recorder arriving after detachment creates a fresh active directory. It never waits on the lifecycle lock, preserving fail-open recording. Archive and reset themselves record no begin or completion, so one invocation cannot straddle the old and new histories. Reset targets only active `logbook/`; archives and other Git-admin state survive.

### Find and read sealed history

```sh
discern patterns archives
discern patterns --logbook-file logbook-20260811T143015Z.jsonl
discern patterns --stats --logbook-file logbook-20260811T143015Z.jsonl
```

The selector accepts one listed regular-file basename inside `logbook-archives/`. It rejects paths, traversal, symbolic links, directories, active month files, and names outside the archive format. Historical reports never modify the archive; their own event goes to the active Logbook when recording is enabled. `discern_patterns` accepts the same optional selector. Operational readers always use active history.
