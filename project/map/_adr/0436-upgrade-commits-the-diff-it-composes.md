# ADR 0436: Upgrade commits the diff it composes

**Status**: accepted.

## Context

`discern upgrade` refused a tree with uncommitted tracked changes, wrote its changes, and stopped. The project was left with a dirty tree and an instruction to review and commit it ([ADR 0014](0014-versioned-migration-system.md)).

That gap had a cost beyond the extra step. The adoption an upgrade records travels through Git. A new worktree starts from the committed trunk, so every worktree started before the hand commit began without the upgrade. Each one then reported stale managed files against a binary the project had already adopted. The dirty checkout also refused the next upgrade and sat in the way of unrelated work.

The clean-tree guard already establishes the fact a commit needs. A tree that was clean before the upgrade holds only the upgrade's changes afterwards. No project judgment enters that diff, which is the class of change discern already commits itself ([ADR 0203](0203-discern-co-authors-only-commits-it-composes.md)).

## Decision

An upgrade that completes on a tree it found clean commits its own changes.

The [commit step](../../../src/commands/upgrade_commit.ts) records the untracked paths before the upgrade writes. Afterwards it takes every tracked change and each untracked path that was not there before. A file the owner had left untracked stays untracked, even when the upgrade rewrote it. The commit goes through the shared commit boundary as a sixth registered site, so it keeps the invoking user's identity, carries the co-author trailer, runs hooks and signing, and may change only its declared paths.

The commit fails open. A hook rejection, a signing failure, or a detached `HEAD` leaves the upgraded files in the working tree. The result stays successful, names the reason and the paths, and carries a next-step hint. Rolling the upgrade back would discard valid work to answer a failure in a different step.

Three cases make no commit:

- `--allow-dirty` hands the commit to the owner. The owner's edits and the upgrade's can share a file, so no path set is provably the upgrade's alone. The flag decides this even on a clean tree, which matches setup and gives one invocation one behavior.
- A directory outside Git has nothing to commit to.
- A partial refresh is an incomplete upgrade. Its effects wait for the retry.

`--check` and `--dry-run` write nothing, as before.

## Consequences

An upgrade is one commit. `git show` reviews it and `git revert` undoes it, including files the upgrade created, which `git checkout` never removed.

The review moment moves from before the commit to after it. `--dry-run` remains the preview, and the commit is local until pushed. An owner who wants the diff uncommitted passes `--allow-dirty`.

An upgrade run in the main checkout commits on the trunk without passing the gate. That was already true of the hand commit it replaces. The documented route still runs the upgrade in a task worktree and lands it through the gate, and there the commit is the one the agent would have made.

A project whose hooks reject discern's subject line gets the fail-open path on every upgrade. The message is not configurable, as with the other five sites.

## Alternatives considered

- **Keep the hand commit.** Rejected: the dirty tree is an unfinished transaction, and nothing in it needs the owner's judgment.
- **Decide by the tree's state, ignoring the flag.** `--allow-dirty` on a clean tree would then commit. Rejected: the same command would commit or not depending on what else was in the checkout, and the flag would stop meaning that the owner manages the commit.
- **Add `--no-commit`.** Deferred. `--allow-dirty` already covers an owner who wants the changes uncommitted, and a second flag would have to define how the two combine.
- **Commit a declared list of written paths.** Rejected: a migration may move, delete, or create arbitrary files, so the clean baseline is the only complete account of what the upgrade changed.
- **Fail the upgrade when the commit fails.** Rejected: the project is upgraded, and a failing exit would send a caller to retry an operation that has nothing left to do.
