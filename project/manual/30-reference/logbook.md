---
id: reference-logbook
title: "Logbook"
description: "Find what discern records locally, how to read its activity statistics, and how to archive or reset that history."
order: 115
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
  - "The logbook"
  - "usage recording"
  - "operational history"
  - "Logbook lifecycle"
  - "logbook archive"
  - "logbook reset"
  - "historical logbook"
---

# Logbook

The logbook records local activity so you can inspect recurring failures, check durations, and changes in the way work gets finished. This reference defines its fields, reports, and storage controls.

| Find                                  | Go to                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| Read a report or stop recording       | [The logbook](#the-logbook)                                   |
| Understand a statistic or denominator | [Practice stats](#practice-stats)                             |
| Interpret a raw JSON line             | [What a line contains](#what-a-line-contains)                 |
| Check what stays on this machine      | [Local storage only](#local-storage-only)                     |
| Archive or remove active history      | [Logbook lifecycle](#logbook-lifecycle)                       |
| Read a sealed archive                 | [Find and read sealed history](#find-and-read-sealed-history) |

Recording must be enabled to collect new evidence. Existing active or sealed history remains readable after recording stops. For help using findings, read [Evidence and improvement](../20-understand/evidence-and-improvement.md).

## The logbook

With recording enabled and `discern.toml` readable, CLI verbs and MCP calls resolved to that project record local metadata. Effectful verbs add paired start and completion events with one invocation id. All worktrees share plain-text files in the repository's common Git administrative directory. The logbook excludes code, prompts, command output, and file contents.

An MCP call whose explicit `path` falls outside every discern project returns `not_initialized` and records nothing. No project logbook or readable consent setting applies to that path.

- **Read active history:** `discern patterns` reports findings. For raw JSON lines, locate the common Git directory with `git rev-parse --path-format=absolute --git-common-dir` and read its `discern/logbook/` month files. In the main checkout, the usual path is `.git/discern/logbook/`; a linked worktree's `.git` is a file pointing elsewhere.
- **List and read sealed history:** `discern patterns archives`, then `discern patterns --logbook-file <filename>`. Add `--stats`, `--all`, or `--json` as needed.
- **Seal active history:** `discern patterns seal` archives the current event lines for later reports and starts fresh active history. Preview the scope with `--dry-run`; application requires terminal confirmation.
- **Delete active history:** `discern patterns reset` permanently removes active history while preserving sealed archives. Preview with `--dry-run`; application requires terminal confirmation.
- **Turn it off:** set `logbook = false` under `[project]` in `discern.toml`. Recording stops. Existing active files remain until you archive or reset them.

### What it powers

Setting `[project].logbook = false` stops new evidence for every feature below. `discern patterns` can still read existing history.

- the practice report (`discern patterns`): behavior, gate-fit, funnel, and trajectory findings over accumulated runs
- each worktree's last action and work in flight: the fleet survey's `last_action` and `running` columns
- fleet activity times that include verb runs, so a long test run does not appear dormant
- configuration-change attribution and each standard's limit history: the `config-change` and `pin` events
- `tip-adoption` counts: whether each shown tip's invited verb ran before that tip appeared again
- advisory findings during work and merge-conflict recovery
- wait estimates when concurrent test runs queue, and contention readings
- the in-flight check on the contained-worktree offer; an installation with recording off uses a one-hour inactivity period
- observed checkpoint economics (`discern checkpoints`)
- Logbook storage checks in `discern doctor`

Pattern findings classify `family` as `trajectory`, `gate-fit`, `behavior`, or `funnel`.

### Where findings appear

You can read the complete report on demand. Working commands also surface selected findings when they are relevant:

| Reader                | Findings it carries                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`        | The canonical summary for 1 inline branch finding after a qualifying green Proof, held to a higher threshold; `discern patterns` carries its full evidence.                |
| `discern status`      | The canonical summary and next step for inline session findings after setup finishes.                                                                                      |
| `discern improvement` | Complete inline project findings in the advisory `data.history.findings` group.                                                                                            |
| `discern patterns`    | Every finding: plain summary followed by concrete observed evidence, up to 3 attention pointers, family blocks, standard sparklines, and insufficient-evidence accounting. |

The working commands inspect at most the newest 200 events. `patterns` reads the full retained stream. Every route is advisory. Findings change no command outcome, exit code, failed gate stage, score, Proof identity, or acceptance decision.

Update and acceptance conflict recovery can also show the recurring-file finding for a path that currently conflicts. That reading includes the current merge observation before the invocation finishes.

### Recurring merge conflicts

`recurring-merge-conflicts` reports an authored file after it conflicts in at least 3 distinct merge attempts across at least 2 efforts. It includes updates and acceptance's integration merges. Successful merges enter the denominator. Attempts with the same authoring effort and revision pair count once, including retries across update and acceptance. Conflicting observations, missing revisions, and omitted path lists remain outside that denominator. Route counts can overlap.

Inspect whether independent changes repeatedly edit the same section. If the file collects independent entries, record each entry separately and generate the final artifact. In `discern.toml`, declare the output `paths` and regeneration `run` under `[generated.<name>]`. Keep source entries outside the declared output paths. Updates and acceptance rebuild those outputs and resolve conflicts confined to generated files; authored-source conflicts still need review.

The logbook's optional `merges` field holds versioned metadata: originating effort, update or acceptance route, Git commit IDs, merge outcome, conflict paths, generated classification, and omitted counts. It excludes file contents and error output. An empty observation records no merge; missing or unknown-version evidence stays unknown. Existing history cannot reconstruct paths it did not record. File recurrence alone does not establish that the same section conflicted.

Each invocation records at most 64 merge attempts. Each attempt records at most 200 conflict paths, with the serialized conflict list limited to 8,192 bytes. Omitted observations and paths have explicit counts, so truncation cannot turn an unknown outcome into a success.

A finding's `summary` states the condition in plain language. Its `observed` field supplies the count, denominator, named subject, conditions, and material limitations. Shorter reports retain the same summary; open `discern patterns` when you need the underlying evidence.

## Practice stats

`discern patterns --stats` summarizes recorded activity as counts and durations. Each rate includes its denominator so you can see how much evidence supports it.

```sh
discern patterns --stats
```

### What the card counts

| Section              | Counts                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted             | Changes accepted and the branches they came from; lines added and removed with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak.                                  |
| The gate             | `done` runs and greens, the red runs the gate stopped, the longest and current green streaks, first-try greens per branch, and hours of checks run across `done`, `prepare`, and `test`.                                          |
| Validation workflows | Clean, dirty, and unknown `prepare`, `test`, and `done` entry states; success, failure, and retry counts by route; test-first changes that later reached a clean committed gate; evidence coverage and current dirty-state shape. |
| Pace                 | Starts that ended in an accepted change, measured start-to-accept cycles with the median and fastest times and how many finished inside a day, and the acceptance cadence across the span.                                        |
| Standards            | Limits tightened and how many standards they cover, the average measured trend, and the most improved standard.                                                                                                                   |
| Checkpoints          | Per-checkpoint economics: efforts fired, servings, declarations with unchanged-subject and unmet splits, variances across landed efforts, abandoned open questions, median time to declare. Most-served rows; remainder counted.  |
| Agents               | Attributed agent identities with their runs, usage series, and green-`done` shares.                                                                                                                                               |
| Breadth              | Branches driven, active days out of the span, the day the most branches were active, and the most changes in flight at one instant.                                                                                               |

An accepted change is a successful `accept`, and its scale reads from the recorded change counts. Streaks count consecutive `done` runs in stream order. A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](../20-understand/evidence-and-improvement.md#what-the-detectors-watch) matches them. A cycle therefore needs both ends on record: an accept whose start predates the logbook counts as accepted without adding a cycle.

For the overlap reading, a branch is in flight from its first analyzed event to its last. A pause inside that window stays in flight. A branch stops counting after its last event, and the trunk is not a change. The standards trend normalizes each standard to its own first reading, direction-adjusted so improvement is always positive. That shared scale lets a coverage floor and a byte-size ceiling average into one line, and lets "most improved" compare like-for-like. The Agents section uses the same cohort boundary as the detectors: the card counts identities below the reporting minimums without listing them, and always states the unattributed share.

### Validation workflow cycles

A validation workflow run is an analyzed `prepare`, `test`, or `done`; recorded `clean` is its entry state. Complete, incomplete, and unattributed evidence share one run denominator. Current `test` and `done` writers always attach validation evidence. Older readable lines without it remain unattributed and cannot support a validation finding. At the standalone-test boundary, complete dirty validation counts tracked-only, untracked-only, mixed, or unclassified state without filenames. Full-Gate evidence follows mutating pre-groups, so a dirty entry remains unclassified instead of mixing moments.

A validation workflow cycle links recorded events on one branch under one config epoch ([ADR 0275](https://discern.sh/docs/decisions/0275-validation-workflows-use-stream-bounded-change-cycles)). A successful `start` for a reused branch, a successful `accept`, or an epoch change closes it. After a clean green gate, a later dirty entry or different recorded HEAD begins another cycle. A run without an epoch stands alone.

A commit does not automatically end a cycle. Dirty pre-commit validation at one HEAD and the later clean `done` at its new committed HEAD stay in the same cycle. The test-first route begins dirty, the commit-first route begins clean, and an unknown first entry remains unattributed. The narrower pre-commit-to-clean-Gate count requires a dirty run, a later distinct recorded HEAD, and a clean green `done` on that later HEAD. Cycle construction uses the recorded stream only, so archived reports have the same result without consulting the current Git graph.

Each route reports cycles, branches, runs, successful and failed runs, cycles that reached a clean gate, cycles with a failure, and retries. A retry is every validation run after the first inside the same stream-defined cycle. The counts describe route shape; they do not prescribe an order or treat pre-commit testing as a defect.

Workflow cohort rows appear only when at least two identity cohorts clear the shared `COHORT_MINIMUMS`. Every speaking cohort carries cycle and run denominators, and the section retains below-minimum and unattributed cycle/run remainders. These task-confounded counts do not rank agents or imply capability.

Once the span holds 2 days, cadence sparklines sit beside the Accepted, gate, standards, Agents, and Breadth headings. Each listed agent carries its own usage series, and the shares render as filled bars beside their denominators. The same series ride the JSON (`per_day`, `greens_per_day`, `trend`, `branches_per_day`), capped at 24 points. A longer span folds whole days into each point and states the fold in `series_days_per_point`.

### The rules of the surface

Stats uses the same analyzed population as the findings: CI runs, `--dry-run` previews, and setup-era events are excluded. Counts describe this project's recorded activity and assign no score, grade, or agent ranking. discern uses no external comparison corpus.

`--json` carries the counts as `data.stats`; the standards section is `data.stats.standards`. Over MCP `discern_patterns` takes `stats: true`. Without the flag the payload carries no stats key at all.

Stats is a separate counted projection of the same local evidence. It does not rewrite Pattern summaries or turn cohort counts into a comparison. Use the default `discern patterns` report when a finding's condition, evidence, limitation, and next action are the question.

A single accepted change keeps `biggest` and `best day` off the card, since either would restate the change itself, and streaks of one stay quiet. An empty logbook says there are no stats yet and suggests checking back.

## Logbook lifecycle

`seal` preserves active history in an archive. `reset` permanently deletes active history. Both leave existing archives available.

### Preview and authorize

```sh
discern patterns seal --dry-run
discern patterns reset --dry-run
discern patterns seal
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

The selector accepts one listed regular-file basename inside `logbook-archives/`. It rejects paths, traversal, symbolic links, directories, active month files, and names outside the archive format. Historical reports never modify the archive; their own event goes to the active logbook when recording is enabled. `discern_patterns` accepts the same optional selector. Operational readers always use active history.

## Event format and storage

The following fields describe stored JSON lines and how retained history is managed.

### What a line contains

Each line contains names and numbers. It excludes code, prompts, command output, and file contents.

The current event schema major is `1`. Readers skip an unknown major and tolerate additive fields. Every event has `schema`, `at`, optional `writer`, and a `kind` from the table below.

Invocation `surface` is `cli` or `mcp`. Completion `outcome` is `ok`, `failed`, `partial`, or `refused`. The lifecycle action names are `seal` and `reset`.

| `kind`          | Stored contract                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `begin`         | Invocation id, verb, surface, driver facts, branch, head, and config epoch captured before an effectful run. |
| `verb`          | One completed invocation with outcome, duration, and any available result metadata.                          |
| `config-change` | Branch, changed config-section names, and the new epoch fingerprint. Values are not stored.                  |
| `pin`           | Branch, standard name, previous limit, new limit, and measured value.                                        |
| `prune`         | Aggregate digests for raw month shards removed by rotation.                                                  |
| `completion`    | Producer-execution and landing observations for one run, with durable identities; advisory only.             |

| Field           | Example                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `schema`        | `1`                                                                     |
| `at`            | ISO 8601 UTC timestamp                                                  |
| `kind`          | `"begin"`, `"verb"`, or a rarer event kind                              |
| `invocation`    | the opaque id joining a start and completion                            |
| `writer`        | `"1.2.0"` (which discern wrote it)                                      |
| `verb`          | `"done"`                                                                |
| `surface`       | `"cli"` or `"mcp"`                                                      |
| `driver`        | session, mode, CI, spawning invocation, and possible agent signals      |
| `branch`        | `"agent/fix-upload-retry"`                                              |
| `head`          | short commit hash at invocation                                         |
| `clean`         | was the working tree clean?                                             |
| `tree`          | a checksum of the uncommitted diff                                      |
| `outcome`       | `"ok"`, `"failed"`, `"partial"`, or `"refused"`                         |
| `error`         | the result's machine-stable error slug when the verb refused            |
| `failed_stage`  | the gate stage that went red                                            |
| `crash`         | error class name and one code location                                  |
| `lock_boundary` | `"none"`, `"checkout"`, `"common"`, or `"common-and-checkout"`          |
| `dry_run`       | whether the invocation was a read-only preview                          |
| `has_operands`  | whether a mixed command group received its effect-selecting operand     |
| `duration_ms`   | end-to-end wall-clock milliseconds                                      |
| `waited_ms`     | test-run slot-wait milliseconds on capped runs                          |
| `gate_ran`      | whether this `done` invocation executed gate work                       |
| `target`        | page served, miss, new branch, or queued command                        |
| `from`          | the ref a `start` forked from                                           |
| `update`        | what an `update` merged in                                              |
| `flags`         | `["force"]` (names without values, including `rerun` when requested)    |
| `change`        | files/insertions/deletions/commits vs the trunk                         |
| `scopes`        | the configured scopes touched                                           |
| `steps`         | per-step labels, stages, outcomes, timings                              |
| `validation`    | versioned validation-start and execution evidence                       |
| `merges`        | [versioned merge observations](#recurring-merge-conflicts)              |
| `diagnostics`   | tool, rule id, file path at most                                        |
| `hint_ids`      | stable ids of advice delivered with the result                          |
| `tip_ids`       | stable ids of desk tips shown during the run                            |
| `standards`     | each standard's measurement, limit, margin, and gate-owned pin decision |
| `consent`       | consent source and matched scopes on accept                             |
| `landing`       | recovery, trunk, worktree, and branch effects                           |
| `checkpoints`   | checkpoint servings, declarations, variances, abandoned open questions  |
| `epoch`         | a fingerprint of your config                                            |

`partial` marks an error after an irreversible effect. `crash` appears only when discern encounters an unexpected throw and holds the error's class name, such as `"TypeError"`, plus one trimmed code location. The logbook omits the message and stack. A saved [crash report file](../40-troubleshooting/crashes-and-local-state.md) holds the full error text. `tip_ids` appears only when the desk showed a tip and carries the registry id verbatim. The tip-adoption reader joins that id to the tip's declared verbs. The landing-authority detectors that read `consent` are covered in [practice patterns](../20-understand/evidence-and-improvement.md). `checkpoints` carries the open-question and variance lifecycle as metadata — ids, conclusions, revision flags, definition and subject fingerprints, and elapsed times; the unmet rationale never lands here.

Readers skip unknown schema versions, and fields are append-only. `begin` carries run identity. Completion adds outcome and `duration_ms`. Capped runs add `waited_ms`, including `0`; uncapped and older events omit it. Readers derive execution as `duration_ms - (waited_ms ?? 0)` for priors and suite health. End-to-end statistics retain wall time. Other kinds are `config-change`, `pin`, `prune`, and `completion`. A `completion` line records one run's producer and landing observations with their durable identities. These advisory facts distinguish gate work, evidence reuse, waits, and landing; missing observations remain unknown. They supply no authority and no Proof.

For `done`, `gate_ran: false` means no gate work ran. This can reflect current-Proof reuse or a stop before execution, such as an unanswered checkpoint. Read the outcome and error alongside it. `--rerun` records `rerun`. Readers still recognize historical `confirmed` flags as evidence from older local logbooks; they do not expose that spelling as current input.

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

MCP describes the client implementation. An editor, extension, or proxy may sit between discern and the coding agent. These signals can be absent, inherited, or faked. They never change output, instructions, setup, gate behavior, or landing authority.

### Local storage only

discern writes the logbook under the Git administrative area, outside commits and ignore rules. discern sends no logbook data over the network. A write failure does not change the verb outcome; the verb continues without recording the event.

Doctor treats an enabled empty logbook as healthy, including on first use. Disabled, invalid, and write-denied states stay distinct. Unmatched begin events remain interruption or crash evidence and do not affect the storage-health result. Environmental denial warns and disables recording for the process; it does not block setup ([ADR 0320](https://discern.sh/docs/decisions/0320-setup-plans-own-write-authority-and-activation-recovery)).

### Rotation and config epochs

Events use month-stamped files (`2026-07.jsonl`), and rotation keeps the newest 24 months. A `prune` line records each removed month with counts by verb and outcome, including a separate partial count. These aggregate counts remain after removal of the raw lines.

The `epoch` fingerprint hashes behavior-relevant configuration section by section, with a standard's `limit` masked out. A pin leaves the fingerprint unchanged. An edit to a command, scope, input list, or other behavior-relevant setting changes it and adds a `config-change` line naming the section.

### Archive and reset lifecycle

[Logbook lifecycle](#logbook-lifecycle) describes confirmation, archive recovery, and historical selection. Historical selection is advisory: patterns and Stats may read a sealed file, but fleet activity, `status`, Proof hints, queue estimates, and work-in-flight checks always use the active logbook.

Tip-adoption episodes compare events only when the config epoch, discern writer release, and dominant MCP-client release match. A run on any branch, session, or surface can count. Another setup cannot resolve the episode. Missing setup evidence and the end of history stay censored ([ADR 0236](https://discern.sh/docs/decisions/0236-tip-adoption-clears-evidence-per-tip-across-setups)).

### See also

- [Trust and your data](../20-understand/local-control.md): the full network, telemetry, and execution contract.
- [Files and ownership](files-and-ownership.md): the enforced footprint the logbook path belongs to.
- Why identity stays evidence rather than a verdict, and how the shared catalog supports it ([ADR 0166](https://discern.sh/docs/decisions/0166-agent-identity-is-advisory-logbook-evidence)).

## Implementation references

These sources define the stats calculation and its regression coverage.

### Where it lives in code

| Concern                                | Source                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The computation                        | [`stats.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/stats.ts)                                                                                                                                            |
| Identity thresholds and cohort routing | [`cohorts.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/cohorts.ts)                                                                                                                                        |
| The flag, the card, and the wire       | [`patterns.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/patterns.ts)                                                                                                                                      |
| Counts proven from synthetic streams   | [`stats_test.ts`](https://github.com/jackwh/discern/blob/main/tests/stats_test.ts)                                                                                                                                               |
| Black-box CLI and archive coverage     | [`engine_patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_patterns_test.ts), [`engine_logbook_lifecycle_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_logbook_lifecycle_test.ts) |
