---
title: Worktrees
description: How discern isolates each change, keeps concurrent work separate, and lands reviewed branches on the trunk.
aliases:
  - worktrees
  - isolated worktrees
  - parallel work
---

# Worktrees

_Every change gets its own checkout, branch, identity, and local dependencies._

`discern start` creates a separate checkout and `agent/…` branch for one task. The main checkout remains the fleet's shared view.

Each worktree gets a stable identity, deterministic development port, and any declared external resources. Setup commands prepare the checkout and converge it again after the trunk changes.

The lifecycle has one recommended path. Start from the main checkout, make and commit the change inside the new worktree, run `discern update` when the trunk advances, and finish with `discern done`. After review, `discern accept --confirmed` fast-forwards the validated commit onto the trunk, tears down its resources, removes the checkout, and deletes the merged branch.

Treat every worktree as occupied, even when git reports it clean. [`discern status`](status.md) surveys the fleet and adds recent session findings. Bare `discern` opens the desk to start tasks or make fleet decisions: open a coding agent, inspect, update, land, enter, or discard.

| Order | Read next                                       | What's in it                                                          |
| ----: | ----------------------------------------------- | --------------------------------------------------------------------- |
|    10 | [Start, update, and accept](lifecycle.md)       | The full lifecycle, including cleanup and refusal paths.              |
|    20 | [Per-worktree resources](the-resources.md)      | Provisioning, teardown, the resource ledger, and orphan cleanup.      |
|    30 | [Identity and environment](identity-and-env.md) | Stable names, ports, env inheritance, and runtime discovery.          |
|    40 | [Parallel and team work](team-workflow.md)      | Fleet ownership, branch composition, multiple repos, and new clones.  |
|    50 | [Status and session hints](status.md)           | Read current worktree or fleet state and the next actions it implies. |
|    60 | [The desk](the-desk.md)                         | Start tasks, open agents, and supervise every active worktree.        |
