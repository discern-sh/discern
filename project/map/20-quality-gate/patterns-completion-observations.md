---
title: Completion observations in Patterns
description: Interpret validation repeats, measured durations, and completion observations without inferring authority or author quality.
order: 85
---

# Completion observations in Patterns

Patterns reads the logbook as advisory evidence. It cannot grant approval, establish executor ownership, determine child quiescence, advance a queue, or repair an environment. An unmatched invocation start is an incomplete observation. A future claim deadline establishes neither activity nor death.

## Validation repeats and duration trends

A repeated green validation finding needs the same complete recorded validation state and execution conditions. Jobs enroll through recorded execution membership. An explicit diagnostic rerun, changed source or setup, unknown intervening result, or ownership-only green reuse does not establish redundant validation. A cooperative acceptance call from another checkout does not need a green command on the caller's branch.

Duration drift uses green calls that explicitly ran the gate and recorded their capacity wait. It compares one configuration and writer epoch, with change size present. The remaining invocation duration can include preparation, reporting, return and publication. Cache, host load and required test membership remain possible influences. Missing wait measurements stay unknown.

Repeated delivery of an invocation counts once. Contradictory copies leave an unknown position in the sequence, so the reader cannot connect repeated validation across that gap. A gap in completed logbook entries invites a current-status lookup; it does not establish an inactive or abandoned effort. Historical same-branch start/accept intervals describe command observations, with their limited coverage made explicit.

Only supported validation schemas enter comparisons. Matching future version numbers do not establish a known evidence contract. The evidence basis names varying setup dimensions separately from matched conditions; missing setup fields cannot establish a match.

Explicit rerun flags count requests. Recorded gate execution is reported separately, including requests that did not run and requests whose execution is unknown. The flag cannot establish prior green evidence for the same subject. Workflow statistics require an explicit job, scope-gate or standard validation failure, including a failed standard after its producer passed; coordination refusals, cancelled jobs and missing verdicts do not enter those failure counts. Repeated invocation delivery counts once, and contradictory observations end active workflow sequences. The broader command-duration sum includes waits and overlap; it is not elapsed completion time or compute.

Repeated failed checks can identify diagnostics worth investigating. Cancelled, skipped and unknown job outcomes do not establish failed validation verdicts. Older records retain explicitly reported check-stage failures at their original resolution. Source changes, owner feedback and changed integrations can require further validation; neither a streak nor a driver cohort establishes author quality. Recorded owner waits do not enter refusal-loop findings.

## Canary review candidates

The canary-drift finding requires repeated, identified full-test failures alongside a passing canary under one recorded setup. Diagnostics identify candidate files for review. Each invocation counts once per file; a collapsed diagnostic count cannot turn one failure into several independent failures.

The finding reaches `discern patterns` and the ordinary advisory route into `improvement`. It asks for existing membership and exclusions, relevant execution contexts, and measured incremental cost before enrollment. A green canary does not establish that the failing case was absent: suite ordering or context may differ. Missing or contradictory job verdicts remain insufficient evidence. No finding changes membership or grants Proof.

This repository's [canary registry](../../../scripts/canary_registry.ts) owns enrollment and recorded exclusions. Its [audit](../../../scripts/canary_audit.ts) supplies the existing history view for that review. [The failure reader](../../../src/engine/logbook/test_failure_findings.ts) owns identified per-file observations used by the detector.

## Completion accounting

The [report adapter](../../../src/engine/logbook/completion_report.ts) selects eligible recorded observations and presents the shared accounting prose; the [economics reader](../../../src/engine/logbook/completion_economics.ts) owns identity and interval calculations.

The CLI and MCP recorder append canonical executor observations during each recorded operation, independently of its final response. Nested progress presentation receives a separate copy and cannot consume these facts. An unavailable recorder never changes the executor result. Context is gathered once per invocation; observations retain the executor’s actual source and attempt identity when the caller represents another effort.

When completion observations are present, the report keeps source efforts, candidates, attempts, executor operations and landing transactions separate. Repeated delivery counts once by the durable observation identity. Conflicting facts remain an explicit evidence gap. An immutable receipt with contradictory producer or verdict observations across consumers contributes to that gap, never a last-observed verdict.

Native command-start observations count producer executions. Metric extractors have a separate role, and repeated receipts do not multiply either count. A start without a completed result remains unresolved; it establishes neither current activity nor death. Completed command durations run from native spawn through captured-result availability. Their sum measures elapsed producer work, including waits inside the command, rather than CPU use. Observations missing from an older record or outside the retained window remain unknown. A canonical completed-validation summary can establish zero new producers on a reuse-only run; absence of start events alone cannot.

Component receipts are not physical producer executions: one producer can yield several receipts, including failed, cancelled, `unrun` or stale outcomes. Reused receipts identify evidence consumed by an attempt. Without a consuming attempt identity, a known receipt can retain its verdict but cannot enter execution or reuse totals. Receipt counts and durations cannot establish physical execution counts or compute totals.

Canonical timing observations separate queue and test-run capacity wait, environment preparation, validation, return and the measured recovery return procedure. These spans exclude unobserved phases; a recovery return interval does not establish the entire recovery invocation’s cost. Each timing category reports its observed sum and the union of its intervals. Concurrent work sums can exceed elapsed time. Categories can also overlap, so adding their elapsed times does not produce completion latency. Missing clocks and unavailable denominators remain unknown. Approval-to-land starts at the exact source authority's recorded approval and ends at its durable ref-advance observation; recovery notification cannot extend it. Emergency landings have no normal approval span. Validation feedback covers the public completion request through its returned result, including checkout wait, capacity, preparation, validation and return when observed. It is separate from the inner execution span and does not itself establish a validation verdict. Latency medians retain their sample counts and clock gaps.

A candidate's invalidation counts once; the affected-candidate list supplies context, not more independent observations. Withdrawal after an eligible prediction is separate from withdrawal without prediction evidence. A prediction denominator requires an observed strict, eligible admission against another candidate, followed by a matching normal landing or invalidation in the retained window. Pending, conflicting and emergency outcomes stay separate. Repeated admission of the same candidate cannot add predictions. Historical invalidation observations without admission remain outside the rate; a separate withdrawal event can establish that an effort was dropped before green admission. Work measured on an invalidated candidate can later be reused, so the report does not label it discarded.

Recovery outcomes join by environment and interrupted attempt. Distinct recorded executors remain separate observations; repeated delivery from one executor counts once. Repeated return notifications do not create additional failed validations. Conflicting execution coordinates leave an evidence gap. Landing and retirement outcomes have their own durable identities. A retained historical landing cannot establish the cleanup outcome of a later operation, and a retirement result does not establish storage reclamation or a leak.

Start at the [validation reader](../../../src/engine/logbook/validation_findings.ts), [completion accounting reader](../../../src/engine/logbook/completion_economics.ts), and [detector registry](../../../src/engine/logbook/detectors.ts). [Decision evidence](patterns-decision-evidence.md) describes the broader comparison and recommendation boundaries.
