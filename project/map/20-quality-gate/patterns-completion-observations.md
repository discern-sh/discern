---
title: Completion observations in Patterns
description: Interpret validation repeats, measured durations, and producer accounting without inferring authority or author quality.
order: 85
---

# Completion observations in Patterns

Patterns reads the logbook as advisory evidence. It cannot grant approval, establish that a run is live, or land anything. An unmatched invocation start is an incomplete observation.

## Validation repeats and duration trends

A repeated green validation finding needs the same complete recorded validation state and execution conditions. Jobs enroll through recorded execution membership. An explicit diagnostic rerun, changed source or setup, or an unknown intervening result does not establish redundant validation.

Duration drift uses green calls that explicitly ran the gate and recorded their test-slot wait. It compares one configuration and writer epoch, with change size present. The remaining invocation duration can include preparation and reporting. Cache, host load, and required test membership remain possible influences. Missing wait measurements stay unknown.

Repeated delivery of an invocation counts once. Contradictory copies leave an unknown position in the sequence, so the reader cannot connect repeated validation across that gap. A gap in completed logbook entries invites a current-status lookup; it does not establish an inactive or abandoned effort. Historical same-branch start/accept intervals describe command observations, with their limited coverage made explicit.

Only supported validation schemas enter comparisons. Matching future version numbers do not establish a known evidence contract. The evidence basis names varying setup dimensions separately from matched conditions; missing setup fields cannot establish a match.

Explicit rerun flags count requests. Recorded gate execution is reported separately, including requests that did not run and requests whose execution is unknown. The flag cannot establish prior green evidence for the same subject. Workflow statistics require an explicit job, scope-gate, or standard validation failure, including a failed standard after its producer passed; coordination refusals, cancelled jobs, and missing verdicts do not enter those failure counts. The broader command-duration sum includes waits and overlap; it is not elapsed completion time or compute.

Repeated failed checks can identify diagnostics worth investigating. Cancelled, skipped, and unknown job outcomes do not establish failed validation verdicts. Older records retain explicitly reported check-stage failures at their original resolution. Source changes, owner feedback, and changed integrations can require further validation; neither a streak nor a driver cohort establishes author quality. Recorded owner waits do not enter refusal-loop findings.

## Canary review candidates

The canary-drift finding requires repeated, identified full-test failures alongside a passing canary under one recorded setup. Diagnostics identify candidate files for review. Each invocation counts once per file; a collapsed diagnostic count cannot turn one failure into several independent failures.

The finding reaches `discern patterns` and the ordinary advisory route into `improvement`. It asks for existing membership and exclusions, relevant execution conditions, and measured incremental cost before enrollment. A green canary does not establish that the failing case was absent: suite ordering or conditions may differ. Missing or contradictory job verdicts remain insufficient evidence. No finding changes membership or grants Proof.

This repository's [canary registry](../../../scripts/canary_registry.ts) owns enrollment and recorded exclusions. Its [audit](../../../scripts/canary_audit.ts) supplies the existing history view for that review. [The failure reader](../../../src/engine/logbook/test_failure_findings.ts) owns identified per-file observations used by the detector.

## Producer accounting

The [report adapter](../../../src/engine/logbook/completion_report.ts) selects eligible recorded observations and presents the shared accounting prose; the [economics reader](../../../src/engine/logbook/completion_economics.ts) owns identity and interval calculations.

The CLI and MCP recorder append producer observations during each recorded operation, independently of its final response. Nested progress presentation receives a separate copy and cannot consume these facts. An unavailable recorder never changes the result.

Native command-start observations count producer executions. Metric extractors have a separate role, and repeated receipts do not multiply either count. A start without a completed result remains unresolved; it establishes neither current activity nor death. Completed command durations run from native spawn through captured-result availability. Their sum measures elapsed producer work, including waits inside the command, rather than CPU use. Observations missing from an older record or outside the retained window remain unknown. A completed-validation summary can establish zero new producers on a reuse-only run; absence of start events alone cannot.

Component receipts are not physical producer executions: one producer can yield several receipts, including failed, cancelled, `unrun`, or stale outcomes. Reused receipts identify evidence consumed by an attempt. Without a consuming attempt identity, a known receipt can retain its verdict but cannot enter execution or reuse totals. Receipt counts and durations cannot establish physical execution counts or compute totals.

Timing observations separate test-slot wait, validation, and landing. Each category reports its observed sum and the union of its intervals. Concurrent work sums can exceed elapsed time, and categories can overlap, so adding their elapsed times does not produce completion latency. Missing clocks and unavailable denominators remain unknown. Approval-to-land starts at the recorded approval and ends at the durable ref-advance observation. Emergency landings have no normal approval span. Latency medians retain their sample counts and clock gaps.

Start at the [validation reader](../../../src/engine/logbook/validation_findings.ts), [accounting reader](../../../src/engine/logbook/completion_economics.ts), and [detector registry](../../../src/engine/logbook/detectors.ts). [Decision evidence](patterns-decision-evidence.md) describes the broader comparison and recommendation boundaries.
