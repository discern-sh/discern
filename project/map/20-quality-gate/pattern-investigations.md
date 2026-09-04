---
title: Pattern investigations
description: Trace related Pattern findings into bounded, evidence-backed diagnostic paths.
order: 160
aliases:
  - finding synthesis
  - investigation paths
  - validation instability
  - Standard variance
---

# Pattern investigations

_An investigation connects already-visible findings that clear one registered evidence rule. It proposes what to diagnose next without claiming a cause or changing the project._

## Result contract

`data.investigations` is always present beside `data.findings`. Each entry has a stable id, source finding ids, each source observation and denominator, shared setup and evidence limitations, one bounded interpretation, one preferred diagnostic action, and a falsifier. Numerical values retain their `observed` or `estimated` labels. An investigation has no strength, score, rank, or automatic setup change.

The terminal report presents investigation paths before the unchanged raw finding blocks. JSON and Model Context Protocol (MCP) return the same structured entries. Active and sealed logbook sources use the same arithmetic. Inline command surfaces continue to show their routed raw findings.

## Registered relationships

One registry owns relationship order, finding requirements, evidence version and completeness, setup comparability, minimums, suppressors, cohort policy, and the pure producer. The first members are:

- complete same-state verdict divergence plus recurring confirmed unchanged-state Gate reruns: validation instability;
- repeated full-Gate failures plus record-proven preflight-preventable work on the same branch and setup: feedback loop;
- later distinct failures plus long-running or queued validation under one setup: a validation-scheduling experiment; and
- current mechanical pin eligibility plus recent comparable reversals or failures: Standard variance, with no pin advice.

Missing, mixed, legacy, incomplete, or conflicting evidence suppresses the relationship that needs it. Source findings remain visible. Identity-dependent validation synthesis requires complete current validation evidence. Cohort findings do not create or alter pooled investigations. Registry order and subject order make the result deterministic ([ADR 0277](../_adr/0277-patterns-investigations-preserve-source-findings.md)).

The authority and pure projection are in [`investigations.ts`](../../../src/engine/logbook/investigations.ts). [`investigations_test.ts`](../../../tests/investigations_test.ts) enrolls every registry member in the valid, near-miss, conflict, setup, evidence-provenance, cohort, deduplication, and order matrix.
