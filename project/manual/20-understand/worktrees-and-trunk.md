---
id: explanation-worktrees-and-trunk
title: "Worktrees and trunk"
description: "Understand why unfinished work stays in isolated worktrees, what trunk means, and how update/composition/accept move evidence."
order: 60
publish: true
kind: explanation
aliases:
  - "explanation-worktrees-and-trunk"
  - "the trunk"
  - "trunk branch"
  - "landing branch"
  - "worktree"
---

# Worktrees and trunk

Running several agent tasks at once raises an immediate worry: what happens to the code while they work? Sessions editing one checkout overwrite each other. Half-finished changes drift into the branch you rely on. And your own working copy becomes a construction site you no longer recognize.

discern separates where work happens from where agreed work lives. Each task runs in a **worktree**, an isolated workspace with its own checkout and branch. The **trunk** is the project's shared branch, usually `main`, and it holds only work that has been accepted. Nothing reaches the trunk as a side effect of working; unfinished work can change, fail, and recover without touching what the project agrees on.

## A worktree is a task's own place

`discern start` creates one: a separate linked checkout on its own branch, forked from the trunk regardless of what the main checkout happens to be showing. The worktree carries its own identity (a task name, a deterministic port for its dev server, its own environment values) and any resources the project declares for a workspace, such as a database or an emulator. discern creates those resources when the worktree starts and removes them when the work lands, so two tasks running side by side don't compete for the same files, port, or test database.

One worktree lasts for its whole effort, through review feedback and resumed sessions. Meanwhile the main checkout stays yours. Agents work in their worktrees; reading and investigation are all that most sessions need from the main copy.

An explicit `start --from <ref>` preserves the exact resolved commit as the task's base. That base may be behind, equal to, or ahead of the trunk. A positive behind count recommends an update before the Gate and acceptance while preserving the requested composition base.

## The trunk is what the project agrees on

The trunk holds the project's accepted state while any number of branches remain in flight. Every worktree forks from it, and the project's final quality check (the Gate) requires a branch to contain the current trunk before `discern done` can pass, because evidence is meaningful only against the state the work would join.

An edit made directly on the trunk skips the worktree, the Gate, Proof, and review, and it leaks into every other task's next update. The practice keeps such edits rare in layers: the compiled instructions say worktree-first, a session that starts in the main checkout is reminded, and `discern status` warns when the main checkout is dirty. Decisions that belong to the shared state, such as moving a Standard's limit or changing `discern.toml` policy, are made on the trunk by you.

## How work and evidence move

Movement between worktrees and the trunk is always explicit:

- **Update brings the trunk into a branch.** When a landing elsewhere moves the trunk under a task in flight, `discern update` brings the latest trunk in and reports which of the task's own files the incoming work also touched. A divergent update keeps Git integration as a merge commit. If regeneration changes tracked artifacts, discern records that convergence in a second commit rather than folding it into the merge. The resulting non-linear history separates integrated authored work from generated effects. The agent re-reads the overlap, because a merge can apply cleanly and still combine incompatible assumptions.
- **Accept lands a branch on the trunk.** With your authority, `discern accept` fast-forwards the trunk to the exact commit honored by current [Proof](proof.md)—or the exact commit a fresh in-transaction Gate validates—without a squash, history rewrite, extra merge, or substitute commit. It then removes the worktree and its branch. The evidence stays with that landed commit as a durable note.
- **Composition builds one branch on another.** `discern start` and `discern update` accept a `from` reference, so a dependent task can build on a sibling's unlanded work. Related tasks can stack below the trunk while review is pending; only acceptance moves the trunk itself.

When one task needs another's result, the agent waits on the repository condition rather than polling or asking you to relay status; [Wait for another task](../10-guides/wait-for-another-task.md) covers choosing between a proven sibling, a landed sibling, and trunk movement.

## What isolation covers, and what it can't

Isolation covers the checkout and the declared resources: parallel agents can't overwrite one another's working tree. It doesn't make changes semantically independent. Tasks can still edit the same source file in their separate copies, and each can be green on its own. `discern status` shows the tasks in flight (the fleet) with one row per worktree, and names the files two tasks have both changed before either lands. The later landing brings the trunk in and re-reads the shared paths. Separate checkouts remove the mechanical collisions; where two changes touch the same meaning, integration still gets reviewed.

Interruption is planned for. Worktree setup records its intent before acting, so a crash leaves either a working copy or one that can be reclaimed, and a mistakenly removed task keeps a route back to its recent commits. [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) covers those paths.

Landing is one common-repository transaction. Acceptance resolves the configured trunk once and holds the repository lock from evidence validation through cleanup and reporting. Other common-repository mutations refuse immediately while it runs. If cleanup fails after the trunk moves, recovery uses the worktree-local journal while the checkout survives. After removal, the landed SHA supplies the recovery authority without replaying consent.

[Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md) is the working procedure for starting, inspecting, resourcing, and composing several efforts. [Finish and land a change](../10-guides/finish-and-land-a-change.md) follows a single change end to end, and [Worktrees and status](../30-reference/worktrees-and-status.md) lists the exact identity, environment, and status fields.
