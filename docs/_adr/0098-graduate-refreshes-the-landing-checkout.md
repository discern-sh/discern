# ADR 0098: Graduate refreshes the landing checkout

**Status**: accepted

## Context

`discern refresh` materializes the local artifacts that agents actually read:
generated guidance files, skills, and provider integrations. The gate catches
stale generated files, and `status` reports stale or missing artifacts, but a
worktree can still graduate a committed change to guidance or config while the
main checkout's ignored artifacts remain from the previous tree. The next agent
that starts on the trunk then sees a correct `status` warning and has to repair
what graduation could have repaired deterministically.

`integrate` already bundles its merge with a refresh because a merge can bring
in guidance or skill sources from another branch. Graduation is the opposite
transition: it hands a finished branch out to the main checkout. The same source
changes can make the receiving checkout stale.

## Decision

`discern graduate` refreshes the checkout it leaves behind after the git landing
has completed:

- `--to trunk` fast-forwards the trunk, removes the worktree, deletes the merged
  branch, then runs the refresh in the trunk checkout.
- `--to branch` removes the worktree, checks out the review branch in the main
  checkout, then runs the refresh in that review checkout.

The refresh is listed in `--dry-run` and serialized as a normal `refresh` step
in `--json`. A partial refresh does not undo the landing: the branch has already
been handed off or merged, so the result records a failed refresh step and hints
to run `discern refresh` in the main checkout.

The branch path intentionally does not refresh the trunk. The trunk has not
changed when work is left on a review branch; the future operation that lands
that reviewed branch onto the trunk must refresh the trunk at that point.

## Consequences

Agents that start on the trunk after `graduate --to trunk` inherit current local
artifacts instead of immediately seeing a stale-generated warning caused by the
graduation itself. Agents reviewing a branch after `graduate --to branch` also
get a coherent checkout.

Graduation performs one more post-landing mutation, but it remains visible in
the plan/apply result model and reuses the same refresh core as the standalone
verb. A refresh failure is loud without making the already-completed git landing
ambiguous.

`graduate --to branch` still leaves a separate trunk landing problem. That is
outside this decision because the trunk has not yet received the reviewed
branch.

## Alternatives considered

- **Leave refresh manual after graduation.** Rejected because this preserves the
  failure mode: the next agent notices the stale checkout even though the
  lifecycle verb had enough information to repair it.
- **Refresh only for `--to trunk`.** Rejected because the review-branch checkout
  can also be stale after graduation, and that is the checkout the user or next
  agent is placed in.
- **Refresh both the review branch and trunk for `--to branch`.** Rejected
  because trunk has not changed. Refreshing it would be unrelated work in a
  checkout graduate did not land onto.
- **Make refresh failure roll back graduation.** Rejected because the git
  transition has already succeeded. A partial artifact refresh is repairable;
  undoing a branch handoff or trunk fast-forward would be more surprising.
