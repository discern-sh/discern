# ADR 0274: Validation findings separate matched and cross-context divergence

**Status**: accepted. Builds on the evidence boundary in [ADR 0273](0273-validation-comparisons-require-complete-keyed-semantic-evidence.md).

## Context

The published `same-tree-flake` detector reduced each validation event to one suite verdict. It could hide two jobs that changed in opposite directions, compare different legacy jobs through an event-level red and green, and describe a legacy tracked-diff fingerprint as exact tree identity. It also treated standalone `discern test` and the full concurrent Gate as either identical or wholly incomparable. Those modes can expose a useful relationship, but a result difference between them is not the same observation as a repeated difference under one execution envelope.

The detector id is a machine-visible compatibility surface. Replacing it would break saved consumers; publishing old and new ids for the same relationship would duplicate findings. Cross-context evidence carries another duplication risk: if one context is already red and green, the strict relationship explains that population before any between-context comparison can.

Findings also need a common machine contract for later workflow and decision readers. Flat numerical `evidence` is already published, so replacing it would spend compatibility without adding evidence.

## Decision

Validation comparison is per recorded test job. A pure projection covers every controlled field in the complete version-1 evidence envelope: capture boundary, evidence versions, execution mode, writer, config, setup, target-job identity and definition, concurrency, and the complete outcome-free planned sibling set. A schema-derived field inventory and registry guard require each future evidence field to declare whether it is identity, a controlled condition, an observation, eligibility, measurement, or limitation. Job outcomes are observations and cannot enter a comparison signature.

`same-tree-flake` remains the sole compatibility id for the strict relationship. It reports a job only when red and green outcomes share one complete validation state and the full controlled-condition projection. No replacement alias is published.

`execution-context-divergence` is a separate relationship. It holds state, job definition, writer, config, setup, and evidence versions fixed. Only capture boundary, execution mode, concurrency, and planned sibling context may differ, and the finding lists every dimension that did. Any other difference forms another population. A context containing both red and green suppresses this relationship: the retained strict detector owns that evidence, avoiding duplicate findings and preventing one internally divergent context from masquerading as a between-context result.

Legacy evidence never joins versioned evidence. Clean legacy events may compare only an explicit job label, execution mode, and recorded clean start at one HEAD. Dirty legacy events may compare only an explicit job label, mode, HEAD, and tracked start fingerprint. The two bases remain separate. Both disclose that job definitions and complete execution conditions were not recorded; dirty evidence also discloses index/worktree and untracked-input ambiguity.

The finding wire shape gains an optional `basis`. It carries comparable count and denominator, validation version and completeness, matched and differing conditions, legacy and excluded-event counts, material limitations, and whether each numerical value is observed or estimated. Flat `evidence` remains and must agree with `basis.values`. One shared projection sorts each condition's complete keyed readings, retains at most 16 labels, and records the full `distinct` count and the number `omitted`. Comparison signatures keep the complete unbounded keyed set. No confidence score is added.

For the retained detector, `considered` counts eligible per-job observations in a full comparison group that appears at least twice. For the cross-context detector, it counts eligible per-job observations whose fixed identity recurs in at least two controlled contexts that produced a verdict. Each finding denominator is the observations inside its own group; skipped, cancelled, and unavailable outcomes stay excluded from red and green while remaining visible in that denominator when their context otherwise qualifies.

## Consequences

- Opposite job-level changes can no longer disappear behind two event-level red verdicts, and different jobs can no longer create one legacy divergence.
- Standalone and full-Gate results remain comparable only through the separate controlled-context relationship. Differing modes, concurrency, and siblings are visible rather than silently blended.
- Saved consumers keep the `same-tree-flake` id and flat counts. New consumers can evaluate the basis, coverage, limitations, and observed-versus-estimated distinction.
- Condition evidence stays bounded while its `distinct` and `omitted` counts disclose the complete recorded cardinality.
- The historical id is broader and less precise than its corrected meaning. Current titles and evidence carry the truthful relationship; a duplicate rename is rejected as a worse compatibility outcome.
- Mixed contexts produce the strict finding only. This trades a possible second correlated signal for one non-duplicated, supportable claim.
- Legacy findings remain useful, but their language is necessarily weaker than complete current evidence.

## Alternatives considered

- **Rename `same-tree-flake` and retire the old id.** Rejected because it breaks machine consumers before launch without changing the strict relationship's evidence.
- **Emit both old and new ids during a transition.** Rejected because one event population would yield duplicate findings and distort detector counts and ranking.
- **Keep one detector for strict and cross-context changes.** Rejected because equal envelopes and deliberately different execution contexts support different claims and investigations.
- **Emit cross-context findings when one context is internally mixed.** Rejected because the between-context relationship would not explain the verdict difference and would duplicate the strict finding.
- **Replace flat evidence with the structured contract.** Rejected because additive provenance preserves compatibility and lets every later reader migrate independently.
- **Assign a confidence score.** Rejected because coverage, exclusions, and limitations are inspectable facts, while one score would hide the evidence boundary behind an unexplained judgment.
