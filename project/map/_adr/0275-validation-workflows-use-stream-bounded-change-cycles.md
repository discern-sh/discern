# ADR 0275: Validation workflows use stream-bounded change cycles

**Status**: accepted. Builds on the complete evidence boundary in [ADR 0273](0273-validation-comparisons-require-complete-keyed-semantic-evidence.md) and the relationship model in [ADR 0274](0274-validation-findings-separate-matched-and-cross-context-divergence.md).

## Context

Practice Stats can count individual `prepare`, `test`, and `done` invocations directly, but route questions need a larger unit. In particular, dirty validation commonly runs before a commit while the final clean `done` runs on the new committed HEAD. Treating every HEAD change as a boundary would split one ordinary route in half. Consulting the live Git graph would make the same archived Logbook produce a different answer after refs or objects disappear.

The stream does not record an explicit change id. Branch names can be reused, configs change, old events can lack epochs or clean state, and one green Gate may be followed by another validation run on the same HEAD. Any cycle model therefore has to state where evidence is strong enough to link events and where it stops.

Prepare advice has a related evidence problem. Absence of a `prepare` event proves only that the command was not recorded. It does not prove that preflight work existed, that `done` was the wrong entry point, or that a dirty full Gate was wasteful.

## Decision

Validation workflow Stats construct change cycles from the recorded event stream only. A cycle contains analyzed `prepare`, `test`, and `done` events on one branch and one non-null config epoch.

A successful `start` targeting a reused branch, a successful `accept` on the branch, or a config-epoch change closes the active cycle. An event with no epoch forms a standalone cycle. After a clean green `done`, a later dirty validation entry or a later validation run on a different recorded HEAD starts another cycle.

A HEAD transition before that clean green Gate does not itself close the cycle. Dirty validation on the old HEAD and clean `done` on a later committed HEAD remain linked. The narrower pre-commit-to-clean-Gate subset requires the dirty earlier run and clean green `done` to carry distinct non-null HEADs. No reader consults live ancestry.

The first run's recorded entry state assigns the route: dirty is test-first, clean is commit-first, and null is unattributed. A later known state does not backfill an unknown first state. Every event after the first in one cycle is a retry run. Route output carries cycle, branch, run, success, failure, and retry counts. These are descriptions, not preferred sequences.

Current validation evidence is complete only at the comparison boundary defined by ADR 0273. Current records below that boundary are incomplete. Older `done` and `test` events with a known entry state are legacy; `prepare` has no versioned validation capture, and any remaining run is unattributed. At the standalone-test capture boundary, complete dirty state may be counted as tracked-only, untracked-only, mixed, or unclassified using aggregate validation counts and the existing tracked-diff fingerprint. Full-Gate dirty entries remain unclassified because their evidence is captured after mutating pre-groups. Paths never enter the Stats payload.

Identity splits pass through the existing cohort seam and `COHORT_MINIMUMS`. The split appears only when at least 2 cohorts qualify, includes cycle and run denominators, and retains below-minimum and unattributed remainders. It does not rank identities or infer capability.

The existing `skipped-prepare` id changes from absence-based advice to a record-derived predicate. It considers only clean failed `done` events with a recorded HEAD and epoch where the Gate itself establishes stale declared regeneration or fix-stage tree drift before later work. A branch/config finding requires the predicate on at least 2 distinct clean HEADs. Generic build, check, and test failures; dirty Gate feedback; successful Gate entry; and repeated runs on one HEAD do not establish the finding.

## Consequences

- Dirty pre-commit validation followed by a clean committed Gate appears as one valid test-first route.
- Commit-first entry and done-first entry remain supported and visible without becoming recommendations.
- Active and archived reports use the same self-contained evidence and cycle boundaries.
- Missing or incomplete evidence remains in explicit denominators instead of being inferred.
- A branch reuse or configuration boundary can conservatively split work that a human might recognize as related. The reader prefers a smaller supportable claim over joining events across an unrecorded relationship.
- Retry counts include any additional validation run inside the recorded cycle. Outcome divergence on an unchanged state remains the validation findings' responsibility.
- Prepare advice can stay silent despite an inefficient-looking sequence when the Logbook does not establish work the command would have prevented.

## Alternatives considered

- **Split at every HEAD transition.** Rejected because it separates dirty pre-commit validation from the clean Gate that validates its commit.
- **Resolve Git ancestry while reading.** Rejected because archived reports may lack those objects and historical output would depend on current repository state.
- **Infer a cycle from timing gaps.** Rejected because elapsed time is not evidence that two invocations belong to one change.
- **Treat every green Gate as an immediate boundary.** Rejected because a same-HEAD rerun belongs to the same recorded state; the next dirty entry or different HEAD supplies the later-change signal.
- **Recommend prepare whenever no prepare event precedes repeated Gate runs.** Rejected because missing invocation evidence says nothing about preventable work, and would misclassify supported done-first and dirty-feedback workflows.
