---
id: explanation-worktrees-and-trunk
title: "Worktrees and trunk"
description: "Let each agent build, break, and fix things in its own copy of the project, while your shared branch moves only when checked work lands."
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

Each task your agent takes on gets its own copy of the project. The agent can try an idea, break something, and fix it there, while your shared branch keeps working. That branch moves only when a finished change passes its checks and has your permission to land.

This page follows a recipe app with two tasks running at once. One agent adds recipe search. Another improves the layout on phones.

## Each task works in its own copy

When your agent starts a task, it runs `discern start`. That creates a **worktree**: a separate copy of the project with its own branch, where the task's commits go. The search agent edits one copy, and the layout agent edits another. Neither can overwrite the other's files.

discern also sets up anything your project says each copy needs, such as its own port for a development server or its own test database. Both agents can then run their tests at the same time without changing each other's data.

The worktree stays with the task until the change lands. If you review search and ask for changes, the agent makes them in the same worktree. If the session ends, the next one carries on in that worktree instead of starting again.

discern changes a worktree only when a command runs in it. It never slips other work into it, and it never hands a quiet worktree to another task. Whatever the agent left there is what it finds when it comes back.

Your original project folder is the **main checkout**. Agents make their task edits in worktrees, so the main checkout stays free for you. Run `discern` there to open the **desk**, an interactive view of every task at once.

## The trunk holds what you've agreed to

The **trunk** is your project's shared branch, usually `main`. Every new task starts from it, and a change reaches it only by **landing**.

Finishing a task doesn't land it. When search is done, the agent commits its work and runs `discern done`. That runs your project's checks and records [Proof](proof.md): which checks passed, on exactly which commit. Search is now green, meaning its checks passed. But `main` hasn't changed.

So you can try search in its worktree first. Say you find it should search ingredients too. You ask, and the agent makes the change. The first Proof doesn't cover the new version, so the agent runs the checks again. Meanwhile, `main` still holds the last version you accepted.

When you're happy, the agent submits search to land. It waits in the **landing queue** until it has permission, from you or from a **grant**: permission you set up in advance. Approving search approves only search. The layout task still needs its own permission. [Proof](proof.md#checks-judgments-and-permission) explains where permission can come from.

## How work moves between tasks

These moves connect a worktree to other work:

| Move                          | What it does                                                               | In the recipe app                                                       |
| ----------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Update**                    | Brings the latest trunk into a worktree.                                   | The layout change lands, and the search agent brings it into its copy.  |
| **Build on work in progress** | Starts a task from another task's branch, or brings that branch into one.  | A task that writes help pages for search starts from the search branch. |
| **Land**                      | Checks the Proof and permission, then moves the trunk to what was checked. | `main` gets the search you approved.                                    |

Your agent runs these with `discern update`, `discern start --from` or `discern update --from`, and `discern accept`. You don't need to run them yourself. Each result tells the agent what to do next. For example, when an update brings in new work, discern lists the files both sides changed, so the agent knows what to re-read.

When one task needs another's work, the agent can [wait for it](../10-guides/wait-for-another-task.md). You don't have to tell it when the other task is ready.

## When other work lands first

Say the layout change lands while search waits for your review. That doesn't send search back to the start.

When search lands, discern combines it with the new `main` in a temporary copy, called an **integration worktree**. It runs the checks on the combined code and lands exactly what passed. If the two changes conflict, or the combined checks fail, nothing lands. The search agent gets the files or the failing check. It brings the new `main` into its worktree, fixes the problem, and tries again.

While the agent is still working, it keeps up with `main` itself. Before it runs the checks, `discern done` asks it to bring in any work that has landed since the task started. [Finish and land a change](../10-guides/finish-and-land-a-change.md#when-other-work-lands-first) shows what this looks like when you review.

## What separate copies can't catch

Worktrees keep files apart. They can't make two features agree.

Search might put a search box at the top of the recipe list. The layout task might put a menu in the same spot. Each works in its own copy, and the combined code might pass every check. You still need to see the two together.

discern points you to the likely clashes. In the main checkout, `discern status` shows your fleet, all the tasks in progress, and flags tasks that changed the same files. `discern update` names the files both sides touched, so the agent can check how they fit together.

Your project decides what else gets its own copy. A test database set up for each worktree keeps test data apart. A shared service that isn't part of that setup stays shared.

discern isn't a sandbox around your agent. Your agent's own permission settings decide what it can read and run on your machine.

## After a change lands

When search lands, discern removes its worktree, its branch, and anything set up for it. If the worktree stays, the result says why: the branch has newer commits that haven't landed, or cleanup couldn't finish. [Finish and land a change](../10-guides/finish-and-land-a-change.md#after-it-lands) covers both.

To set a task aside for longer, your agent can **park** it. discern removes the worktree but keeps the branch, its commits, and the task's description, so the work can pick up later. [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md#park-a-task-you-will-return-to) explains when to park. [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) helps when a session or command stops partway.

To run several tasks at once, follow [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md). The [worktrees and status reference](../30-reference/worktrees-and-status.md) lists every field.
