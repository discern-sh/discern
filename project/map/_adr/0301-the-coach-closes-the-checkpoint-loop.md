# ADR 0301: The improvement coach closes the checkpoint loop

**Status**: accepted; builds on the shared criterion vocabulary in [ADR 0295](0295-one-criterion-vocabulary-serves-two-memberships.md), the observation charter in [ADR 0300](0300-checkpoint-observation-is-drained-metadata-never-a-verdict.md), the advisory boundary in [ADR 0160](0160-local-logbook-advisory-readers.md), and the recommendation evidence bar in [ADR 0276](0276-patterns-recommendations-require-project-local-decision-evidence.md).

## Context

Checkpoints guard the flow: a trigger serves a criterion as a matching change completes. `improvement` audits the stock: the estate of what already exists. After the vocabulary extraction the two shared prose but not a loop — the estate audit did not know which criteria the boundary guards, nothing recommended promoting a recurring finding into a checkpoint, and the conversion rule ("a criterion becomes a checkpoint exactly when diffs introduce its violations") lived only in decision records, where no test could hold it.

## Decision

**The conversion rule is structural vocabulary, and the coach renders the loop from the same sources the gate uses.**

- Every canonical criterion declares how its violations arise: `diff-introduced` or `accrued` (`src/shared/criteria.ts`). The registry guard forbids an accrued criterion in the checkpoint membership, and a graduation route to one refuses construction — the stock-versus-flow line is machine-checked, not lore.
- A configured checkpoint serving a canonical criterion **verbatim** (a built-in reference without a criterion override) marks that catalog review boundary-guarded. An overridden criterion is an authored one: the mark would claim protection the boundary does not give, so it never appears.
- Every other configured checkpoint renders as an estate review row in the `checkpoints` category. Both surfaces project id, criterion, teach, and trigger summary from `resolveCheckpoints` — parity with `discern checkpoints` is by construction, and the resolver takes an injectable seed set so tests prove enrolment before the shipped built-ins land.
- Recommendations are evidence-backed owner decisions (`data.recommendations`): a frequently-varied checkpoint (the economics reader's shared bar — the same predicate the hygiene detector runs) earns a review of its trigger, criterion, or mode; a recurring finding class routed through `GRADUATION_ROUTES` earns a capture-as-checkpoint decision, suppressed once the criterion is guarded. No qualifying evidence, no recommendation. Variance prose preserves the declared-unmet conclusion.
- With the objective baseline clear, the first recommendation leads `next_action` as the `decide` kind. This deliberately narrows the old "findings never touch `next_action`" contract: a finding may now back the led decision, while score, `ok`, `--min-score`, reviews, and rule verdicts still never read the logbook, and no reader gates a verb.
- The `checkpoints.opportunity` review is the placement ladder's teaching home; the ladder itself is shared vocabulary with one prose projection, and the same teach points a mechanically decidable criterion at the set-the-standard outlaw procedure.

## Consequences

- An owner running `improvement` sees which criteria have flow protection, which are audit-only, what evidence would justify promoting one, and which checkpoints repeatedly land under variance.
- A built-in checkpoint added to the registry enrols in the estate audit, the marking, and the parity guards with no further wiring; an accrued pairing fails the gate.
- The graduation registry ships empty: no current detector evidences a diff-introduced class honestly, and a forced mapping would breach the evidence bar. The machinery is proven with synthetic routes.
- One more surface reads the full logbook stream (variance evidence in `buildContext`), accepted because a bounded tail would censor the rare, cross-effort events the bar needs.

## Alternatives considered

- **Classify criteria in the memberships instead of the vocabulary.** Rejected: how violations arise is a fact about the criterion, and the precondition for a membership decision — recording it on the member would let two memberships disagree.
- **Mark reviews guarded whenever a shipped seed exists for the criterion.** Rejected: a seed no entry enables protects nothing; the mark must mean this project's boundary.
- **Fire the review recommendation from the hygiene detector's routed findings.** Rejected: the detector is batch-tier by design; rerouting it would widen every inline surface. Sharing the predicate keeps one bar with two presentations.
- **Let a graduation recommendation name an unshipped built-in id.** Rejected: the coach would be recommending content that does not exist; routes bind to canonical criteria instead.
