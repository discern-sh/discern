# ADR 0153: `[repository]` owns shared checkout policy and convergence

**Status**: accepted; extends [ADR 0059](0059-worktree-setup-ensure.md), [ADR 0098](0098-accept-refreshes-the-landing-checkout.md), and [ADR 0110](0110-the-landing-model.md)

## Context

Git transfers the tracked tree between checkouts, but it does not transfer the local runtime state derived from that tree. A worktree can add a package and commit its manifest and lockfile, then `discern accept` can land those bytes while the main checkout still has the dependency directory built for the previous commit. The landing is valid, but the checkout handed to the reviewer is not usable.

`[worktree.setup].ensure` already closes this gap inside linked worktrees. It runs after creation, on session re-entry, and after `discern update`, so a changed lockfile can reinstall dependencies. Reusing that list on the trunk is unsafe, however. Worktree ensure commands are allowed to depend on linked-worktree identity, derived ports, or resources; a legitimate command such as one that shells to `discern identity` fails by design in the main checkout. One-shot `[worktree.setup].steps` are even less suitable because scaffolding must not replay after landing.

Acceptance also crosses an irreversible boundary. Once the trunk has fast-forwarded, a dependency install, smoke check, or local artifact refresh cannot safely roll the landing back. Conversely, aborting at that point would strand the accepted worktree and its resources halfway through cleanup. Post-landing convergence therefore needs a recorded, continue-through-failure contract rather than transaction semantics.

The config taxonomy exposed the same missing boundary. `[project]` mixed authored project identity and paths with Git-repository policy (`main_branch` and `branch_prefix`). Adding a checkout-wide convergence list there would deepen the ambiguity; placing it under `[worktree]` would falsely imply that it never runs in the main checkout.

## Decision

Introduce a top-level `[repository]` section for policy shared by every checkout of one Git repository:

- `[repository].trunk` is the shared landing branch. It replaces `[project].main_branch`; the containing section now supplies the repository context, so the key can use the role name directly.
- `[repository].branch_prefix` names branches discern creates for linked worktrees. It moves from `[project].branch_prefix`.
- `[repository].ensure` is an ordered list of idempotent commands that can run in any checkout. It runs on fresh worktree setup, worktree re-entry, and `discern update`, before the worktree-only ensure bucket. After acceptance fast-forwards the trunk, it also runs in the main checkout.

`[worktree.setup]` keeps its narrower contract. `steps` remains one-shot scaffolding and never runs on the trunk. `ensure` remains repeatable linked-worktree convergence and may depend on `discern identity`, ports, resources, or other facts unavailable in the main checkout. Migration does not copy existing worktree ensure commands into the repository list because arbitrary shell commands do not reveal which side of that boundary they belong on.

Acceptance converges the receiving checkout in this order after the validated fast-forward and before cleanup:

1. Refresh generated agent files and materialized skills.
2. Run every `[repository].ensure` command in order. A command failure is recorded and later commands still run.
3. Run the existing configured `smoke` capability through the normal job runner, retaining its timeout, result steps, output artifacts, and diagnostics.
4. Report tracked checkout drift introduced by convergence when it can be attributed honestly.
5. Tear down resources, remove the worktree, and delete the merged branch.

Every post-landing operation is non-fatal to the landing and cleanup tail. Failures remain visible as failed result steps, diagnostics, and recovery hints; they cannot undo the trunk fast-forward or skip later convergence commands. There is no second `preflight` concept: the already-declared `smoke` capability is the project's canonical cheap proof that a checkout is usable.

Schema 20→21 migrates the config shape. It preserves custom branch values, moves the two old keys into a documented `[repository]` block, renames `main_branch` to `trunk`, adds an empty `ensure` list, rejects conflicting pre-adopted values, and proves the rewritten TOML before writing it. Fresh and migrated installs therefore share the same schema without pretending discern can classify project-supplied commands.

## Consequences

An accepted dependency change can leave the trunk checkout ready for immediate review, provided the project declares its dependency installation under `[repository].ensure`. The same command also keeps every managed worktree current, so one declaration covers both sides of the landing boundary.

Projects with checkout-generic commands currently under `[worktree.setup].ensure` must move those commands deliberately. This is config churn, but it protects identity-dependent commands from being invoked in the wrong checkout. The change is accepted before a public compatibility promise; the migration handles the mechanical key moves and leaves the semantic command choice visible to the owner.

Acceptance does more work after the trunk moves. The cost is controlled by project authors: repository ensure commands should be fast when already converged, and `smoke` should remain the cheap capability check its name promises. A failed post-landing pass yields an accepted but locally unhealthy checkout rather than a half-cleaned landing; that state is repairable in place and reported explicitly.

Repository ensure and smoke commands can modify tracked files. discern reports attributable drift but does not commit, discard, or roll it back. Projects should keep convergence idempotent and avoid tracked output unless that output is intentionally reviewed.

The `[repository]` section becomes the coherent home for the trunk, discern-created branch naming, and checkout-shared convergence. `[project]` is left with project identity and authored project paths; `[worktree]` is left with linked-worktree-only state.

## Alternatives considered

- **Run `[worktree.setup].ensure` after acceptance.** Rejected because valid commands may depend on worktree-only identity or resources and must fail in the main checkout.
- **Place the new list under `[checkout]`, `[trunk]`, or `[project]`.** `[checkout]` makes repository branch policy feel misplaced, `[trunk]` cannot describe behavior shared with worktrees, and `[project]` preserves the existing mixture of authored-project and Git-repository concerns. `[repository]` names the common owner of all three settings.
- **Detect a package manager and install dependencies automatically.** Rejected because discern is stack-neutral, projects may use custom install flags or non-package-manager convergence, and executing an inferred command would be less transparent than a declared list.
- **Add a separate post-landing `preflight` command.** Rejected because `smoke` already expresses the cheap capability proof and already has job-runner semantics. A second nearly identical concept would make projects choose between overlapping declarations.
- **Abort or roll back acceptance on convergence failure.** Rejected because the validated trunk fast-forward has already completed and rollback could race another landing. Continuing cleanup while recording the unhealthy checkout is the only unambiguous state transition.
