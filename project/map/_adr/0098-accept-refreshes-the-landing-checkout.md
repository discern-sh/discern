# ADR 0098: Accept refreshes the landing checkout

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `graduate` → `accept`, `integrate` → `update`; the decision and reasoning are unchanged. **Convergence extension ([ADR 0153](0153-repository-owns-shared-checkout-convergence.md)):** Refresh is now the first post-landing checkout-convergence step. Acceptance then runs `[repository].ensure`, the configured smoke capability, and a tracked-drift check before completing worktree cleanup. **Note ([ADR 0110](0110-the-landing-model.md)):** the `--to branch` / `--to trunk` modes referenced below were removed — `accept` always lands on the trunk now. The decision itself stands: acceptance still refreshes the trunk checkout it leaves behind.

**Status**: accepted

## Context

`discern refresh` materializes the local artifacts that agents actually read: generated guidance files, skills, and provider integrations. The gate catches stale generated files, and `status` reports stale or missing artifacts, but a worktree can still accept a committed change to guidance or config while the main checkout's ignored artifacts remain from the previous tree. The next agent that starts on the trunk then sees a correct `status` warning and has to repair what acceptance could have repaired deterministically.

`update` already bundles its merge with a refresh because a merge can bring in guidance or skill sources from another branch. Acceptance is the opposite transition: it hands a finished branch out to the main checkout. The same source changes can make the receiving checkout stale.

## Decision

`discern accept` refreshes the checkout it leaves behind after the git landing has completed:

- `--to trunk` fast-forwards the trunk, removes the worktree, deletes the merged branch, then runs the refresh in the trunk checkout.
- `--to branch` removes the worktree, checks out the review branch in the main checkout, then runs the refresh in that review checkout.

The refresh is listed in `--dry-run` and serialized as a normal `refresh` step in `--json`. A partial refresh does not undo the landing: the branch has already been handed off or merged, so the result records a failed refresh step and hints to run `discern refresh` in the main checkout.

The branch path intentionally does not refresh the trunk. The trunk has not changed when work is left on a review branch; the future operation that lands that reviewed branch onto the trunk must refresh the trunk at that point.

## Consequences

Agents that start on the trunk after `accept --to trunk` inherit current local artifacts instead of immediately seeing a stale-generated warning caused by the acceptance itself. Agents reviewing a branch after `accept --to branch` also get a coherent checkout.

Acceptance performs one more post-landing mutation, but it remains visible in the plan/apply result model and reuses the same refresh core as the standalone verb. A refresh failure is loud without making the already-completed git landing ambiguous.

`accept --to branch` still leaves a separate trunk landing problem. That is outside this decision because the trunk has not yet received the reviewed branch.

## Alternatives considered

- **Leave refresh manual after acceptance.** Rejected because this preserves the failure mode: the next agent notices the stale checkout even though the lifecycle verb had enough information to repair it.
- **Refresh only for `--to trunk`.** Rejected because the review-branch checkout can also be stale after acceptance, and that is the checkout the user or next agent is placed in.
- **Refresh both the review branch and trunk for `--to branch`.** Rejected because trunk has not changed. Refreshing it would be unrelated work in a checkout accept did not land onto.
- **Make refresh failure roll back acceptance.** Rejected because the git transition has already succeeded. A partial artifact refresh is repairable; undoing a branch handoff or trunk fast-forward would be more surprising.
