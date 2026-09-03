# ADR 0271: Destructive drops retain bounded recovery refs

> **Amendment ([ADR 0366](0366-landing-is-one-exact-repository-transaction.md)).** A forced drop also preserves an unlanded detached HEAD. Recovery protects the committed object at risk, not only a branch that will be deleted.

**Status**: accepted. Extends the destructive worktree boundary in [ADR 0027](0027-plan-apply-engine-execution.md), the Git-admin lifetime registry in [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md), and the local Git-ref ownership established by [ADR 0215](0215-landing-receipts-travel-as-git-notes.md).

## Context

`discern worktree drop` can delete a branch whose commits are not on the trunk when a person passes `--force`. It can also remove a clean merged branch that later turns out to have been the wrong target. Deleting the branch removes its branch reflog. The commit objects may remain temporarily, and another reflog may mention them, but recovery then depends on Git configuration, expiry, and object pruning.

Reflog health remains valuable for mistakes outside discern and for work older than any bounded product safety net. It is not a durable ownership boundary for a destructive command that discern itself performs. A recovery mechanism should keep a committed tip reachable before deletion, work with both files-based refs and `reftable` repositories, remain local by default, stay bounded, and never make dry-run effectful.

The mechanism cannot preserve staged, working-tree, ignored, or untracked bytes without turning drop into a backup system. Those bytes have no committed object to name, and `--force` must continue to state the permanent-loss boundary honestly.

## Decision

Before `worktree drop` performs any resource, filesystem, worktree-registration, or branch mutation, it creates an ordinary Git ref under `refs/discern/recovery/` pointing at the branch's current committed tip. The ref name carries a UTC timestamp, a bounded worktree slug, and a random suffix. The applied result and human output carry the exact ref.

The repository retains the newest 32 refs. A common-scope advisory lock serializes competing drops across linked worktrees. Under that lock, one `git update-ref --stdin` transaction verifies the branch still names the observed commit, creates the new ref, and deletes refs beyond the cap. Git owns the storage representation; discern never writes beneath `.git/refs`, so the operation remains compatible with `reftable`.

Preservation fails closed. If the branch tip cannot be resolved, the lock cannot be acquired, existing refs cannot be listed, or the ref transaction fails, drop stops before any destructive effect and names the Git error. A later failure in resource or worktree removal may leave an additional recovery ref, which is harmless and remains subject to the same cap.

The preservation step runs for every drop that will delete an attached non-trunk branch, not only a forced or not-yet-merged one. It also runs for a detached worktree whose HEAD is not reachable from the trunk and would be discarded by a forced drop. This protects the committed object at risk independently of whether a branch names it. After worktree removal, attached branch deletion uses another compare-and-swap against the preserved commit. If another process moved the branch in between, deletion refuses and the newer branch remains. Dry-run reports the intended step without creating a ref. A worktree holding the trunk keeps its branch. Acceptance creates no recovery ref because its reviewed commit becomes reachable from the trunk before cleanup.

Recovery refs are clone-local and receive no automatic fetch or push configuration. `discern uninstall` leaves them in place: once a branch is gone, a recovery ref may be the only remaining name for user-authored commits. The owner may inspect and delete refs explicitly after deciding the recovery window is no longer needed.

`discern doctor` continues to inspect reflog and pruning policy across every registered checkout. It warns when reflog recording is disabled, HEAD lacks a reflog, or an explicit expiry falls below the documented recovery floor. The bounded refs supplement that broader Git recovery health; they do not replace it.

## Consequences

- A mistaken drop has a printed, direct `git switch -c` route back to the branch's last committed snapshot.
- A retained ref keeps its commit graph reachable independently of reflog expiry and unreachable-object pruning. Eviction returns that graph to Git's ordinary reachability and retention rules.
- One repository keeps at most 32 drop refs plus one content-free common advisory-lock file.
- A forced drop can still destroy every uncommitted byte permanently. The refusal and documentation continue to say so.
- An unlanded detached commit receives the same bounded reachability guarantee as an attached branch tip.
- Recovery history stays on the machine unless a person deliberately configures ref transport.
- The namespace is discern-owned, while the commits it names remain user-authored work. Uninstall therefore preserves the refs rather than converting tool removal into a second destructive action.

## Alternatives considered

- **Rely on reflog history.** Rejected because deleting a branch removes its reflog and the remaining evidence is configuration- and time-dependent.
- **Keep every dropped branch or tag.** Rejected because ordinary branch and tag names imply active project history and would grow without a bound.
- **Retain only forced or not-yet-merged drops.** Rejected because classification and deletion are separate moments, and a clean merged branch can still be the wrong target.
- **Expire refs by age.** Rejected because count gives a deterministic storage bound without a background process or clock-driven mutation. The ref names still make age visible to the owner.
- **Write patches, bundles, or copies of the worktree.** Rejected because they duplicate object data, need separate integrity and cleanup rules, and still cannot define a safe automatic policy for uncommitted secrets or ignored files.
- **Push recovery refs to a remote.** Rejected because recovery is local safety state and automatic transport could publish commits the owner deliberately kept off every remote.
