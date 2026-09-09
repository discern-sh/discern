---
title: Completion observations in Patterns
description: Interpret validation repeats, measured durations, and completion observations without inferring authority or author quality.
order: 85
---

# Completion observations in Patterns

Patterns reads the logbook as advisory evidence. It cannot grant approval, establish executor ownership, determine child quiescence, advance a queue, or repair an environment. An unmatched invocation start is an incomplete observation. A future claim deadline establishes neither activity nor death.

## Validation repeats and duration trends

A repeated green validation finding needs the same complete recorded validation state and execution conditions. Jobs enroll through recorded execution membership. An explicit diagnostic rerun, changed source or setup, unknown intervening result, or ownership-only green reuse does not establish redundant validation. A cooperative acceptance call from another checkout does not need a green command on the caller's branch.

Duration drift uses green calls that explicitly ran the gate and recorded their capacity wait. It compares one configuration and writer epoch, with change size present. The remaining invocation duration can include preparation, reporting, return and publication. Cache, host load and required test membership remain confounders. Missing wait measurements stay unknown.

Repeated delivery of an invocation counts once. Contradictory copies leave an unknown position in the sequence, so the reader cannot connect repeated validation across that gap. A gap in completed logbook entries invites a current-status lookup; it does not establish an inactive or abandoned effort. Historical same-branch start/accept intervals describe command observations, with their limited coverage made explicit.

Repeated failed checks can identify diagnostics worth investigating. Cancelled, skipped and unknown job outcomes do not establish failed validation verdicts. Older records retain explicitly reported check-stage failures at their original resolution. Source changes, owner feedback and changed integrations can require further validation; neither a streak nor a driver cohort establishes author quality. Recorded owner waits do not enter refusal-loop findings.

## Canary review candidates

The canary-drift finding requires repeated, identified full-test failures alongside a passing canary under one recorded setup. Diagnostics identify candidate files for review. Each invocation counts once per file; a collapsed diagnostic count cannot turn one failure into several independent failures.

The finding reaches Patterns and the ordinary advisory route into `improvement`. It asks for existing membership and exclusions, relevant execution contexts, and measured incremental cost before enrollment. A green canary does not establish that the failing case was absent: suite ordering or context may differ. Missing or contradictory job verdicts remain insufficient evidence. No finding changes membership or grants Proof.

This repository's [canary registry](../../../scripts/canary_registry.ts) owns enrollment and recorded exclusions. Its [audit](../../../scripts/canary_audit.ts) supplies the existing history view for that review. [The failure reader](../../../src/engine/logbook/test_failure_findings.ts) owns identified per-file observations used by the detector.

## Completion accounting

When completion observations are present, the report keeps source efforts, candidates, attempts, executor operations and landing transactions separate. Repeated delivery counts once by the durable observation identity. Conflicting facts remain an explicit evidence gap.

Component receipts are not physical producer executions: one producer can yield several receipts, including failed, cancelled, unrun or stale outcomes. Reused receipts identify evidence consumed by an attempt. Receipt counts and durations cannot establish physical execution counts or compute totals.

Each timing category reports its observed sum and the union of its intervals. Concurrent work sums can exceed elapsed time. Categories can also overlap, so adding their elapsed times does not produce completion latency. Missing clocks and unavailable denominators remain unknown.

A candidate's invalidation counts once; the affected-candidate list supplies context, not more independent observations. Withdrawal after an eligible prediction is separate from withdrawal without prediction evidence. Invalidations alone cannot supply the eligible-prediction denominator or a miss rate.

Recovery return observations join by environment and interrupted attempt. Repeated return notifications do not create additional failed validations. Landing and retirement outcomes have their own durable identities. A retained historical landing cannot establish the cleanup outcome of a later operation, and a retirement result does not establish storage reclamation or a leak.

Start at the [validation reader](../../../src/engine/logbook/validation_findings.ts), [completion accounting reader](../../../src/engine/logbook/completion_economics.ts), and [detector registry](../../../src/engine/logbook/detectors.ts). [Decision evidence](patterns-decision-evidence.md) describes the broader comparison and recommendation boundaries.
