# ADR 0433: Post-landing reports name policy changes

**Status**: accepted.

## Context

A hosted report compares standards policy with the commit before the push. The owner approves a loosened limit, a redefinition, or a deletion on the local trunk. None of that approval reaches the hosted checkout. The report therefore failed on every approved change before any lane measured the pushed commit, and a release tagged there stayed blocked. On a pull request the same failure is useful, because it stops the merge.

## Decision

A standalone CI report keeps failing on those changes by default. `--policy-changes report` runs the same comparison. It names each loosened limit, changed definition, and deleted standard in the result, then measures the checked-out configuration. The mode requires a clean tree. A base that cannot be read or compared still fails. The base still governs changed scopes and checkpoint subjects. Strict completion and acceptance never take the option. The [CI guide](../20-quality-gate/ci.md#standards-policy-after-landing) describes the mode.

## Consequences

A green post-landing report establishes that the measured values meet the pushed policy on that runner. Its log names what moved. It does not establish that anyone approved the move, because whoever can push to trunk sets the policy. A change pushed outside discern appears as a named line in a passing report. Projects that want CI to reject such a change keep the default. A strict pull request has no approval path, so a maintainer overrides the check or makes the change on trunk. Verifying owner decisions in CI would require each project to manage trusted signers and publish approval evidence.
