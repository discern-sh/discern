---
title: Cleanup ownership and teardown
description: How automatic cleanup proves a worktree belongs to discern and verifies that its checkout is gone.
order: 160
aliases:
  - worktree cleanup ownership
  - verified teardown
  - branch cleanup
---

# Cleanup ownership and successful teardown

_Merge status limits data loss. Recorded identity grants cleanup authority. Successful teardown requires verified absence._

## Prove ownership before planning deletion

Automatic cleanup starts from positive evidence attached to one discern lifecycle. A prune candidate needs a plain `discern/worktree-ready` marker in its own Git worktree metadata. Its branch must be the configured prefix followed by the id encoded in that same metadata. Setup uses only its dedicated `discern-setup` branch, inside the setup lifecycle.

Prune carries the candidate's complete resource-ledger snapshot in the same plan. Apply rechecks that snapshot, destroys every recorded resource before removing the checkout, then rechecks the checkout. A changed resource inventory or failed destroy keeps the checkout, including when a resource opts out of orphan garbage collection with `prunable = false`. A checkout whose acceptance journal is still recorded stays too: the journal is the only retry vehicle for what that landing still owes, such as its Proof note, so the checkout waits for `discern accept` from it.

A fully merged branch is not owned merely because deletion would preserve its commits. A similar name, a configured-prefix name without identity evidence, a checkout-local identity override, or a directory beneath the worktree parent also grants nothing. Prune can show such refs as Git context, but its actionable plan keeps them. Dry-run and apply use the same ownership rule, and apply checks the evidence again before acting.

An explicit `discern worktree drop <worktree>` can select a foreign checkout by exact id, path, local branch, or full local ref. It keeps a branch that discern cannot prove it owns. Merge status, cleanliness, containment, locks, and current worktree use remain independent safety checks; none can replace ownership.

## Removal after landing

A landing removes the effort's worktree, its resources, and its branch when the branch holds nothing beyond the landed submission, the checkout is clean, and the landing owes no Proof note; deleting the branch still requires that discern owns it. Later commits or uncommitted changes keep the checkout and branch, and the result names the route. A resource whose destroy command fails stays recorded for `discern worktree prune`, while the checkout and branch still go. A Proof note that fails to record keeps the checkout, its branch, its resources, and its acceptance journal, the note's only retry vehicle; `discern accept` from that checkout records the note and then cleans up.

A note or cleanup failure never lands the change again or spends its authority twice. [Interrupted landing recovery](acceptance-recovery.md) describes the current states and next actions.

## Prove absence before reporting success

Lifecycle commands stop their command-owned shell, hook, Git, and background descendants before removal. The shared teardown then validates the resolved target and refuses broad or uncertain paths: a filesystem root, the home directory, the main checkout, Git's common metadata, a symbolic link, an unreadable object, or an object replaced after inspection.

Removal can succeed only when both observations agree:

- Git has no worktree registration for the removed path.
- A strict filesystem check reports no file, symbolic link, or directory there.

discern records removal evidence and repeats both checks at the return boundary. A remaining or recreated entry makes the lifecycle fail and keeps the branch where possible. Setup's structural probe consumes the same result, so a successful setup cannot leave a probe checkout or registration behind.

## Recover without widening deletion

The failure names the exact path, retained Git or branch state, and the safe next action. Stop the named writer or repair that one Git worktree entry, then repeat the same lifecycle command. The retry checks the current identity and filesystem object again and converges from partial state. Do not replace it with a parent-directory deletion or repository-wide prune.

A separate program can still write to a removed location after the lifecycle returns. [Reappeared worktree paths](reappeared-worktree-paths.md) explains how removal evidence makes that later state visible and reclaimable. The ownership and absence decision is recorded separately ([ADR 0315](../_adr/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md)).
