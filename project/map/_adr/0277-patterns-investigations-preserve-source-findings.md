# ADR 0277: Patterns investigations preserve source findings

> **Launch-evidence amendment (2026-09-03):** validation-less historical Logbook lines remain readable but cannot mint a validation finding or investigation. The pre-v1 `legacy` counts and suppressors were retired; incomplete current evidence still suppresses synthesis.

**Status**: accepted. Builds on the advisory reader boundary in [ADR 0160](0160-local-logbook-advisory-readers.md), setup equality in [ADR 0224](0224-trend-comparability-is-setup-equality.md), validation evidence in [ADR 0274](0274-validation-findings-separate-matched-and-cross-context-divergence.md), and decision evidence in [ADR 0276](0276-patterns-recommendations-require-project-local-decision-evidence.md).

## Context

Several Patterns findings can describe adjacent parts of one workflow problem. Showing each only as an independent recommendation can send an owner toward several local remedies. Combining them carelessly would create a worse problem: correlation could become a causal story, complete validation evidence could mix with legacy or incomplete state, and one summary could conceal the observations and denominators that support it.

Cross-finding relationships will grow. If every relationship implements evidence completeness, setup comparison, suppression, ordering, and surface behavior independently, a new member can silently weaken those boundaries. A separate score or configuration effect would also exceed Patterns' local, advisory purpose.

## Decision

Patterns adds `data.investigations` beside `data.findings`. It never removes, rewrites, or replaces a source finding. Each investigation has a stable id, source finding ids, the source observations and denominators, their shared evidence boundary, one bounded interpretation, one preferred diagnostic action, and a falsifier. Numerical values retain their `observed` or `estimated` provenance. Investigations have no strength, confidence, score, grade, causal claim, or configuration effect.

One ordered relationship registry owns membership. Each entry declares required finding kinds and minimums, validation version and completeness, setup-comparability rule, suppressors, cohort policy, and its pure producer. Registry-driven tests require a valid fixture and shared invariants for every member. Synthesis follows registry then subject order, deduplicates stable ids, and stays bounded.

The first relationships are validation instability, feedback loop, a validation-scheduling experiment, and Standard variance. Identity-dependent validation instability requires complete current validation state. The other relationships require the recorded setup boundary their claim needs. Mixed setups, conflicting decision evidence, incomplete state, and unjustified legacy evidence suppress synthesis while leaving every raw finding visible. Cohort findings cannot mint or alter pooled investigations.

Terminal, JSON, Model Context Protocol, and selected sealed archives consume the same result projection. Inline command surfaces continue to show their routed raw findings; synthesis adds no new Logbook fields or collection.

## Consequences

- Owners receive one traceable investigation path when several findings support it, while retaining every raw count and next step.
- Missing or conflicting evidence produces no relationship rather than a weaker implied conclusion.
- Validation identity, setup conditions, exclusions, legacy counts, and estimate labels survive synthesis.
- A new relationship enrolls through one registry and its shared guard instead of adding surface-specific lists.
- The initial rules are deliberately conservative. Some related evidence remains as individual findings until the Logbook can support the declared comparison.

## Alternatives considered

- **Replace related findings with one summary.** Rejected because it hides denominators and makes the synthesis impossible to audit.
- **Add a practice-health score or confidence rank.** Rejected because heterogeneous local evidence has no common scale and Patterns is advisory.
- **Let each detector emit cross-finding advice.** Rejected because relationship membership and evidence boundaries would be duplicated across detectors.
- **Infer through missing setup or validation identity.** Rejected because mixed eras and incomplete state cannot support a stable comparison.
- **Change Gate or Standard configuration automatically.** Rejected because an investigation is a diagnostic proposal, not authority to mutate the project.
