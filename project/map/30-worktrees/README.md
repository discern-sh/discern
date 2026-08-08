---
title: Worktrees
description: How discern isolates each change, keeps concurrent work separate, and lands reviewed branches on the trunk.
aliases:
  - worktrees
  - isolated worktrees
  - parallel work
---

# Worktrees

_Each discern task uses an isolated workspace (a Git worktree) with its own checkout, branch, identity, and local dependencies._

`discern start` creates a separate checkout and `agent/…` branch for one task. The main checkout remains the fleet's shared view.

Each worktree gets a stable identity, development port, and declared resources. Setup prepares the checkout and converges it after the trunk changes.

The lifecycle starts from the main checkout. Commit the change in its worktree, run `discern update` when the trunk advances, and finish with `discern done`. Once conversation consent or a recorded grant authorizes landing, `discern accept` moves the validated commit to the trunk and tears down the worktree. `--confirmed` attests only to consent in the current conversation.

Treat every worktree as occupied, even when Git reports it clean. [`discern status`](status.md) surveys the fleet and adds recent session findings. Bare `discern` opens the human view over work in progress (the Desk) to inspect, update, land, or drop tasks across the fleet.

| Order | Read next                                                           | What's in it                                                                    |
| ----: | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
|    10 | [Start, update, and accept](lifecycle.md)                           | The full lifecycle, including cleanup and refusal paths.                        |
|    20 | [The trunk](the-trunk.md)                                           | What the shared branch is, what moves it, and why work stays off it.            |
|    30 | [Per-worktree resources](the-resources.md)                          | Provisioning, teardown, the resource ledger, and orphan cleanup.                |
|    40 | [Identity and environment](identity-and-env.md)                     | Stable names, ports, env inheritance, and runtime discovery.                    |
|    50 | [Parallel and team work](team-workflow.md)                          | Fleet ownership, branch composition, multiple repos, and new clones.            |
|    60 | [Awaiting the fleet](awaiting-the-fleet.md)                         | Block until a sibling is green, its work lands, or the trunk moves.             |
|    70 | [Multi-repo workspaces](multi-repo-workspaces.md)                   | One install per repository: trunk links, registries, umbrellas, and submodules. |
|    80 | [Status and session hints](status.md)                               | Read current worktree or fleet state and the next actions it implies.           |
|    90 | [The desk](the-desk.md)                                             | Start tasks, open agents, and supervise every active worktree.                  |
|    95 | [Desk tips](desk-tips.md)                                           | One deterministic teaching line per session and where its record lands.         |
|   100 | [Landing authority](landing-authority.md)                           | See how conversation consent and recorded grants control landing.               |
|   110 | [Interrupted landing recovery](acceptance-recovery.md)              | Reconcile a journal without replaying authority or overwriting local data.      |
|   120 | [Hand work back](hand-work-back.md)                                 | Finish, report the Receipt, wait for review, and accept after approval.         |
|   130 | [Reclaiming contained worktrees](reclaiming-contained-worktrees.md) | Reclaim spent train stages on explicit confirmation; branch refs always stay.   |
