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

Worktrees are the spine of discern's daily workflow. `discern start` creates a separate git checkout and `agent/…` branch for one task, then tells the agent where to work. The main checkout stays available as the shared view of the repository while several changes proceed at once.

Isolation covers more than files. Each worktree gets a stable identity and deterministic development port. A project can also provision a database, emulator, container, or other external resource for the worktree's lifetime. Setup commands prepare the checkout once and converge it again after the trunk changes.

The lifecycle has one recommended path. Start from the main checkout, make and commit the change inside the new worktree, run `discern update` when the trunk advances, and finish with `discern done`. After review, `discern accept --confirmed` fast-forwards the validated commit onto the trunk, tears down its resources, removes the checkout, and deletes the merged branch.

Treat every worktree as an occupied line of work, even when git reports it clean. `discern status` surveys the fleet without entering each directory. Bare `discern` opens the desk for the human decisions across that fleet: inspect, update, land, enter, or discard.

| Order | Read next                                       | What's in it                                                         |
| ----: | ----------------------------------------------- | -------------------------------------------------------------------- |
|    10 | [Start, update, and accept](lifecycle.md)       | The full lifecycle, including cleanup and refusal paths.             |
|    20 | [Per-worktree resources](the-resources.md)      | Provisioning, teardown, the resource ledger, and orphan cleanup.     |
|    30 | [Identity and environment](identity-and-env.md) | Stable names, ports, env inheritance, and runtime discovery.         |
|    40 | [Parallel and team work](team-workflow.md)      | Fleet ownership, branch composition, multiple repos, and new clones. |
|    50 | [The desk](the-desk.md)                         | The interactive human view over every active worktree.               |
