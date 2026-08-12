---
title: Patterns decision evidence
description: Read the project-local evidence required before Patterns recommends a Gate configuration or Standard pin.
order: 140
aliases:
  - decision-grade patterns
  - fail-fast tradeoff
  - Standard pin recommendation
---

# Patterns decision evidence

_Percentages, estimates, and mechanical eligibility become recommendations only when comparable local history supports the action._

`discern patterns` remains advisory. Its decision findings carry the comparable count and denominator, matched setup conditions, excluded events, limitations, and an `observed` or `estimated` label for every numerical value. Active and sealed Logbook sources use the same arithmetic.

## Gate-time share

A dominant job or generated-family percentage is a statistic. It produces optimization advice only when comparable local history also records avoidable cost: a named scope gate running outside its scope, repeated execution on one complete unchanged validation state, or material queue contention. There is no universal duration floor. A necessary test can dominate the Gate and remain quiet.

## Fail-fast tradeoff ledger

`masked-failures` retains its compatibility id and reports observations separately: cancelled and never-started jobs, distinct failures in later comparable red rounds, additional Gate rounds, and those rounds' elapsed time. Adjacent rounds do not establish when or why a later failure arose.

Saved tail is an estimate: the median of at least 3 completed durations for the same job and setup, less recorded partial cancellation time. The finding states the sample, exclusions, and assumption.

If later-round time exceeds 1.5 times a fully sampled maximum-duration saved-tail estimate, the finding recommends a controlled project-local `fail_fast = false` trial before adoption. If the median saved-tail estimate exceeds later-round time by 1.5 times, it recommends keeping fail-fast. Otherwise it calls the tradeoff unresolved and routes to a controlled experiment.

When unresolved later distinct failures coincide with long-running or queued validation under one recorded setup, the additive validation-scheduling investigation proposes one bounded comparison. It preserves recorded time and queue observations separately from saved-tail estimates and makes no causal claim.

## Standard trajectory decisions

The Gate records whether a measured or replayed Standard is mechanically eligible to pin and the exact target under its margin. Patterns reads that authority; it does not repeat direction, rounding, or margin arithmetic. Eligibility remains visible even when no pin is recommended.

A recommendation additionally requires a current active Standard, measured or replayed evidence, Gate eligibility across the latest 3 comparable readings, and no direction reversal or same-Standard regression in the latest 5. A deferred on-demand reading routes to `discern standards`. Missing current fields stay historical or stale. A retired Standard remains a trajectory without a live pin action.

When current mechanical eligibility instead coincides with recent comparable reversals or failures, the additive Standard-variance investigation replaces no finding and offers no pin advice. It directs the owner to test whether the headroom is durable ([ADR 0277](../_adr/0277-patterns-investigations-preserve-source-findings.md)).

The thresholds and authority boundary are recorded for future changes ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)). [Practice patterns](patterns.md) covers the report, detector families, evidence handling, and historical selection.
