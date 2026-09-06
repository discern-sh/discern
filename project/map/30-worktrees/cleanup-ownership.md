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

A fully merged branch is not owned merely because deletion would preserve its commits. A similar name, a configured-prefix name without identity evidence, a checkout-local identity override, or a directory beneath the worktree parent also grants nothing. Prune can show such refs as Git context, but its actionable plan keeps them. Dry-run and apply use the same ownership rule, and apply checks the evidence again before acting.

An explicit `discern worktree drop <worktree>` can select a foreign checkout by exact id, path, local branch, or full local ref. It keeps a branch that discern cannot prove it owns. Merge status, cleanliness, containment, locks, and current worktree use remain independent safety checks; none can replace ownership.

## Retirement after acceptance

Landing and retirement have separate durable records in Git's common metadata. An actor may retire another source checkout only after its owner releases it and the engine proves current ownership, cleanliness, resource inventory and exclusion. A changed source branch, an uncertain resource, or an active child process keeps the checkout. Recovery receipts and pending Proof notes remain available outside the disposable checkout.

A note or cleanup failure reports the candidate as landed with recovery pending. Retrying settles that record; it cannot publish the candidate again or spend authority twice. [Interrupted landing recovery](acceptance-recovery.md) describes the current states and next actions.

## Prove absence before reporting success

Lifecycle commands stop their command-owned shell, hook, Git, and background descendants before removal. The shared teardown then validates the resolved target and refuses broad or uncertain paths: a filesystem root, the home directory, the main checkout, Git's common metadata, a symbolic link, an unreadable object, or an object replaced after inspection.

Removal can succeed only when both observations agree:

- Git has no worktree registration for the retired path.
- A strict filesystem check reports no file, symbolic link, or directory there.

discern records retirement evidence and repeats both checks at the return boundary. A remaining or recreated entry makes the lifecycle fail and keeps the branch where possible. Setup's structural probe consumes the same result, so a successful setup cannot leave a probe checkout or registration behind.

## Recover without widening deletion

The failure names the exact path, retained Git or branch state, and the safe next action. Stop the named writer or repair that one Git worktree entry, then repeat the same lifecycle command. The retry checks the current identity and filesystem object again and converges from partial state. Do not replace it with a parent-directory deletion or repository-wide prune.

A separate program can still write to a retired location after the lifecycle returns. [Reappeared worktree paths](reappeared-worktree-paths.md) explains how removal evidence makes that later state visible and reclaimable. The ownership and absence decision is recorded separately ([ADR 0315](../_adr/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md)).
