---
id: troubleshoot-worktrees-and-resources
title: "Worktrees and resources"
description: "Recover a refused/interrupted lifecycle, contained checkout, reappeared path, cleanup ownership, resource, identity, port, or env issue safely."
order: 40
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-worktrees-and-resources"
  - "Reclaiming contained worktrees"
  - "contained worktree"
  - "worktree prune --contained"
  - "reclaim a worktree"
  - "spent train stage"
  - "Cleanup ownership and successful teardown"
  - "worktree cleanup ownership"
  - "verified teardown"
  - "branch cleanup"
  - "Reappeared worktree paths"
  - "reappeared worktree path"
  - "stale worktree files"
  - "files left after worktree removal"
  - "retired worktree path"
redirect_from:
  - "/docs/worktrees/reclaiming-contained-worktrees"
  - "/docs/worktrees/cleanup-ownership"
  - "/docs/worktrees/reappeared-worktree-paths"
---

# Worktrees and resources

Recover a refused/interrupted lifecycle, contained checkout, reappeared path, cleanup ownership, resource, identity, port, or env issue safely.

## Reclaiming contained worktrees

_Reclaim a completed stage's checkout while keeping its branch ref for recovery._

Composition below the trunk ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)) leaves finished stages behind. `start --from` forks a later stage from an earlier one, and the composed branch lands after the stages finish. Earlier checkouts therefore remain. discern calls a worktree **contained** when its branch tip is a strict ancestor of another live branch's tip, its tree is clean, and it is idle ([ADR 0225](https://discern.sh/docs/decisions/0225-contained-worktree-reclaim-is-offer-only)).

### The offer

`discern worktree prune` reports contained worktrees as their own plan section, the `status` fleet survey marks the rows, and the Desk offers a reclaim action. Each report names the nearest containing branch with tip hashes and its lead. Idleness follows the Logbook's paired begin/finish events when the Logbook is on. An install with recording off falls back to a 1-hour inactivity period. The Logbook narrows the offer. Human confirmation decides whether reclaim runs.

### The reclaim

Reclaiming requires a fresh, explicit confirmation through `discern worktree prune --contained` and its terminal interaction, or through the Desk action. A reclaim destroys the checkout and its per-worktree state, including the Gate Proof, so `discern await --green <stage>` then refuses and points at the containing branch. The reclaim tears resources down through the same lifecycle path acceptance uses. The branch ref survives the reclaim as its recovery path (`discern start --from <branch>`). Ordinary prune removes that ref after the composed branch lands. Until then, `status` and the Desk list the kept ref beside its container; refs with no container warn as abandoned.

### Where it lives in code

| Responsibility            | Source                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The containment predicate | [`src/engine/worktree/containment.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/containment.ts)           |
| Prune offer and reclaim   | [`src/engine/worktree/lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)               |
| Desk action               | [`src/engine/desk/desk.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/desk.ts)                                 |
| Behavioral coverage       | [`tests/engine_worktree_contained_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_worktree_contained_test.ts) |

### Current state and gotchas

- No configuration, grant, or hint can reclaim a worktree without a fresh confirmation naming it.
- Equal tips are ambiguous twins and never qualify. An unreadable checkout stays off the list because unknown state does not qualify.
- Apply re-checks each candidate's live state immediately before acting. A stage that gained work drops out.

## Cleanup ownership and successful teardown

_Merge status limits data loss. Recorded identity grants cleanup authority. Successful teardown requires verified absence._

### Prove ownership before planning deletion

Automatic cleanup starts from positive evidence attached to one discern lifecycle. A prune candidate needs a plain `discern/worktree-ready` marker in its own Git worktree metadata. Its branch must be the configured prefix followed by the id encoded in that same metadata. Setup uses only its dedicated `discern-setup` branch, inside the setup lifecycle.

A fully merged branch is not owned merely because deletion would preserve its commits. A similar name, a configured-prefix name without identity evidence, a checkout-local identity override, or a directory beneath the worktree parent also grants nothing. Prune can show such refs as Git context, but its actionable plan keeps them. Dry-run and apply use the same ownership rule, and apply checks the evidence again before acting.

An explicit `discern worktree drop <id|path>` can remove a foreign checkout a person selected. It keeps a branch that discern cannot prove it owns. Merge status, cleanliness, containment, locks, and current worktree use remain independent safety checks; none can replace ownership.

### Prove absence before reporting success

Lifecycle commands stop their command-owned shell, hook, Git, and background descendants before removal. The shared teardown then validates the resolved target and refuses broad or uncertain paths: a filesystem root, the home directory, the main checkout, Git's common metadata, a symbolic link, an unreadable object, or an object replaced after inspection.

Removal can succeed only when both observations agree:

- Git has no worktree registration for the retired path.
- A strict filesystem check reports no file, symbolic link, or directory there.

discern records retirement evidence and repeats both checks at the return boundary. A remaining or recreated entry makes the lifecycle fail and keeps the branch where possible. Setup's structural probe consumes the same result, so a successful setup cannot leave a probe checkout or registration behind.

### Recover without widening deletion

The failure names the exact path, retained Git or branch state, and the safe next action. Stop the named writer or repair that one Git worktree entry, then repeat the same lifecycle command. The retry checks the current identity and filesystem object again and converges from partial state. Do not replace it with a parent-directory deletion or repository-wide prune.

A separate program can still write to a retired location after the lifecycle returns. [Reappeared worktree paths](worktrees-and-resources.md) explains how removal evidence makes that later state visible and reclaimable. The ownership and absence decision is recorded separately ([ADR 0315](https://discern.sh/docs/decisions/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence)).

## Reappeared worktree paths

_Review files written after worktree removal, then reclaim only the path discern can prove it removed._

### Why a removed path can return

An external program can retain an open checkout after acceptance, drop, or prune removes its Git worktree. A later save or shutdown can recreate the old directory with local state. Git no longer knows the path, and an ordinary orphan scan cannot see a directory without a `.git` link.

Before removal, discern waits for command-owned shell and Git processes and stops ordinary background descendants in their isolated process groups. The shared removal path then proves Git no longer registers the worktree and a strict `lstat` reports the path absent. It records the canonical path and removal time in Git's common administrative directory, then repeats both observations at the return boundary. A file, symlink, directory, unreadable path, or remaining Git registration makes teardown fail visibly instead of returning success ([ADR 0315](https://discern.sh/docs/decisions/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence)).

The evidence store retains at most 256 paths. Readers ignore records 90 days after removal, and a later evidence write reaps expired records.

### Observe the reappearance

`discern status` and the Desk report a recorded path when it exists again without a live worktree registration. Structured status includes the removal time, path kind, entry count, and up to 20 relative content names. There is no background watcher or program-specific filename matching.

Review the removal plan:

```sh
discern worktree prune --dry-run
```

### Confirm cleanup

Confirmed prune removes only paths backed by discern's removal evidence. An unrecorded neighboring directory remains outside the plan. Apply checks the record, Git registrations, and a filesystem snapshot again immediately before deletion.

Prune keeps a path that contains Git metadata, cannot be read, exceeds the 1,000-entry inspection bound, or changed after the plan was built. Close the program writing into the path before confirming. If the path reappears during deletion, discern reports the active writer and keeps the evidence for another run. Repeating the same lifecycle command is safe: exact registration cleanup and absence checks converge from the state they observe.

Cleanup does not clear the record. A second reappearance remains observable until the 90-day limit ([ADR 0265](https://discern.sh/docs/decisions/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup)).

### Where it lives in code

| Responsibility          | Source                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Evidence and inspection | [`src/engine/worktree/retired_paths.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/retired_paths.ts) |
| Removal enrollment      | [`src/engine/worktree/git.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/git.ts)                     |
| Status projection       | [`src/engine/status/status.ts`](https://github.com/jackwh/discern/blob/main/src/engine/status/status.ts)                   |
| Behavioral coverage     | [`tests/engine_worktree_prune_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_worktree_prune_test.ts)   |
