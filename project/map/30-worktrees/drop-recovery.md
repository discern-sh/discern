---
title: Recover a dropped branch
description: Restore committed work after discern removes a worktree branch.
order: 180
aliases:
  - dropped worktree
  - recover dropped branch
  - recovery refs
  - refs discern recovery
---

# Recover a dropped worktree branch

_A destructive drop leaves a bounded, local route back to the branch's last committed snapshot._

## What drop retains

Before `discern worktree drop` removes resources, the checkout, or its branch, it stores the branch tip under `refs/discern/recovery/` and prints the exact ref. A failed write stops the drop with the worktree and branch intact. Dry-run creates no ref.

The repository keeps the newest 32 drop refs. They are local to this clone and are not pushed or fetched automatically. For an attached worktree, drop retains the branch tip it will delete. For a detached worktree whose commit is not reachable from the trunk, drop retains that exact detached HEAD before a forced removal. A worktree holding the trunk keeps that branch, while acceptance needs no recovery ref because the accepted commit is reachable from the trunk ([ADR 0271](../_adr/0271-destructive-drops-retain-bounded-recovery-refs.md)).

## Restore the committed tip

Use the ref printed by drop. If that output is unavailable, list retained tips newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

Create a normal branch at the selected ref, then inspect it:

```sh
git switch -c recovered-work refs/discern/recovery/20260811T120000000Z-example-1234abcd
git log --stat recovered-work
```

Review the branch before deleting its recovery ref. When the retained history is no longer needed, remove the ref explicitly with `git update-ref -d <ref>`.

## Know the boundary

The ref retains committed objects only. Staged, working-tree, ignored, and untracked bytes are absent from the branch tip, so `--force` can still destroy them permanently.

For lost refs outside discern's drop path, use `git reflog`. `discern doctor` warns when reflog recording is disabled or an explicit expiry falls below discern's recovery floor.
