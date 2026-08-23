# ADR 0314: Automatic worktree cleanup requires recorded ownership and verified absence

**Status**: accepted. Strengthens fleet identity in [ADR 0052](0052-worktree-sibling-placement.md), setup worktree proof in [ADR 0090](0090-setup-proves-worktree-viability.md), contained-reclaim ownership in [ADR 0225](0225-contained-worktree-reclaim-is-offer-only.md), and the retired-path boundary in [ADR 0265](0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md).

## Context

Git merge status answers whether deleting a branch is likely to lose commits. It does not answer who created the branch or whether discern may delete it. A naming prefix has the same limitation: a person or another tool can create a branch with a similar or even identical name. A configured worktree parent records placement, not ownership of every child beneath it.

Git worktree removal has a separate truth problem. A command can return success while Git still registers the checkout, and a background hook or shell descendant can keep writing after its direct parent exits. A writer can recreate an otherwise empty directory while retirement evidence is being recorded. Treating those states as successful teardown lets a setup probe or lifecycle report completion while the retired path still exists.

discern already has useful positive evidence. A worktree it readied carries `discern/worktree-ready` in that worktree's exact Git administrative entry. The Git-admin key supplies a stable id independent of checkout-local environment overrides. A creation call also knows the id and branch it minted, while the dedicated setup branch belongs to a separate, exact lifecycle. These facts can authorize narrow cleanup without treating every merged ref or every child of the worktree root as owned.

## Decision

**Automatic destructive planning requires positive lifecycle evidence, and successful worktree removal means both the filesystem path and Git registration are absent at the return boundary.**

The canonical branch-ownership predicate accepts only an exact configured branch derived from a canonical worktree id, or the exact dedicated setup branch inside setup's own lifecycle. Its evidence comes from one of these contexts:

- the current call created the worktree and branch;
- an explicit lifecycle selected or accepted the exact registered worktree;
- an automatic fleet scan found a plain `discern/worktree-ready` marker in the exact Git-admin entry and the branch equals `<configured-prefix><git-admin-id>`; or
- setup is retiring its dedicated branch.

Checkout-local environment values can customize runtime identity and resource handles. They never assert destructive ownership. A merged branch with no live Git-admin evidence stays observational. A ready marker without the exact branch/id relationship also stays outside the plan. A branch that merely begins with the configured prefix, a similarly named branch, or a path under the configured worktree parent is kept. Running `discern worktree setup` on a manually created checkout deliberately enrolls that checkout once the exact identity relationship also holds.

Merge, cleanliness, lock state, containment, and idleness remain additional safety predicates. They cannot create ownership. Contained reclaim keeps its branch and requires the same positive fleet evidence when it is part of automatic prune. An explicit `worktree drop` may remove the exact checkout a person selected, but it retains a branch that does not satisfy the canonical ownership predicate.

Every discern-owned branch deletion goes through one compare-and-swap primitive. It rechecks ownership, the expected commit, current worktree use, and merge ancestry when the lifecycle requires landing. A moved, checked-out, unowned, or unreadable ref is retained. Generic prune never offers the dedicated setup branch.

The shared worktree-removal primitive validates the resolved target before any recursive deletion. It refuses a filesystem root, the home directory, a target containing the main checkout or common Git directory, a symlink target, an unreadable target, or a filesystem object that replaced the one originally identified. It removes only a registered worktree or an exact Git-linked orphan of the same repository. If Git leaves stale registration behind after the path is absent, bounded recovery removes only the matching administrative entry rather than running repository-wide `git worktree prune`.

All command runners used by the worktree lifecycle own isolated process groups. After the direct shell or Git process settles, discern gives remaining descendants one bounded termination grace and then stops that exact group before returning. Background services that must outlive one command belong in the resource lifecycle; a command that deliberately escapes into another session is not a supported setup effect.

Removal records retirement evidence, then performs a final strict `lstat` and Git registry observation. Only `NotFound` proves filesystem absence; permission and input/output errors remain unknown. Any remaining file, symlink, directory, or registration makes the lifecycle fail. Branch deletion follows that proof, so an incomplete teardown retains the ref. The failure names the exact path, observed Git/ref state, and an idempotent retry. The structural setup probe consumes this result and cannot report successful setup while its checkout, registration, owned branch, or resource lifecycle remains incomplete.

## Consequences

- A foreign merged branch such as `main-pre-discern` remains untouched. A matching prefix without a ready Git-admin identity also remains untouched.
- Older, manually created, or incompletely readied worktrees can remain outside automatic prune even when they are clean and merged. A person can inspect them, run setup to enroll them, accept them through their explicit lifecycle, or select them with `worktree drop`.
- The ready marker is positive evidence, not a completeness assumption. Its best-effort absence loses automatic-cleanup eligibility rather than widening deletion.
- A successful setup probe or ordinary removal has one testable postcondition: no filesystem entry and no Git worktree registration remain. A late writer turns the result red instead of becoming a warning after restart.
- Ordinary background children and Git-hook descendants cannot outlive the command that spawned them. Projects that need persistent local services use declared resources with explicit create, ensure, and destroy commands.
- Exact stale-admin recovery and repeated lifecycle runs converge without exposing unrelated registrations or neighboring directories to broad deletion.
- Automatic scans pay for one narrow marker observation per candidate and repeat ownership at apply time. That cost buys dry-run/apply parity and closes the confirmation-window race.

## Alternatives considered

- **Treat every fully merged branch as disposable.** Rejected because reachability is a loss check, not authority.
- **Treat the configured prefix or worktree parent as ownership.** Rejected because both are naming and placement conventions another tool can reproduce.
- **Use checkout-local identity overrides as proof.** Rejected because content inside the candidate could authorize its own deletion.
- **Require only the branch/admin-id naming relationship.** Rejected because raw Git can construct the same shape without discern ever readying the checkout.
- **Run broad `git worktree prune` after removal.** Rejected because it can retire unrelated stale registrations outside the exact lifecycle target.
- **Retry filesystem removal indefinitely or sleep after teardown.** Rejected because timing is not a postcondition and an active writer can make the wait unbounded. Command-owned writers are quiesced; bounded recovery then verifies absence.
- **Keep optimistic success and rely on later reappearance status.** Rejected because retired-path evidence is recovery for later external writes, not permission to report a false success at the lifecycle boundary.
