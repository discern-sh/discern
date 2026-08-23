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

Every successful worktree removal first checks that the path is absent. discern then records the canonical path and removal time in Git's common administrative directory. The store retains at most 256 paths. Readers ignore records 90 days after removal, and a later evidence write reaps expired records.

## Observe the reappearance

`discern status` and the Desk report a recorded path when it exists again without a live worktree registration. Structured status includes the removal time, path kind, entry count, and up to 20 relative content names. There is no background watcher or program-specific filename matching.

Review the removal plan:

```sh
discern worktree prune --dry-run
```

## Confirm cleanup

Confirmed prune removes only paths backed by discern's removal evidence. An unrecorded neighboring directory remains outside the plan. Apply checks the record, Git registrations, and a filesystem snapshot again immediately before deletion.

Prune keeps a path that contains Git metadata, cannot be read, exceeds the 1,000-entry inspection bound, or changed after the plan was built. Close the program writing into the path before confirming. If the path reappears during deletion, discern reports the active writer and keeps the evidence for another run.

Cleanup does not clear the record. A second reappearance remains observable until the 90-day limit ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

## Where it lives in code

| Responsibility          | Source                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Evidence and inspection | [`src/engine/worktree/retired_paths.ts`](../../../src/engine/worktree/retired_paths.ts) |
| Removal enrollment      | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)                     |
| Status projection       | [`src/engine/status/status.ts`](../../../src/engine/status/status.ts)                   |
| Behavioral coverage     | [`tests/engine_worktree_prune_test.ts`](../../../tests/engine_worktree_prune_test.ts)   |
