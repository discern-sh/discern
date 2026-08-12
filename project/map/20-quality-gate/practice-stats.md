---
title: Practice stats
description: "Read the Logbook for accepted changes, validation routes, green streaks, cycle times, Standards trends, and agent cohorts in plain counts."
order: 120
aliases:
  - discern patterns --stats
  - stats
  - practice stats
  - brag
  - bragging rights
  - vanity metrics
---

# Practice stats

_`discern patterns --stats` reads the [Logbook](../70-reference/the-logbook.md) for what went well and renders a card of plain counts, each with its denominator beside it._

```sh
discern patterns --stats
```

## What the card counts

| Section              | Counts                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted             | Changes accepted and the branches they came from; lines added and removed with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak.                                  |
| The Gate             | `done` runs and greens, the red runs the Gate stopped, the longest and current green streaks, first-try greens per branch, and hours of checks run across `done`, `prepare`, and `test`.                                          |
| Validation workflows | Clean, dirty, and unknown `prepare`, `test`, and `done` entry states; success, failure, and retry counts by route; test-first changes that later reached a clean committed Gate; evidence coverage and current dirty-state shape. |
| Pace                 | Starts that ended in an accepted change, measured start-to-accept cycles with the median and fastest times and how many finished inside a day, and the acceptance cadence across the span.                                        |
| Standards            | Limits tightened and how many Standards they cover, the average measured trend, and the most improved Standard.                                                                                                                   |
| Agents               | Attributed agent identities with their runs, usage series, and green-`done` shares.                                                                                                                                               |
| Breadth              | Branches driven, active days out of the span, the day the most branches were active, and the most changes in flight at one instant.                                                                                               |

An accepted change is a successful `accept`, and its scale reads from the recorded change counts. Streaks count consecutive `done` runs in stream order. A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](patterns.md#what-the-detectors-watch) matches them. A cycle therefore needs both ends on record: an accept whose start predates the logbook counts as accepted without adding a cycle.

For the overlap reading, a branch is in flight from its first analyzed event to its last. A pause inside that window stays in flight. A branch stops counting after its last event, and the trunk is not a change. The Standards trend normalizes each Standard to its own first reading, direction-adjusted so improvement is always positive. That shared scale lets a coverage floor and a byte-size ceiling average into one line, and lets "most improved" compare like-for-like. The Agents section uses the same cohort boundary as the detectors: the card counts identities below the reporting minimums without listing them, and always states the unattributed share.

## Validation workflow cycles

A validation workflow run is an analyzed `prepare`, `test`, or `done`; recorded `clean` is its entry state. Complete, incomplete, legacy, and unattributed evidence share one run denominator. At the standalone-test boundary, complete dirty validation counts tracked-only, untracked-only, mixed, or unclassified state without filenames. Full-Gate evidence follows mutating pre-groups, so a dirty entry remains unclassified instead of mixing moments.

A validation workflow cycle links recorded events on one branch under one config epoch ([ADR 0275](../_adr/0275-validation-workflows-use-stream-bounded-change-cycles.md)). A successful `start` for a reused branch, a successful `accept`, or an epoch change closes it. After a clean green Gate, a later dirty entry or different recorded HEAD begins another cycle. A run without an epoch stands alone.

A commit does not automatically end a cycle. Dirty pre-commit validation at one HEAD and the later clean `done` at its new committed HEAD stay in the same cycle. The test-first route begins dirty, the commit-first route begins clean, and an unknown first entry remains unattributed. The narrower pre-commit-to-clean-Gate count requires a dirty run, a later distinct recorded HEAD, and a clean green `done` on that later HEAD. Cycle construction uses the recorded stream only, so archived reports have the same result without consulting the current Git graph.

Each route reports cycles, branches, runs, successful and failed runs, cycles that reached a clean Gate, cycles with a failure, and retries. A retry is every validation run after the first inside the same stream-defined cycle. The counts describe route shape; they do not prescribe an order or treat pre-commit testing as a defect.

Workflow cohort rows appear only when at least two identity cohorts clear the shared `COHORT_MINIMUMS`. Every speaking cohort carries cycle and run denominators, and the section retains below-minimum and unattributed cycle/run remainders. These task-confounded counts do not rank agents or imply capability.

Once the span holds 2 days, cadence sparklines sit beside the Accepted, gate, Standards, Agents, and Breadth headings. Each listed agent carries its own usage series, and the shares render as filled bars beside their denominators. The same series ride the JSON (`per_day`, `greens_per_day`, `trend`, `branches_per_day`), capped at 24 points. A longer span folds whole days into each point and states the fold in `series_days_per_point`.

## The rules of the surface

Every number is a count or duration from the same analysis population the detectors read: CI runs, `--dry-run` previews, and setup-era events stay out. The card assigns no score, grade, or rank. The Logbook never leaves the machine, so there is no external corpus for comparison ([ADR 0229](../_adr/0229-practice-stats-are-counted-local-and-never-comparative.md)). Each number can be re-derived from the checkout.

`--json` carries the counts as `data.stats`, and over MCP `discern_patterns` takes `stats: true`. Without the flag the payload carries no stats key at all.

A single accepted change keeps `biggest` and `best day` off the card, since either would restate the change itself, and streaks of one stay quiet. An empty Logbook says there are no stats yet and suggests checking back.

## Where it lives in code

| Concern                                | Source                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The computation                        | [`stats.ts`](../../../src/engine/logbook/stats.ts)                                                                                                         |
| Identity thresholds and cohort routing | [`cohorts.ts`](../../../src/engine/logbook/cohorts.ts)                                                                                                     |
| The flag, the card, and the wire       | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)                                                                                                   |
| Counts proven from synthetic streams   | [`stats_test.ts`](../../../tests/stats_test.ts)                                                                                                            |
| Black-box CLI and archive coverage     | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts), [`engine_logbook_lifecycle_test.ts`](../../../tests/engine_logbook_lifecycle_test.ts) |
