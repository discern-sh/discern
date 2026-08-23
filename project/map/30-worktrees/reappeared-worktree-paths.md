---
title: Reappeared worktree paths
description: How discern reports and safely cleans files an external program writes into a worktree path after removal.
order: 160
aliases:
  - reappeared worktree path
  - stale worktree files
  - files left after worktree removal
  - retired worktree path
---

# Reappeared worktree paths

_Review files written after worktree removal, then reclaim only the path discern can prove it removed._

## Why a removed path can return

An external program can retain an open checkout after acceptance, drop, or prune removes its Git worktree. A later save or shutdown can recreate the old directory with local state. Git no longer knows the path, and an ordinary orphan scan cannot see a directory without a `.git` link.

Before removal, discern waits for command-owned shell and Git processes and stops ordinary background descendants in their isolated process groups. The shared removal path then proves Git no longer registers the worktree and a strict `lstat` reports the path absent. It records the canonical path and removal time in Git's common administrative directory, then repeats both observations at the return boundary. A file, symlink, directory, unreadable path, or remaining Git registration makes teardown fail visibly instead of returning success ([ADR 0314](../_adr/0314-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md)).

The evidence store retains at most 256 paths. Readers ignore records 90 days after removal, and a later evidence write reaps expired records.

## Observe the reappearance

`discern status` and the Desk report a recorded path when it exists again without a live worktree registration. Structured status includes the removal time, path kind, entry count, and up to 20 relative content names. There is no background watcher or program-specific filename matching.

Review the removal plan:

```sh
discern worktree prune --dry-run
```

## Confirm cleanup

Confirmed prune removes only paths backed by discern's removal evidence. An unrecorded neighboring directory remains outside the plan. Apply checks the record, Git registrations, and a filesystem snapshot again immediately before deletion.

Prune keeps a path that contains Git metadata, cannot be read, exceeds the 1,000-entry inspection bound, or changed after the plan was built. Close the program writing into the path before confirming. If the path reappears during deletion, discern reports the active writer and keeps the evidence for another run. Repeating the same lifecycle command is safe: exact registration cleanup and absence checks converge from the state they observe.

Cleanup does not clear the record. A second reappearance remains observable until the 90-day limit ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

## Where it lives in code

| Responsibility          | Source                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Evidence and inspection | [`src/engine/worktree/retired_paths.ts`](../../../src/engine/worktree/retired_paths.ts) |
| Removal enrollment      | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)                     |
| Status projection       | [`src/engine/status/status.ts`](../../../src/engine/status/status.ts)                   |
| Behavioral coverage     | [`tests/engine_worktree_prune_test.ts`](../../../tests/engine_worktree_prune_test.ts)   |
