---
title: Validation findings
description: "How Patterns compares per-job validation outcomes under matched and controlled recorded conditions."
order: 140
aliases:
  - same-tree-flake
  - execution-context-divergence
  - validation evidence basis
---

# Validation findings

_Patterns separates repeated per-job divergence under matched recorded conditions from differences between controlled execution contexts._

## Matched conditions

`same-tree-flake` retains its published id. It compares a job's red and green outcomes only within one complete, same-version validation state and execution envelope. The outcome-free key covers capture boundary, evidence version, mode, writer, config, setup, job identity and definition, concurrency, and the planned sibling set. Skipped, cancelled, unavailable, and incomplete outcomes cannot establish divergence; eligible exclusions remain in the denominator. Unrecorded external context remains a limitation ([ADR 0273](../_adr/0273-validation-comparisons-require-complete-keyed-semantic-evidence.md)).

## Controlled context differences

`execution-context-divergence` holds state, job definition, writer, config, setup, and evidence versions fixed. Capture boundary, mode, concurrency, and sibling context may differ; the finding lists every differing dimension. A context containing red and green outcomes belongs to `same-tree-flake` and suppresses the cross-context finding. Resource contention, ordering, and environment sensitivity remain investigation paths ([ADR 0274](../_adr/0274-validation-findings-separate-matched-and-cross-context-divergence.md)).

## Legacy boundary

Legacy history never joins current evidence. Clean events may share an explicit job label, mode, and recorded clean start at one HEAD. Dirty events may share only an explicit job label, mode, HEAD, and tracked start fingerprint. Clean and dirty bases stay separate. Neither records a job definition or complete execution conditions; dirty evidence also lacks index/worktree and untracked-input distinctions. Event-level red or green cannot replace a missing job step.

## Result contract

The optional `basis` carries comparable count and denominator, validation version and completeness, matched and differing conditions, legacy and excluded-event counts, limitations, and an `observed` or `estimated` label for every flat evidence value. Flat and structured numerical values must agree. A condition displays at most 16 values and reports its full `distinct` and `omitted` counts. Comparison keys remain complete. The contract has no confidence score.

Complete `same-tree-flake` evidence can join recurring confirmed unchanged-state Gate reruns in the additive validation-instability investigation. Legacy or incomplete validation identity cannot support that relationship. The investigation cites both source findings and retains the comparison boundary; it does not claim that reruns caused the divergence or hide either finding ([ADR 0277](../_adr/0277-patterns-investigations-preserve-source-findings.md)).

The detector registry is in [`detectors.ts`](../../../src/engine/logbook/detectors.ts); pure comparison projections are in [`validation_findings.ts`](../../../src/engine/logbook/validation_findings.ts); registry and surface guards are in [`patterns_test.ts`](../../../tests/patterns_test.ts), [`logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts), and [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts).
