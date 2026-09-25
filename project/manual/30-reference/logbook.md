---
id: reference-logbook
title: "Logbook"
description: "Look up what discern's local logbook records, what reads it, how to read its reports and stats, and how to archive or reset its history."
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

The **logbook** is discern's local record of how work goes in your project: which commands ran, how long they took, and how they ended. It holds names and numbers, never your code, prompts, command output, or file contents, and it never leaves your machine. This page defines what it records, what reads it, how to read its reports and stats, and how to archive or reset it.

Say your agent runs `discern done` on the recipe search branch three times before it commits the change, and each run refuses because the tree has uncommitted edits. Each run adds lines to the logbook, and discern reads them back to point out the pattern. Recording needs to be on to collect that evidence, and history you already have stays readable after recording stops. To put the findings to use, read [Learn from your project's history](../10-understand/evidence-and-improvement.md).

| Find                                  | Go to                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| Read a report, or stop recording      | [What the logbook records](#what-the-logbook-records)         |
| Understand a statistic or denominator | [Practice stats](#practice-stats)                             |
| Interpret a raw JSON line             | [What a line contains](#what-a-line-contains)                 |
| Check what stays on this machine      | [Local storage only](#local-storage-only)                     |
| Archive or remove active history      | [Logbook lifecycle](#logbook-lifecycle)                       |
| Read a sealed archive                 | [Find and read sealed history](#find-and-read-sealed-history) |

## What the logbook records

With recording on and `discern.toml` readable, discern records local metadata for every CLI command and Model Context Protocol (MCP) call that resolves to the project. A command that can change something records a start event before it runs and a completion event after, joined by one invocation id, so a run that never finishes still leaves its start on record. Every worktree, the separate copy of the project where one task happens, writes to the same plain-text files in the repository's common Git directory.

An MCP call whose explicit `path` is outside every discern project returns `no_project` and records nothing, because no project logbook or consent setting applies there. `discern_docs` is the exception: it answers from discern's own bundled documentation instead, and still records nothing.

- **Read active history:** `discern patterns` reports findings. For raw JSON lines, find the common Git directory with `git rev-parse --path-format=absolute --git-common-dir`, and read the month files in its `discern/logbook/` directory. In the main checkout that's usually `.git/discern/logbook/`, but a linked worktree's `.git` is a file that points elsewhere, so ask Git.
- **List and read sealed history:** run `discern patterns archives`, then `discern patterns --logbook-file <filename>`. Add `--stats`, `--all`, or `--json` as needed.
- **Seal active history:** `discern patterns seal` archives the current event lines for later reports, and starts a fresh active history. Preview it with `--dry-run`. Applying it needs your confirmation in a terminal.
- **Delete active history:** `discern patterns reset` permanently removes active history, and keeps sealed archives. Preview it with `--dry-run`. Applying it needs your confirmation in a terminal.
- **Turn it off:** set `record_logbook = false` under `[project]` in `discern.toml`. Recording stops, and the existing active files stay until you seal or reset them.

### What it powers

Each of these reads the logbook, so setting `[project].record_logbook = false` stops new evidence for each of them, though `discern patterns` can still read the history you have:

- the practice and completion-cost report (`discern patterns`): behavior, gate-fit, funnel, and trajectory findings over accumulated runs, including contention between queued test runs, and `tip-adoption` counts, which show whether each shown tip's suggested command ran before the tip appeared again
- each worktree's last action and work in flight: the fleet survey's `last_action` and `running` columns
- fleet activity times that include verb runs, so a long test run doesn't look dormant
- configuration-change attribution and each standard's limit history: the `config-change` and `pin` events
- advisory findings during work and merge-conflict recovery: `status` hints, the tail of a `discern done` result, `improvement` history, and help with recurring conflicts in `discern update` and `discern accept`
- wait estimates when concurrent test runs queue
- the in-flight check on the contained-worktree offer; with recording off, discern uses a one-hour inactivity period instead
- observed checkpoint economics (`discern checkpoints`)
- Logbook storage checks in `discern doctor`

With recording off, the inline findings, the fleet's action columns, and the in-flight check stop reading the logbook altogether, while `discern checkpoints` still reads the history you have.

### Where findings appear

You can read the full report whenever you like, and working commands also show selected findings when they're relevant:

| Reader                | Findings it carries                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`        | The summary of 1 finding about the branch, after a qualifying green Proof, held to a higher threshold. `discern patterns` has its full evidence.                                                                          |
| `discern status`      | The summaries and next steps of up to 3 findings about the current branch, once setup has finished.                                                                                                                       |
| `discern improvement` | Complete project findings, in the advisory `data.history.findings` group.                                                                                                                                                 |
| `discern patterns`    | Each detector's strongest 3 findings, or every finding with `--all`: a plain summary, then the observed evidence, up to 3 attention pointers, family blocks, standard sparklines, and an account of what lacked evidence. |

The working commands inspect at most the newest 200 events, while `discern patterns` reads every retained event. `discern improvement` also reads every active event, to find [checkpoints](glossary.md#checkpoint) that often land with a [variance](glossary.md#variance). When `discern patterns` shows fewer findings than it found, `findings_total` in its result gives the full count.

Every route is advisory: findings change no command outcome, exit code, failed [gate](glossary.md#gate) stage, score, [Proof](glossary.md#proof) identity, or acceptance decision.

A finding's `summary` states the condition in plain words, and its `observed` field gives the count, the denominator, the named subject, the conditions, and material limitations. After the recipe search branch's three refusals, `discern patterns` reports:

```json
"summary": "The same command refusal recurred on this branch.",
"observed": "`done` refused 3 of 3 recorded refusals on `agent/recipe-search-0a7563` with the same slug (`dirty_worktree`)."
```

Shorter reports, such as `discern status`, keep the same summary, so open `discern patterns` when you need the evidence behind it. Each pattern finding also has a `family`: `trajectory`, `gate-fit`, `behavior`, or `funnel`. This one is `behavior`.

## Practice stats

`discern patterns --stats` summarizes recorded activity as counts and durations, and gives each rate with its denominator, so you can see how much evidence supports it.

```sh
discern patterns --stats
```

### What the card counts

| Section              | Counts                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted             | Changes accepted, and the branches they came from; lines added and removed, with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak of consecutive UTC days with an accepted change.                           |
| The gate             | `done` runs and greens; `done` runs that didn't end green, a count that mixes validation, coordination, and recovery outcomes; the longest and current green streaks; first-try greens per branch; and the summed duration of commands run by `done`, `prepare`, and `test`. |
| Validation workflows | Clean, dirty, and unknown `prepare`, `test`, and `done` entry states; success, failure, and retry counts by route; test-first changes that later reached a clean committed gate; evidence coverage and the current shape of dirty state.                                     |
| Pace                 | Starts that ended in an accepted change; measured start-to-accept cycles, with the median and fastest times and how many finished inside a day; and the acceptance cadence across the span.                                                                                  |
| Standards            | Limits tightened, and how many standards they cover; the average measured trend; the most improved standard.                                                                                                                                                                 |
| Checkpoints          | Each checkpoint's economics: efforts it fired on, servings, declarations with unchanged-subject and unmet splits, variances across landed efforts, abandoned open questions, and the median time to declare. The most-served rows appear, and the rest are counted.          |
| Agents               | Up to 10 attributed agent identities, with their runs, usage series, and green-`done` shares.                                                                                                                                                                                |
| Breadth              | Branches driven, active days out of the span, the day the most branches were active, and the most changes in flight at one moment.                                                                                                                                           |

An accepted change is a successful `accept`, and its size comes from the recorded change counts. The gate's streaks count consecutive `done` runs in stream order. A branch is a first-try green only when its first `done` ended green, so the recipe search branch, whose first `done` refused, isn't one. The summed command duration includes waits for a test slot and runs that overlapped, so it's neither elapsed time nor compute time.

A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](../10-understand/evidence-and-improvement.md#what-the-detectors-watch) matches them. So a cycle needs both ends on record: an accept whose start predates the logbook counts as accepted, but adds no cycle.

For the overlap reading, a branch is in flight from its first analyzed event to its last, including any pause inside that window. A branch stops counting after its last event, and the [trunk](glossary.md#trunk), your project's shared branch, isn't a change.

The standards trend scales each [standard](glossary.md#standard) against its own first reading, and flips direction where needed so that improvement is always positive. That shared scale lets a coverage floor and a byte-size ceiling average into one line, and lets "most improved" compare like with like.

The Agents section uses the same cohort boundary as the detectors. It counts identities below the reporting minimums without listing them, always states the unattributed share, and leaves automation runs out of both.

### Validation workflow cycles

A validation workflow run is an analyzed `prepare`, `test`, or `done`, and its recorded `clean` value is its entry state. Complete, incomplete, and unattributed evidence share one run denominator. A `done` or standalone `test` that reaches validation attaches validation evidence. A `done` that refuses earlier, on a dirty tree like the recipe search branch's or at an unanswered checkpoint, records none, and `prepare` never does. A run without evidence, like an older line, stays unattributed, and can't support a validation finding. A failure counts only when its verdict was recorded.

At the standalone test boundary, complete dirty-state evidence counts tracked-only, untracked-only, mixed, or unclassified dirt, without file names. The full gate captures its evidence after the steps that can change files, so a dirty entry there stays unclassified instead of mixing two moments.

A validation workflow cycle links recorded events on one branch under one config epoch ([ADR 0275](https://discern.sh/docs/decisions/0275-validation-workflows-use-stream-bounded-change-cycles)).

- A successful `start` for a reused branch, a successful `accept`, or an epoch change closes a cycle.
- After a clean green gate, a later dirty entry or a different recorded HEAD begins another cycle.
- A run without an epoch stands alone.

A commit doesn't end a cycle by itself: dirty validation before a commit, at one HEAD, and the later clean `done` at the new committed HEAD stay in the same cycle. A cycle that starts dirty follows the test-first route, a cycle that starts clean follows the commit-first route, and an unknown first entry stays unattributed. The narrower count of pre-commit runs that reached a clean gate needs a test-first cycle with a dirty run, a later distinct recorded HEAD, and a clean green `done` on that later HEAD. Cycles come from the recorded stream alone, so a report on an archive gives the same result without reading the current Git history.

Each route reports cycles, branches, runs, successful and failed runs, cycles that reached a clean gate, cycles with a failure, and retries. A retry is every validation run after the first inside the same cycle. The counts describe how work flowed. They don't prescribe an order, or treat testing before a commit as a defect.

Workflow rows by cohort appear only when at least 2 identity cohorts clear the shared minimums: each cohort needs at least 5 attributed runs, and at least 10% of all attributed runs. Every cohort that appears carries cycle and run denominators, and the section keeps the below-minimum and unattributed remainders. These counts depend on which tasks each agent got, so they don't rank agents or imply capability.

Once the span covers 2 days, cadence sparklines appear beside the Accepted, gate, standards, Agents, and Breadth headings, and each listed agent gets its own usage series. Agent shares appear as text: the count of green `done` runs out of all `done` runs, with a percentage. The only bar on the card is the green gate runs meter at the top.

The JSON carries the same series (`per_day`, `greens_per_day`, `trend`, `branches_per_day`), capped at 24 points. A longer span folds whole days into each point, and states the fold in `series_days_per_point`.

### What stats include and leave out

Stats use the same analyzed population as the findings, so they leave out CI runs, `--dry-run` previews, and events from before setup finished. Counts describe this project's recorded activity and assign no score, grade, or agent ranking, and discern compares against no outside data.

`--json` carries the counts in `data.stats`, with the standards section in `data.stats.standards`. Over MCP, `discern_patterns` takes `stats: true`. Without the flag, the result has no stats key at all.

Stats are a separate count of the same local evidence: they don't rewrite pattern summaries, or turn cohort counts into a comparison. Use the default `discern patterns` report when you need a finding's condition, evidence, limitation, and next action.

With only one accepted change, the card leaves out the biggest change and the best day, since either would repeat that change, and it doesn't show streaks of one. An empty logbook says there are no stats yet, and suggests checking back later.

## Logbook lifecycle

`seal` moves active history into an archive, and `reset` permanently deletes it. Both leave existing archives available.

### Preview and confirm

```sh
discern patterns seal --dry-run
discern patterns reset --dry-run
discern patterns seal
discern patterns reset
```

A preview reports the event count, the date span, the source files, the bytes, and the archive destination or the deletion scope. Previews stay read-only under pipes, CI, `--plain`, `--json`, and `--markdown`.

Your agent can preview either action, but applying one is for you, from the command line only. It needs terminal input and output, a run outside CI and outside global `--plain`, and an explicit yes to a confirmation that defaults to **Keep**: reset offers **Keep** or **Delete**, and seal offers **Keep** or **Seal**. Pipes, `--json`, and `--markdown` refuse to apply, and no flag or environment variable gets around this.

- Declining keeps the active history and the existing archives.
- Other work can continue while you review. If active history changes before you confirm, run the command again to review its current scope.
- Both actions refuse while active history holds another recent invocation that hasn't finished ([ADR 0272](https://discern.sh/docs/decisions/0272-logbook-lifecycle-actions-require-terminal-confirmation)).
- With no event lines to seal, `seal` archives and detaches nothing.

### How sealing works and recovers

Sealing detaches `logbook/` in one atomic step, then copies the month files' raw JSON Lines into a synced, UTC-named file under `logbook-archives/`, adding a numeric suffix when the name is taken. The final name appears in one atomic step, and only then does discern remove the detached source. If sealing fails, the source stays under `logbook-recovery/`, and discern reports its path. A failed reset also leaves a recoverable copy there.

The recorder's state, `epoch.json`, isn't copied into the archive. It leaves with the detached directory and is deleted once the archive is published, so the epoch starts fresh: after a seal or a reset, the first event on each branch records its configuration without a `config-change` line.

A recorder that arrives after the detachment creates a fresh active directory. It never waits on the lifecycle lock, so recording keeps failing open instead of holding up a command. Seal and reset record no logbook start or completion of their own, so one invocation can't straddle the old and new histories. Reset targets only the active `logbook/`, and archives and other Git-admin state survive it.

### Find and read sealed history

```sh
discern patterns archives
discern patterns --logbook-file logbook-20260811T143015Z.jsonl
discern patterns --stats --logbook-file logbook-20260811T143015Z.jsonl
```

The selector takes one listed regular-file name inside `logbook-archives/`. It rejects paths, traversal, symbolic links, directories, active month files, and names outside the archive format. Over MCP, `discern_patterns` takes the same selector as `logbook_file`.

A historical report never changes the archive, and its own event goes to the active logbook when recording is on. Only patterns and stats read a sealed file: [fleet](glossary.md#fleet) activity, `status`, Proof hints, queue estimates, and work-in-flight checks always use the active logbook.

## Event format and storage

### What a line contains

Each line is one JSON object of names and numbers, never code, prompts, command output, or file contents. The recipe search branch's third refused `discern done` added this line, shown here across several lines for reading:

```json
{
  "schema": 1,
  "at": "2026-09-25T01:36:09.342Z",
  "writer": "1.1.0",
  "kind": "verb",
  "invocation": "ece48d9e-83bb-4181-8267-81c5266f4fef",
  "verb": "done",
  "surface": "cli",
  "driver": {
    "session": "cli:79126",
    "json": false,
    "markdown": true,
    "tty": false,
    "ci": false,
    "agent_signals": [
      {
        "agent": "claude",
        "source": "process-environment",
        "markers": ["CLAUDECODE", "AI_AGENT"]
      }
    ]
  },
  "branch": "agent/recipe-search-0a7563",
  "head": "7e53aed",
  "clean": false,
  "tree": "9b9e2f2b",
  "outcome": "refused",
  "error": "dirty_worktree",
  "gate_ran": false,
  "lock_boundary": "checkout",
  "duration_ms": 145,
  "change": { "files": 2, "insertions": 20, "deletions": 1, "commits": 1 },
  "hint_ids": ["completion-uncommitted"],
  "epoch": "e4cfa670"
}
```

The current event schema major is `1`. Readers skip a line with an unknown major, and accept added fields, because fields are only ever appended. Every event has `schema`, `at`, an optional `writer`, and a `kind`.

An invocation's `surface` is `cli` or `mcp`. Its `outcome` is `ok`, `failed`, `partial`, or `refused`. The lifecycle actions are `seal` and `reset`.

| `kind`          | What it stores                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `begin`         | Invocation id, verb, surface, driver facts, branch, head, and config epoch, captured before a command that can change something runs.                                                                                    |
| `verb`          | One finished invocation, with its outcome, duration, and any available result metadata.                                                                                                                                  |
| `config-change` | Branch, the names of the config sections that changed, and the new epoch fingerprint. Values aren't stored.                                                                                                              |
| `pin`           | Branch, standard name, previous limit, new limit, and measured value.                                                                                                                                                    |
| `prune`         | A digest of each month file that rotation removed.                                                                                                                                                                       |
| `completion`    | One observation from a validation run, with durable identities: Proof recorded, a validation summary, a command started or finished, a producer run or reused, evidence invalidated, or a timed interval. Advisory only. |

| Field           | What it holds                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`        | `1`                                                                                                                                                |
| `at`            | An ISO 8601 UTC timestamp.                                                                                                                         |
| `kind`          | `"begin"`, `"verb"`, or a rarer event kind.                                                                                                        |
| `invocation`    | The opaque id that joins a start and its completion.                                                                                               |
| `writer`        | The discern version that wrote the line, such as `"1.1.0"`.                                                                                        |
| `verb`          | The command, such as `"done"`.                                                                                                                     |
| `surface`       | `"cli"` or `"mcp"`.                                                                                                                                |
| `driver`        | Session, mode, CI, the spawning invocation, and possible agent signals.                                                                            |
| `branch`        | The branch, such as `"agent/recipe-search-0a7563"`.                                                                                                |
| `head`          | The short commit hash when the command started.                                                                                                    |
| `clean`         | Whether the working tree was clean.                                                                                                                |
| `tree`          | A checksum of the uncommitted diff.                                                                                                                |
| `outcome`       | `"ok"`, `"failed"`, `"partial"`, or `"refused"`.                                                                                                   |
| `error`         | The result's stable error slug, whenever the result carries one.                                                                                   |
| `failed_stage`  | The gate stage that went red.                                                                                                                      |
| `crash`         | An error class name and one code location.                                                                                                         |
| `lock_boundary` | `"none"`, `"phased"`, `"checkout"`, `"lifecycle"`, `"lifecycle-and-checkout"`, `"common"`, `"common-and-checkout"`, or `"acceptance-and-checkout"` |
| `dry_run`       | Whether the command was a read-only preview.                                                                                                       |
| `has_operands`  | Whether a command group that also acts received the operand that selects its effect.                                                               |
| `duration_ms`   | End-to-end wall-clock milliseconds.                                                                                                                |
| `waited_ms`     | Milliseconds spent waiting for a test-run slot, on capped runs.                                                                                    |
| `gate_ran`      | Whether this `done` ran gate work.                                                                                                                 |
| `target`        | The page served, a miss, the new branch, or the queued command.                                                                                    |
| `from`          | The ref a `start` branched from.                                                                                                                   |
| `update`        | What an `update` merged in.                                                                                                                        |
| `flags`         | Flag names without values, such as `["force"]`, including `rerun` when requested.                                                                  |
| `change`        | Files, insertions, deletions, and commits compared with the trunk.                                                                                 |
| `scopes`        | The configured scopes the change touched.                                                                                                          |
| `steps`         | Each step's label, stage, outcome, and timing.                                                                                                     |
| `validation`    | Versioned evidence about the start and execution of validation.                                                                                    |
| `merges`        | Versioned observations of merges.                                                                                                                  |
| `diagnostics`   | Tool, rule id, and at most a file path.                                                                                                            |
| `hint_ids`      | Stable ids of the advice delivered with the result.                                                                                                |
| `tip_ids`       | Stable ids of the desk tips shown during the run.                                                                                                  |
| `standards`     | Each standard's measurement, limit, margin, and the gate's pin decision.                                                                           |
| `consent`       | The consent source and matched scopes, on accept.                                                                                                  |
| `landing`       | Recovery, trunk, worktree, and branch effects.                                                                                                     |
| `checkpoints`   | Checkpoint servings, declarations, variances, and abandoned open questions.                                                                        |
| `epoch`         | A fingerprint of your configuration.                                                                                                               |

- **`partial`** marks an error after an effect that can't be undone.
- **`crash`** appears only when discern hits an unexpected error. It holds the error's class name, such as `"TypeError"`, and one trimmed code location. The logbook leaves out the message and stack, which a saved [crash report file](../40-troubleshooting/crashes-and-local-state.md) holds in full.
- **`tip_ids`** appears only when the [desk](glossary.md#desk) showed a tip, and carries the tip's registry id as is. The tip-adoption reader joins that id to the tip's declared commands.
- **`consent`** feeds the landing-authority detectors described in [practice patterns](../10-understand/evidence-and-improvement.md).
- **`checkpoints`** carries the open-question and variance lifecycle as metadata: ids, conclusions, revision flags, definition and subject fingerprints, and elapsed times. The unmet rationale never lands here.

A `begin` event carries the run's identity. Its `verb` event adds the outcome and `duration_ms`. Capped test runs add `waited_ms`, including `0`, while uncapped runs and older events leave it out. Readers work out the execution time as `duration_ms - (waited_ms ?? 0)` for priors and suite health, and end-to-end statistics keep the wall time.

`completion` lines record what a validation run did, one observation per line, so a single run writes many. They show gate work, evidence reuse, and waits; an observation that's missing stays unknown. Timed intervals have a category: `capacity-acquisition`, `capacity-wait`, `producer`, `extraction`, `validation`, or `validation-feedback`. These lines are advisory, and supply no authority and no Proof.

For `done`, `gate_ran: false` means no gate work ran: discern either reused current Proof, or stopped before running anything, for example at an unanswered checkpoint. Read the outcome and error alongside it. In the recipe search line, `error: "dirty_worktree"` says discern stopped because the tree had uncommitted edits. `--rerun` records `rerun` in `flags`. Readers still recognize a historical `confirmed` flag in older local logbooks, but don't offer that spelling as current input.

#### Validation evidence

The `verb` events of `done` and standalone `test` add `validation`.

- **`state`** carries its version, capture point, completeness, opaque keyed digests, counts and bytes, elapsed time, and failure categories.
- **`execution`** carries the mode, the writer, opaque digests of the config, setup, and job definitions, job metadata, concurrency, and outcomes of `passed`, `failed`, `skipped`, `cancelled`, or `unavailable`.

`done` captures state after its fix and build steps, and `test` captures it before its group runs. A run that stops before that point records `boundary/not-reached` instead of sampling a tree its jobs never saw. Complete state covers HEAD, the index and checkout bytes, untracked files, and recursively clean submodules. Sparse and assume-unchanged state stays visible. Dirt, missing initialization, unreadable files, unknown state, or a breached budget removes the digest.

`.git/discern/validation-hmac-key` is a regular file with mode `0600`, and an unsafe target makes the evidence incomplete. One 5-second deadline covers capturing the evidence: the key, Git, the files, submodules, and the cryptography. It doesn't limit the jobs, so when it expires, discern records `budget/time-limit` and the verdict doesn't change. The state capture stops at 20,000 paths and 64 MiB of Git output and file content, and the execution record at 1,000 jobs and 1 MiB of configuration, setup, and job definitions.

Events leave out manifests, contents, commands, config and environment values, plain hashes, ignored files, services, clocks, randomness, runtime state, and concurrent processes. Older events without `validation` stay readable. A line whose `validation` evidence is in a newer version is skipped whole ([ADR 0273](https://discern.sh/docs/decisions/0273-validation-comparisons-require-complete-keyed-semantic-evidence)).

#### Possible agent identity signals

`driver.agent_signals` is an optional list of evidence that discern derives when it records an event. It isn't a verdict on which agent ran. Each item has an `agent`, a `source`, and the names of the markers that matched. Several items can appear together, and their order isn't a ranking. The recipe search line carries one, from Claude Code's environment: the variable names `CLAUDECODE` and `AI_AGENT`, without their values.

The source tells you how long the marker lives:

- **`process-environment`** records the names of variables such as `CODEX_THREAD_ID` or `GEMINI_CLI`. It doesn't store their values. A non-empty `AI_AGENT` counts when its value matches a known agent, and otherwise adds a signal for the `custom` agent.
- **`mcp-client`** means the MCP client's declared name or title matched a known client name.
- **`host-filesystem`** is state that stays on the machine. The current `/opt/.devin` marker can outlast Devin's installation, so it doesn't mean Devin drove that command.

`driver.spawned_by` carries the invocation id of the discern run that started this one as automated work: a Git command or hook, a shell for an operator or a project script, a gate job, or another child process discern owns. Readers classify every marked run as automation, and join the child to its parent. An interactive handoff, such as starting an agent, clears the marker.

For an MCP call, `driver.mcp_client` keeps the declared `name`, optional `title`, and `version`, each capped at 256 characters. Readers classify it through the current catalog, so a newly recognized name attributes old and new events on the next read, without changing stored lines. Unknown clients stay visible.

The read-time view keeps evidence from outside MCP, and merges duplicate agent and source pairs. A current MCP match replaces stored MCP evidence from the same declaration. Without a current match, the stored MCP evidence stays. When independent sources disagree, the run stays unattributed.

MCP describes the client software, and an editor, extension, or proxy can sit between discern and the coding agent, so these signals can be absent, inherited, or faked. They never change output, instructions, setup, gate behavior, or landing authority ([ADR 0166](https://discern.sh/docs/decisions/0166-agent-identity-is-advisory-logbook-evidence)).

### Local storage only

discern writes the logbook under Git's administrative area, outside commits and ignore rules, and sends none of it over the network. A failed write doesn't change a command's outcome: the command continues without recording the event.

Doctor treats an enabled but empty logbook as healthy, including on first use. It keeps the disabled, invalid, and write-denied states distinct. Unmatched begin events stay as evidence of an interruption or a crash, and don't affect the storage check. If the environment denies writes, doctor warns, recording turns off for that process, and setup carries on ([ADR 0320](https://discern.sh/docs/decisions/0320-setup-plans-own-write-authority-and-activation-recovery)).

### Rotation and config epochs

Events go into month files, such as `2026-07.jsonl`. Rotation keeps the newest 24 months, and runs when a new month file is created. For each month it removes, a `prune` line records a digest: the file name, its total lines, counts of `ok`, `failed`, `partial`, and `refused` outcomes, counts by verb, and the number of lines it couldn't parse. The digests stay after the raw lines are gone.

The `epoch` fingerprint hashes the behavior-relevant configuration section by section. It masks each standard's `limit`, and ignores the `[meta]` section, so a pin leaves the fingerprint unchanged. An edit to a command, scope, input list, or other behavior-relevant setting changes it. The branch's next recorded event then adds a `config-change` line that names the changed sections. The first event discern records on a branch sets its fingerprint without a `config-change` line.

A tip-adoption episode compares events only when the config epoch, the discern writer release, and the main MCP-client release match. A run on any branch, session, or surface can count, but another setup can't resolve the episode. Missing setup evidence, and the end of the history, leave an episode unresolved ([ADR 0236](https://discern.sh/docs/decisions/0236-tip-adoption-clears-evidence-per-tip-across-setups)).

### Related pages

- [What stays on your machine](../10-understand/local-control.md): what discern runs, records, and writes, and what never leaves your computer.
- [Files and ownership](files-and-ownership.md): where the logbook sits among discern's other local records.
