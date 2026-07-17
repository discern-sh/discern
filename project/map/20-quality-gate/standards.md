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

_Put a number behind a quality promise, then prevent later branches from moving it the wrong way._

A standard is a measured floor or ceiling in `discern.toml`. Use `direction = "up"` for a metric such as coverage, where the limit is a floor. Use `direction = "down"` for a metric such as binary size, where the limit is a ceiling. Every `discern done` verifies that the branch did not weaken or delete a trunk limit before it runs expensive jobs ([ADR 0133](../_adr/0133-standards-join-the-gate.md)).

## Add a standard

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

`metric` changes the expected metric name when it differs from the table name. `timeout` gives this measurement its own time budget. `margin` leaves headroom when a later pin tightens the limit.

Use `per` and `scale` when a raw count grows with the project. A prose-alert ceiling expressed per 1,000 words measures density, so adding documentation at the same quality does not consume the budget ([ADR 0057](../_adr/0057-rate-standards.md)).

## What the gate does

After the never-loosen check, the gate handles each measurement in the same parallel group as checks and tests:

- It measures by default.
- It replays the recorded value when the standard declares `inputs`, a usable measurement receipt exists, and none of those inputs changed.
- It defers the measurement when `measure = "on-demand"`; the limit check still runs. Use `discern standards` to measure deferred standards.

`discern prepare` never measures standards. It remains the fast fix-and-check loop.

## Respond to a failure

A standard failure names the measured value, the limit, and the measurement command in `diagnostics[]`.

The public shape of those fields is in [Model Context Protocol tools and results](../70-reference/mcp-and-results.md).

| Failure                                    | Response                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| The metric regressed                       | Raise an `up` metric or lower a `down` metric until it holds the configured limit.                                |
| The branch weakened or deleted a limit     | Restore the trunk value. Tell the owner if the old limit is no longer valid.                                      |
| The measurement emitted no matching metric | Make the command print `DISCERN_METRIC <name> <number>` and rerun it.                                             |
| The measurement is too slow                | Add accurate `inputs`, set a per-job `timeout`, or use `measure = "on-demand"` when it cannot fit the final gate. |

Loosening a limit is an owner decision made directly on trunk. A feature branch cannot authorize its own lower bar ([ADR 0003](../_adr/0003-named-metric-standards.md)).

## Capture an improvement

Run `discern standards --pin coverage` after the metric improves. Pin measures the standard and tightens its limit, leaving any configured `margin`. It only moves limits in the permitted direction and reuses a valid measurement receipt when one is available.

## Where it lives in code

| Concern                                 | Source                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| Config fields and validation            | [`config_schema.ts`](../../../src/shared/config_schema.ts)        |
| Pure standard plan                      | [`standard_plan.ts`](../../../src/engine/gate/standard_plan.ts)   |
| Gate verification, replay, and deferral | [`standards_gate.ts`](../../../src/engine/gate/standards_gate.ts) |
| Measurement and pin execution           | [`standards.ts`](../../../src/engine/gate/standards.ts)           |

## Current state & gotchas

- An `inputs` list is a correctness boundary. If it omits a file the metric reads, the gate can replay an older value until a later full measurement catches the change.
- When the gate cannot read trunk, it continues with a prominent `UNVERIFIED` warning and records that state in the result and receipt. Fetch the trunk in CI so the comparison is conclusive.
- The relevant source files contain no unfinished-work markers for standard behavior.
