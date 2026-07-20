---
title: Practice patterns
description: Read what the logbook shows about how agents drive discern here — thrash loops, gate fit, funnel flow, and each standard's trajectory.
order: 80
aliases:
  - discern patterns
  - patterns
  - detectors
  - practice health
  - logbook reader
---

# Practice patterns

_`discern patterns` reads the [logbook](../70-reference/the-logbook.md) and reports what keeps happening, with the counts behind each finding and one recommended next step._

The diagnostic verbs ask three different questions. `discern doctor` asks whether the install is valid. `discern improvement` asks whether the setup follows best practice. `discern patterns` asks whether the practice itself is healthy: how agents drive the workflow, how the gate fits the stack, and how the numbers move over time ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Advisory only: it never blocks. Findings carry counts and durations, no scores and no severity tiers ([ADR 0063](../_adr/0063-doctor-execution-model.md)), and enforcement stays with [standards](standards.md).

## Run it

```sh
discern patterns
discern patterns --json
```

Findings arrive ranked by evidence strength. Each one states what was observed as a plain-count sentence ("`done` failed 4 consecutive runs on this branch"), names its scope (one branch, one conversation, or the project), and recommends a structural next step, often a bundled skill. The JSON form carries the same report in `data.findings`, plus `data.detectors` with every detector's status.

An empty logbook is a normal state: the report says so and suggests checking back after some use. A repository that never recorded (or opted out with `[project].logbook = false`) still gets a readable answer.

## What the detectors watch

A registry of named detectors runs over the event stream, grouped by family:

| Family     | Watches for                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Behaviour  | Red `done` streaks, repeated refusals with one slug, `done`-only iteration with no `prepare`, dirty-tree churn, edits on the trunk, recurring `--force`, missed doc lookups, worktrees started but never green, out-of-protocol orderings. |
| Gate fit   | One job dominating gate wall time, duration creep on an unchanged setup, a fix stage with no visible effect, one diagnostic class failing across branches, divergent verdicts on an identical tree — the flake signature.                  |
| Funnel     | Red runs before the first green per branch, start-to-accept cycle time, single giant-commit landings, update friction trending up.                                                                                                         |
| Trajectory | Each standard's measured value over time beside its limit's own history (read from pin events), and the monthly red rate, extended past rotation by prune digests.                                                                         |

Detector thresholds start conservative and are recorded beside each entry in the registry source.

## How the evidence is handled

Every detector declares an evidence threshold. Below it, the report says "insufficient evidence" for that detector rather than extrapolating: a young logbook produces a short report.

The recorder stores raw driver signals; scoring them is reader logic here. CI runs and `--dry-run` previews reach no detector, and runs that look interactively driven never count toward agent-behaviour findings — your own exploratory poking is not agent pathology ([ADR 0162](../_adr/0162-logbook-day-one-vocabulary.md)).

Trend detectors compare only within one config epoch and one discern release. When a config change or a release bisects the window, the report names the boundary (the section that moved, the version pair, the date) instead of blending incomparable runs or staying silent. Where rotation has removed raw months, the prune digests extend coarse series, marked as coarse.

## Reset the history

```sh
discern patterns reset --dry-run
discern patterns reset
```

The reset deletes the logbook directory (every month file and the epoch sidecar) and prints what it removed. `--dry-run` lists the same plan without touching anything. It is the family's one destructive action and lives on the CLI only: deleting recorded history is an owner's local decision, so no MCP tool exposes it ([ADR 0163](../_adr/0163-patterns-reset-cli-only.md)). Recording starts again on the next verb run unless `[project].logbook = false`.

The result fields and Model Context Protocol arguments are in [MCP tools & results](../70-reference/mcp-and-results.md); the recording substrate itself is covered in [the logbook](../50-engine-internals/the-logbook.md).

## Where it lives in code

| Concern                                  | Source                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| The detector registry and every detector | [`detectors.ts`](../../../src/engine/logbook/detectors.ts)             |
| The verb core, rendering, and the reset  | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)               |
| The tolerant stream reader               | [`read.ts`](../../../src/engine/logbook/read.ts)                       |
| Wire vocabulary and data schemas         | [`patterns_vocabulary.ts`](../../../src/shared/patterns_vocabulary.ts) |
| Registry-driven fixtures and behaviour   | [`patterns_test.ts`](../../../tests/patterns_test.ts)                  |
| Black-box CLI coverage                   | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts)    |

## Current state & gotchas

- Findings surface only under this verb today; receipt and `status` surfacing is planned, and each detector already carries the `tier` and `scope` that routing will use.
- Ranking mixes count-based strengths across detector kinds; treat the order as a reading order, and the `evidence` counts as the facts.
- Events written before the current release may lack newer fields (a step's gate stage, for example); detectors count such runs out rather than guessing.
- A torn or foreign line is skipped and counted in `data.logbook.unparsed`; reading continues.
