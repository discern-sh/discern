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

`discern start` creates a separate checkout and `agent/…` branch for one task. The main checkout remains the fleet's shared view. A checkout changes only under its own operation: no operation installs another revision into an authoring worktree, and a checkout's cleanliness or idleness never makes it available to another operation ([ADR 0389](../_adr/0389-the-workspace-contract.md)).

Every checkout has a stable identity, development port, and test-order seed. Linked worktrees additionally receive their declared resources, isolated setup, and human task metadata. The display title and brief remain separate from branch and resource identity. The main checkout derives its constant identity from the configured trunk branch.

The lifecycle starts from the main checkout. Commit the change in its worktree, run `discern update` when the trunk advances, and finish with `discern done`, which proves the committed tip. `discern accept` records the effort's submission and, once conversation consent or a recorded grant authorizes it, fast-forwards the trunk to that commit, converges the main checkout, and removes the worktree, its resources, and its branch when the branch holds nothing beyond the submission. A branch with later commits or a cleanup that cannot complete leaves the landing intact and names the route. `--confirmed` attests only to consent in the current conversation. Automatic cleanup requires recorded fleet ownership; merge status alone never authorizes deletion.

Treat every worktree as occupied, even when Git reports it clean. [`discern status`](status.md) surveys the fleet and adds recent session findings. Bare `discern` opens the human view over work in progress (the desk) to inspect, update, land, or drop tasks across the fleet.

| Order | Read next                                                           | What's in it                                                                    |
| ----: | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
|    10 | [Start, update, and accept](lifecycle.md)                           | The full lifecycle, including cleanup and refusal paths.                        |
|    20 | [The trunk](the-trunk.md)                                           | What the shared branch is, what moves it, and why work stays off it.            |
|    30 | [Per-worktree resources](the-resources.md)                          | Provisioning, teardown, the resource ledger, and orphan cleanup.                |
|    40 | [Identity and environment](identity-and-env.md)                     | Stable identity, human task metadata, ports, env inheritance, and discovery.    |
|    50 | [Parallel and team work](team-workflow.md)                          | Fleet ownership, branch composition, multiple repos, and new clones.            |
|    60 | [Awaiting the fleet](awaiting-the-fleet.md)                         | Block until a sibling is green, its work lands, or the trunk moves.             |
|    70 | [Multi-repo workspaces](multi-repo-workspaces.md)                   | One install per repository: trunk links, registries, umbrellas, and submodules. |
|    80 | [Status and session hints](status.md)                               | Read current worktree or fleet state and the next actions it implies.           |
|    90 | [The desk](the-desk.md)                                             | Create or resume tasks, open agents, and supervise the fleet.                   |
|   100 | [Open another worktree](opening-worktrees.md)                       | Move sideways into another checkout while preserving your relative directory.   |
|   110 | [Desk tips](desk-tips.md)                                           | One deterministic teaching line per session and where its record lands.         |
|   120 | [Landing authority](landing-authority.md)                           | See how conversation consent and recorded grants control landing.               |
|   130 | [Interrupted landing recovery](acceptance-recovery.md)              | Complete or roll back a recorded landing without replaying authority.           |
|   140 | [Hand work back](hand-work-back.md)                                 | Finish, report the Proof, wait for review, and accept after approval.           |
|   150 | [Reclaiming contained worktrees](reclaiming-contained-worktrees.md) | Reclaim spent train stages on explicit confirmation; branch refs always stay.   |
|   160 | [Cleanup ownership and teardown](cleanup-ownership.md)              | Prove cleanup authority and verify checkout absence before reporting success.   |
|   170 | [Reappeared worktree paths](reappeared-worktree-paths.md)           | Review files written after removal and reclaim only evidence-backed paths.      |
|   180 | [Recover a dropped branch](drop-recovery.md)                        | Restore committed work from discern's bounded local recovery refs.              |

[Emergency integration](emergency-integration.md) records an explicit owner decision to integrate before machine validation finishes. It issues no passing Proof.
