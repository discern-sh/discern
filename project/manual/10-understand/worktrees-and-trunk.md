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

When two agents share one folder, one agent's half-finished edit can break the other's tests, and unfinished work can reach your shared branch before anyone has reviewed it. Separate copies prevent both.

## Each task works in its own worktree

Say two agents are working on your recipe app at once: one adds recipe search, and the other improves the layout on phones. When the search agent starts its task, it runs `discern start`, which creates a **worktree**: a separate copy of the project with its own branch, where the task's commits go. Its result says:

> Created worktree 'recipe-search-0a7563' at /Users/ada/recipe-app.worktrees/recipe-search-0a7563 (branch agent/recipe-search-0a7563).

The layout agent gets its own copy beside it, so neither agent can overwrite the other's files. discern also sets up anything your project says each copy needs, such as its own port for a development server or its own test database, so both agents can run their tests at the same time without changing each other's data. What your agent can read and run on your machine is still up to its own permission settings, since discern doesn't sandbox it.

The worktree stays with the task until the change lands. If you review search and ask for changes, the agent makes them in the same worktree, and if the session ends, the next one carries on there instead of starting again. discern changes a worktree only when a command runs in it. It never slips other work into one or hands a quiet worktree to another task, so whatever the agent left there is what it finds when it comes back.

Your original project folder is the **main checkout**. Agents make their task edits in worktrees, so the main checkout stays free for you. Run `discern` there to open the **desk**, an interactive view of every task at once.

## The trunk holds what you've agreed to

The **trunk** is your project's shared branch, usually `main`. Every new task starts from it, and a change reaches it only by **landing**.

Finishing a task doesn't land it. When search is done, the agent commits its work and runs `discern done`, which runs the **gate**, your project's tests and other required commands, and records [Proof](proof.md) of which passed on exactly which commit. Search is now green, meaning the gate passed, but `main` hasn't changed.

So you can try search in its worktree first. Say you find it should search ingredients too. You ask, and the agent makes the change, then runs the gate again, because the first Proof doesn't cover the new version. Meanwhile, `main` still holds the last version you accepted.

When you're happy, the agent submits search to land. It waits in the **landing queue** until it has permission, from you or from a **grant**: permission you set up in advance. Approving search approves only search, so the layout task still needs its own permission, and if the search agent answered a [checkpoint](checkpoints.md) question unmet, only you can approve landing it anyway. [Proof](proof.md#checks-judgments-and-permission) explains where permission can come from.

## How work moves between tasks

These moves connect a worktree to other work:

| Move                          | What it does                                                              | In the recipe app                                                       |
| ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Update**                    | Merges the latest trunk into a task's branch.                             | The layout change lands, and the search agent brings it into its copy.  |
| **Build on work in progress** | Starts a task from another task's branch, or merges that branch into one. | A task that writes help pages for search starts from the search branch. |
| **Land**                      | Checks the Proof and permission, then moves the trunk to what passed.     | `main` gets the search you approved.                                    |

You don't need to run these yourself. Your agent runs `discern update`, `discern start --from` or `discern update --from`, and `discern accept`, and each result tells it what to do next.

When one task needs another's work, the agent can [wait for it](../20-guides/wait-for-another-task.md), so you don't have to tell it when the other task is ready.

## When other work lands first

Say the layout change lands while search waits for your review. That doesn't send search back to the start.

When search lands, discern combines it with the new `main` in a temporary copy, called an **integration worktree**, and runs the gate on the combined code instead of landing search on top of work its gate run never saw. It lands exactly what passed. If the two changes conflict, or the combined run fails, nothing lands: the search agent gets the conflicting files or the failing command, brings the new `main` into its worktree, fixes the problem, and tries again.

While the agent is still working, it keeps up with `main` itself: before it runs the gate, `discern done` asks it to bring in any work that has landed since the task started. [Finish and land a change](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) shows what this looks like when you review.

## What separate copies can't catch

Worktrees keep files apart, but they can't make two features agree. Search might put a search box at the top of the recipe list while the layout task puts a menu in the same spot. Each change works in its own copy, and the combined code might pass every test, so you still need to see the two together.

discern points you to the likely clashes. In the main checkout, `discern status` lists your **fleet**, all the tasks in progress, and flags tasks that changed the same files:

> Note 1 worktree pair changing the same files: agent/phone-layout-d42cd8 ↔ agent/recipe-search-0a7563. Both sides may merge cleanly and still conflict semantically.

That's your cue to look at the recipe list with both changes in place. When one side's work reaches the other, `discern update` names the files both touched, so the agent can check how they fit together.

Your project decides what else each worktree gets its own copy of. A test database set up for each worktree keeps test data apart, but a shared service outside that setup stays shared.

## After a change lands

When search lands, discern removes its worktree, its branch, and anything set up for it. If the worktree stays, the result says why: the branch may have newer commits that haven't landed, the worktree may have uncommitted changes, its Proof note may still need recording, or cleanup may not have finished. [Finish and land a change](../20-guides/finish-and-land-a-change.md#after-it-lands) covers each case.

To set a task aside for longer, your agent can **park** it. discern removes the worktree but keeps the branch, its commits, and the task's description, so the work can pick up later. [Coordinate parallel tasks](../20-guides/coordinate-parallel-tasks.md#park-a-task-you-will-return-to) explains when to park, and [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md) helps when a session or command stops partway.

To run several tasks at once, follow [Coordinate parallel tasks](../20-guides/coordinate-parallel-tasks.md). The [worktrees and status reference](../30-reference/worktrees-and-status.md) lists every field.
