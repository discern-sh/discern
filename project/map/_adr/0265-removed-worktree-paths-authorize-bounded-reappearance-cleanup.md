# ADR 0265: Removed worktree paths authorize bounded reappearance cleanup

> **Teardown-boundary amendment ([ADR 0315](0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md)):** command-owned descendants now quiesce before removal, and successful removal is decided only after retirement evidence is written and a final strict filesystem and Git-registry observation proves absence. Later external writes still use the bounded reappearance recovery defined here.

**Status**: accepted. Extends the common-state registry in [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md), the plan/apply boundary in [ADR 0027](0027-plan-apply-engine-execution.md), and status observation in [ADR 0033](0033-status-verb-and-location-aware-scope.md). Records a bounded exception to placement consent in [ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md).

## Context

Worktree acceptance, drop, and prune remove a Git checkout and its registration. An external program can retain an open project after that removal. A later UI action, shutdown, or background save can recreate the old directory with local state. Git no longer knows the path, and discern's orphan scan requires a `.git` link, so the new files remain invisible to both systems.

Scanning every directory under a configured worktree root would find the files but could also classify unrelated user directories as disposable. A background watcher would add a resident process to a tool designed to run and exit. Warning during every acceptance would precede a condition that usually never occurs, and it would still miss the later write. The cleanup needs durable provenance, an observable condition, and a confirmation boundary.

The path lies outside discern's ordinary authored surfaces after the worktree is gone. Removing later content therefore bends placement consent. The prior Git registration proves discern owned the checkout, while a record of completed removal ties the cleanup offer to the same absolute path. That evidence can support an offer. A person must still confirm the destructive prune.

## Decision

Every successful call to the shared worktree-removal primitive verifies that the checkout path is absent, then records the canonical absolute path and removal time under `<git-common-dir>/discern/retired-worktree-paths/`. The evidence write is advisory and fail-open because the completed filesystem removal cannot be rolled back. Per-path records use atomic replacement under a repository-local lock. Writes retain the newest 256 records and reap expired records. Readers ignore a record 90 days after removal without mutating status.

`status` reads the store without writing. A recorded path enters `reappeared_worktree_paths` when it exists and has no live worktree registration. Human status places it under Attention, and the Desk shows the count with the dry-run command. Each result carries the removal time, filesystem kind, entry count, and up to 20 relative leaf names. A scan stops after 1,000 filesystem entries and reports that bound.

`worktree prune` includes only reappeared paths backed by a live record. Dry-run lists the candidate and its sampled contents. Apply requires the ordinary confirmation and checks the removal record, current Git registrations, and filesystem fingerprint again immediately before deletion. It preserves a path that contains Git metadata, cannot be inspected, exceeds the inspection bound, or changed after the plan was built. An unrecorded neighboring directory never enters this candidate set.

The removal record remains after a successful cleanup. A program that recreates the path again therefore returns to status until the record expires. If the path reappears during prune, the command reports the active writer and directs the person to close it before another run.

The explicit exclusions are background polling, automatic deletion of unknown directories, program-specific filenames, and a routine acceptance warning. The observable reappearance owns the hint because that is when the condition and recovery exist.

## Consequences

- Files written after worktree removal become visible through the same status result the Desk consumes.
- Acceptance, drop, orphan cleanup, contained reclaim, and future callers enroll through the shared removal primitive.
- Routine status pays only for reading a small common-state directory when no recorded path exists. Existing reappeared paths add a bounded filesystem inspection.
- The 90-day observation limit and 256-record cap bound machine-local history. Expired record files remain until the next evidence write, but no reader treats them as cleanup authority. A path written after expiry or eviction needs manual cleanup because discern no longer has usable provenance.
- An unavailable evidence store loses later notice without converting a completed worktree removal into a failure.
- A path can be repurposed during the evidence window. Git metadata blocks prune, and any other content appears in the confirmation plan. The person decides whether that recorded path is still cleanup material.
- Keeping evidence after cleanup can report repeated writes from the same program. It also means an intentionally reused non-Git directory at that path remains visible until expiry.

## Alternatives considered

- **Scan and remove every unknown directory under the worktree root.** Rejected because configuration chooses a placement root, not ownership of every child directory.
- **Run a background watcher.** Rejected because discern has no resident runtime and the later condition is observable on the next status or Desk refresh.
- **Special-case IDE state or warn during acceptance.** Rejected because any external program can recreate the path, while most removals never encounter the condition. The warning would consume attention before evidence exists.
- **Clear the record after the first prune.** Rejected because a program can write again when it closes. Retaining bounded evidence makes the recurrence visible without expanding the deletion boundary.
