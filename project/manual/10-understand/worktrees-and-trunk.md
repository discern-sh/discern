---
id: explanation-worktrees-and-trunk
title: "Worktrees and trunk"
description: "Let each agent build, break, and fix things in its own copy of the project, while your shared branch moves only when a change you've approved lands."
order: 40
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

Each task your agent takes on gets its own copy of the project, so the agent can try an idea, break something, and fix it there while your shared branch keeps working. That branch moves only when a finished change has passed its tests and has your permission to land.

When two agents share one folder, one agent's half-finished edit can break the other's tests. Unfinished work can also reach your shared branch before anyone has reviewed it. Separate copies prevent both.

## Each task works in its own worktree

Say two agents are working on your recipe app at once: one adds search, and the other improves the phone layout. The search agent starts with `discern start`, which creates a **worktree**: a separate copy of the project on its own branch. Its result says:

> Created worktree 'recipe-search-0a7563' at /Users/ada/recipe-app.worktrees/recipe-search-0a7563 (branch agent/recipe-search-0a7563).

The layout agent gets its own copy beside it, so neither agent can overwrite the other's files. Each worktree also gets its own port and any test database or other resource your project declares, so both agents can run their tests at once. A service outside that setup stays shared. A worktree isn't a sandbox: your agent's own permission settings still decide what it can read and run.

The worktree stays with the task until the change lands. Review fixes go there too, and a new session carries on where the last one stopped. discern never slips other work into a worktree or hands one to another task, so whatever the agent left there is what it finds when it comes back.

Your original project folder, the **main checkout**, stays free for you. Run `discern` there to open the **desk**, an interactive view of every task at once.

## The trunk holds what you've agreed to

The **trunk** is your project's shared branch, usually `main`. Every new task starts from it, and a change reaches it only by **landing**.

Finishing a task doesn't land it. When search is done, the agent commits its work and runs `discern done`. That runs the **gate**, your project's tests and other required commands, and records [Proof](proof.md) of which passed on which exact commit. Search is now green: the gate passed, but `main` hasn't changed.

So you can try search in its worktree first. Say you want it to search ingredients too. The agent makes the change and runs the gate again, because the first Proof doesn't cover the new version. Meanwhile, `main` still holds the last version you accepted.

When you're happy, the agent submits search to land. It waits in the **landing queue** until it has permission from you, or from a **grant** you set up in advance, as [Pre-approve routine work](../20-guides/finish-and-land-a-change.md#pre-approve-routine-work) explains. Approving search approves only search. If the search agent answered a [checkpoint](checkpoints.md) question unmet, only you can approve landing it anyway.

## How work moves between tasks

Your agent moves work between worktrees for you, and each result tells it what to do next. It runs `discern update` to merge the latest trunk into a task's branch, so search can pick up the layout change once that lands. With `discern start --from`, a new task, such as help pages for search, can build on work that hasn't landed. When one task needs another's work, your agent can [wait for it](../20-guides/wait-for-another-task.md), so you don't have to tell it when the other task is ready.

## When other work lands first

Say the layout change lands while search waits for your review: that doesn't send search back to the start. When search lands, discern checks the combined code in a temporary copy and lands exactly what passed, as [When other work lands first](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) explains.

## What separate copies can't catch

Worktrees keep files apart, but they can't make two features agree. Search might put a search box at the top of the recipe list, right where the layout task puts a menu. The combined code might pass every test, so you still need to see the two together.

discern points you to likely clashes. In the main checkout, `discern status` lists your **fleet**, the tasks in progress, and flags any that changed the same files:

> Note 1 worktree pair changing the same files: agent/phone-layout-d42cd8 ↔ agent/recipe-search-0a7563. Both sides may merge cleanly and still conflict semantically.

That's your cue to look at the recipe list with both changes in place.

## After a change lands

When search lands, discern removes its worktree, branch, and anything set up for it, and if any of it stays, [A landed task's worktree stayed behind](../40-troubleshooting/worktrees-and-resources.md#a-landed-tasks-worktree-stayed-behind) explains why. To set a task aside for longer, your agent can [park it](../20-guides/coordinate-parallel-tasks.md#park-a-task-you-will-return-to), which removes the worktree but keeps the branch and its commits.

To run several tasks at once, follow [Coordinate parallel tasks](../20-guides/coordinate-parallel-tasks.md). The [worktrees and status reference](../30-reference/worktrees-and-status.md) lists every field.
