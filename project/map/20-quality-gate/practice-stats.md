---
title: Practice stats
description: "Read the Logbook for what went well: changes accepted, green streaks, cycle times, Standards trends, and agent cohorts in a shareable card of plain counts."
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

| Section   | Counts                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accepted  | Changes accepted and the branches they came from; lines added and removed with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak. |
| The Gate  | `done` runs and greens, the red runs the Gate stopped, the longest and current green streaks, first-try greens per branch, and hours of checks run across `done`, `prepare`, and `test`.         |
| Pace      | Starts that ended in an accepted change, measured start-to-accept cycles with the median and fastest times and how many finished inside a day, and the acceptance cadence across the span.       |
| Standards | Limits tightened and how many Standards they cover, the average measured trend, and the most improved Standard.                                                                                  |
| Agents    | Attributed agent identities with their runs, usage series, and green-`done` shares.                                                                                                              |
| Breadth   | Branches driven, active days out of the span, the day the most branches were active, and the most changes in flight at one instant.                                                              |

An accepted change is a successful `accept`, and its scale reads from the recorded change counts. Streaks count consecutive `done` runs in stream order. A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](patterns.md#what-the-detectors-watch) matches them. A cycle therefore needs both ends on record: an accept whose start predates the logbook counts as accepted without adding a cycle.

For the overlap reading, a branch is in flight from its first analyzed event to its last. A pause inside that window stays in flight. A branch stops counting after its last event, and the trunk is not a change. The Standards trend normalizes each Standard to its own first reading, direction-adjusted so improvement is always positive. That shared scale lets a coverage floor and a byte-size ceiling average into one line, and lets "most improved" compare like-for-like. The Agents section uses the same cohort boundary as the detectors: the card counts identities below the reporting minimums without listing them, and always states the unattributed share.

Once the span holds 2 days, cadence sparklines sit beside the Accepted, gate, Standards, Agents, and Breadth headings. Each listed agent carries its own usage series, and the shares render as filled bars beside their denominators. The same series ride the JSON (`per_day`, `greens_per_day`, `trend`, `branches_per_day`), capped at 24 points. A longer span folds whole days into each point and states the fold in `series_days_per_point`.

## The rules of the surface

Every number is a count or duration from the same analysis population the detectors read: CI runs, `--dry-run` previews, and setup-era events stay out. The card assigns no score, grade, or rank. The Logbook never leaves the machine, so there is no external corpus for comparison ([ADR 0229](../_adr/0229-practice-stats-are-counted-local-and-never-comparative.md)). Each number can be re-derived from the checkout.

`--json` carries the counts as `data.stats`, and over MCP `discern_patterns` takes `stats: true`. Without the flag the payload carries no stats key at all.

A single accepted change keeps `biggest` and `best day` off the card, since either would restate the change itself, and streaks of one stay quiet. An empty Logbook says there are no stats yet and suggests checking back.

## Where it lives in code

| Concern                              | Source                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| The computation                      | [`stats.ts`](../../../src/engine/logbook/stats.ts)                  |
| The flag, the card, and the wire     | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)            |
| Counts proven from synthetic streams | [`stats_test.ts`](../../../tests/stats_test.ts)                     |
| Black-box CLI coverage               | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts) |
