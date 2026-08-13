---
title: Standards
description: Hold a quality metric at a floor or ceiling that a branch can tighten but cannot weaken.
order: 20
aliases:
  - quality metrics
  - metric floors
  - metric ceilings
  - discern standards
---

# Standards

_Hold a quality measure at a floor or ceiling that later branches cannot weaken._

A quality measure that can only improve (a Standard) is a measured floor or ceiling in `discern.toml`. Every entry declares its direction: `direction = "up"` holds a floor; `direction = "down"` holds a ceiling. Omitting it is invalid. Before expensive work, `discern done` rejects a branch that weakens or deletes a trunk limit ([ADR 0133](../_adr/0133-standards-join-the-gate.md)).

## Add a Standard

```toml
[standards.coverage]
direction = "up"
limit = 89
run = "deno task coverage"
inputs = ["src/**", "tests/**"]
```

The measurement command reports its value on stdout:

```text
DISCERN_METRIC coverage 91.4
```

`metric` overrides the emitted metric name. `timeout` sets this measurement's budget. `margin` leaves headroom when pinning.

## Choose a number that survives growth

Ask before wiring: does this number move when the project healthily grows? The answer decides how to hold it.

- An **invariant** never moves with growth, such as lint suppressions or uses of a banned pattern. Hold the raw count and drive it to zero.
- A **quality that scales** rises with the tree, such as coverage or alert density. Hold the rate: `per` and `scale` divide the metric, so a per-1,000-word ceiling holds density without penalizing proportional growth ([ADR 0057](../_adr/0057-rate-standards.md)).
- A **growing total** rises with each shipped feature, such as an asset size or word count. A ceiling pinned at today's value fails the next legitimate change. The resulting pressure can shrink unrelated content or trade readability for bytes while the Gate remains green. Prefer the rate that states the real claim. Where only the total will do, set a `margin` and treat raising the limit as a routine owner decision.

Report a breach the work itself caused (the deliverable grew what the metric measures) instead of engineering the number back down. The owner moves the limit on the trunk, and the breach diagnostic says so at the moment it fires ([ADR 0161](../_adr/0161-growth-proof-standards-and-breach-escalation.md)).

## What the Gate does

The Gate checks limits, then measures with checks and tests. It replays unchanged declared `inputs` and sends `measure = "on-demand"` to `discern standards`. Limits never defer. `discern prepare` skips measurement.

Package StandardMeter views retain each reading, limit, headroom, trajectory, measurement source, margin, and pin eligibility. Deferred and skipped facts invent no value. [`presentation.ts`](../../../src/engine/gate/presentation.ts) only maps `GateStandard` facts; the Gate still decides comparisons and pin eligibility.

One pure Gate function decides mechanical pin eligibility from direction, measured value, configured `margin`, and current limit. A measured or replayed result carries `margin`, `pin_eligible`, and the exact `pin_target` when eligible. Gate pinning and advisory Patterns therefore consume the same answer. Eligibility means only that the target is strictly tighter and still holds the measurement; [Patterns decision evidence](patterns-decision-evidence.md#standard-trajectory-decisions) applies separate freshness, persistence, variance, failure, and retirement evidence before recommending a pin ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)).

## Run standards directly

`discern standards` freshly measures every Standard, including `measure = "on-demand"`. First it checks branch limits and trunk-only entries from one trunk snapshot. A loosened Standard skips its command. Deleted entries and malformed trunk config fail without suppressing valid measurements.

Runnable measurements share one parallel, fail-fast-off group. The gate runner supplies global and per-standard timeouts, process-tree kill, durations, terminal interruption, and Model Context Protocol cancellation. Output stays buffered until the result envelope renders ([ADR 0155](../_adr/0155-standalone-standards-share-the-gate-job-pipeline.md)).

## Respond to a failure

A failure puts its reason, value, limit, and command in `diagnostics[]`. [Tool result contracts](../70-reference/mcp-and-results.md) defines the public shape.

| Failure                                    | Response                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| The metric regressed                       | Move it the right way within the task's scope. Report a breach the work itself caused; the owner moves the limit. |
| The branch weakened or deleted a limit     | Restore the trunk value. Tell the owner if the old limit is no longer valid.                                      |
| The measurement emitted no matching metric | Make the command print `DISCERN_METRIC <name> <number>` and rerun it.                                             |
| The measurement is too slow                | Add accurate `inputs`, set a per-job `timeout`, or use `measure = "on-demand"` when it cannot fit the final gate. |

An owner may loosen a limit directly on trunk ([ADR 0003](../_adr/0003-named-metric-standards.md)).

## Capture an improvement

`discern standards --pin coverage` reuses a Proof or measures, uses `margin`, tightens `coverage`, and commits `discern.toml`. The commit keeps your Git identity and adds `discern` as a co-author because discern composed the diff ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)). A write-access probe runs first. A denial returns `error = "write_access"` ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

Pin records a clean `HEAD` before reading values and rechecks before editing. A mismatch writes nothing. Restore a stable `HEAD` and rerun. You can pin behind trunk. A hint says the values describe that tree, the limit may fail after `discern update`, and recommends updating first.

## Where it lives in code

| Concern                                   | Source                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Config fields and validation              | [`config_schema.ts`](../../../src/shared/config_schema.ts)          |
| Pure standard plan                        | [`standard_plan.ts`](../../../src/engine/gate/standard_plan.ts)     |
| Shared trunk-limit verification           | [`standard_limits.ts`](../../../src/engine/gate/standard_limits.ts) |
| Shared measurement and pin execution      | [`standards.ts`](../../../src/engine/gate/standards.ts)             |
| Gate replay and deferral policy           | [`standards_gate.ts`](../../../src/engine/gate/standards_gate.ts)   |
| Human Standard presentation               | [`presentation.ts`](../../../src/engine/gate/presentation.ts)       |
| Parallel scheduling and process-tree kill | [`runner.ts`](../../../src/engine/jobs/runner.ts)                   |
| Built-in write probes                     | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)      |

## Current state & gotchas

- `inputs` is a correctness boundary: omitting a file the metric reads can replay a stale value.
- An unreadable trunk produces a prominent `UNVERIFIED` warning; the gate records it in the result and proof. Fetch trunk where standards run.
