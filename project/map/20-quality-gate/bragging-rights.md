---
title: Bragging rights
description: Read the logbook for what went well — changes shipped, green streaks, cycle times, and tightened limits — as one shareable card of plain counts.
order: 120
aliases:
  - discern patterns --brag
  - brag
  - bragging rights
  - vanity metrics
---

# Bragging rights

_`discern patterns --brag` reads the [logbook](../50-engine-internals/the-logbook.md) for what went well and renders it as one card of plain counts: the practice's feats, each with its denominator beside it._

```sh
discern patterns --brag
```

## What the card counts

| Section   | Counts                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shipped   | Changes shipped and the branches they came from; lines added and removed with their ratio; the changes that removed more than they added; the biggest change; the best day; the longest streak. |
| The gate  | `done` runs and greens, the red runs the gate stopped, the longest and current green streaks, first-try greens per branch, and hours of checks run across `done`, `prepare`, and `test`.        |
| Pace      | Starts that went on to ship, completed start-to-accept cycles with the median and fastest times and how many finished inside a day, and how often a change shipped across the span.             |
| Standards | Limits tightened, and how many standards they cover.                                                                                                                                            |
| Breadth   | Branches driven, active days against the span, and the day the most branches were active at once.                                                                                               |

A shipped change is a successful `accept`, and its scale reads from the recorded change counts. Streaks count consecutive `done` runs in stream order. A cycle matches a `start`'s created branch to the first later `accept` on it, the same way the [funnel detector](patterns.md#what-the-detectors-watch) matches them.

Once the span holds 2 days, cadence sparklines sit beside the Shipped, gate, and Breadth headings — changes shipped, green runs, and active branches per day — and the shares render as filled bars beside their denominators. The same series are in the JSON (`per_day`, `greens_per_day`, `branches_per_day`), capped at 24 points; a longer span folds whole days into each point and states the fold in `series_days_per_point`.

## The rules of the surface

Every number is a count or duration from the same analysis population the detectors read: CI runs, `--dry-run` previews, and setup-era events stay out. Nothing is scored, graded, or ranked — the logbook never leaves the machine, so there is no corpus to compare against ([ADR 0229](../_adr/0229-bragging-rights-are-counted-local-and-never-comparative.md)). The card is yours to share, and every number on it can be re-derived from the checkout: a brag that survives an audit.

`--json` carries the counts as `data.brag`, and over MCP `discern_patterns` takes `brag: true`. Without the flag the payload carries no brag key at all.

A single shipped change keeps `biggest` and `best day` off the card, since either would restate the change itself, and streaks of one stay quiet. An empty logbook says there is nothing to brag about yet and suggests checking back.

## Where it lives in code

| Concern                              | Source                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| The computation                      | [`brag.ts`](../../../src/engine/logbook/brag.ts)                    |
| The flag, the card, and the wire     | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)            |
| Counts proven from synthetic streams | [`brag_test.ts`](../../../tests/brag_test.ts)                       |
| Black-box CLI coverage               | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts) |
