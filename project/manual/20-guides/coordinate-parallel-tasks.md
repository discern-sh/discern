---
id: guide-coordinate-parallel-tasks
title: "Coordinate parallel tasks"
description: "Keep several agents working at once, see which tasks need your decision, and land their results in the order you choose."
order: 60
publish: true
kind: guide
aliases:
  - "guide-coordinate-parallel-tasks"
  - "The fleet test-run cap"
  - "concurrent_test_runs"
  - "test slots"
  - "fleet test-run cap"
  - "Per-worktree resources"
  - "worktree resources"
  - "resource lifecycle"
  - "resource garbage collection"
  - "worktree database"
  - "Parallel and team work"
  - "team workflow"
  - "parallel agents"
  - "worktree fleet"
  - "Multi-repo workspaces"
  - "multi-repo work"
  - "polyrepo"
  - "workspace"
  - "local packages"
  - "submodules"
  - "Open another worktree"
  - "switch worktrees"
  - "worktree shell picker"
  - "landing queue"
  - "The desk"
  - "interactive worktree manager"
  - "fleet dashboard"
  - "worktree picker"
  - "desk tips"
  - "tip line"
---

# Coordinate parallel tasks

Several agents can improve your project at once, each in its own copy of the project, so their edits, test data, and development servers stay apart. discern tells a waiting agent when the work it needs is ready and shows you in one place which tasks need your decision, so you come back when a task needs you instead of checking on every session.

## Start each task in its own worktree

Say you've agreed a plan for your reading-list app: one task adds search, one improves the phone layout, and one writes help pages that describe search. If you're still deciding how to split the work, start with [Delegate substantial work](delegate-work.md). Ask your agent to start the tasks:

> "Start the reading-list tasks we agreed, each in its own worktree. Have the help task wait for search, keep track of where each task works, and tell me about any decision that needs me."

Your agent runs `discern start` once per task from your main checkout, your original project folder. Each run creates a **worktree**, a separate copy of the project on its own branch, and returns its path, and the agent moves into that path before it edits anything:

```sh
discern start --name reading-search
```

The name helps you recognize the task. discern adds a short suffix to keep it unique, so your agent uses the exact branch and path the command returns.

A worktree belongs to its task until the task lands or you drop it, even while it sits idle. An agent resumes its own worktree after a break and never takes over another task's. If a task can't start, the result says why, and the agent fixes that instead of borrowing another workspace.

## Keep running apps apart too

Separate files aren't enough when your app runs a development server or uses a test database, because two copies of the app can still collide: one task's tests could change data that another task's tests are reading.

Each worktree gets its own port number to run on. If your project declares **resources**, such as a test database, discern creates a separate one for each worktree and removes it when the worktree goes, so you don't pick ports or write database setup yourself. Ask:

> "Check that these tasks can run the app and its tests side by side. Tell me if any shared service still needs a decision or setup from me."

If a resource fails to start, discern reports the command that failed and marks setup as unfinished, and your agent follows the reported recovery before it continues. The [configuration reference](../30-reference/config-reference.md) lists the resource settings.

## See what the fleet is doing

The **fleet** is the set of task worktrees in your project. Ask for a summary:

> "Which tasks are moving, which are waiting on another task, and which need my decision? Point out any files that two tasks both change."

Your agent reads this from discern's own records of each worktree. For the same view yourself, run `discern status` in your main checkout. It lists each task with its changes, recent activity, whether it may land, and its **Proof**, discern's record of which of your project's commands, such as its tests and linter, passed on exactly which commit. It also flags files that more than one task changes:

```text
- `agent/reading-search-b41f2c`: clean, 1 ahead, 0 behind, Proof `honored`.
- `agent/reading-help-6aec33`: clean, 1 ahead, 0 behind, Proof `missing`.
- `agent/reading-layout-47c1fb`: clean, 1 ahead, 0 behind, Proof `missing`.
- Cross-worktree collisions: 1.
- Note 1 worktree pair changing the same files: agent/reading-layout-47c1fb ↔ agent/reading-search-b41f2c. Both sides may merge cleanly and still conflict semantically. …
```

Here, search has passed its checks and has a valid Proof, and the other tasks don't have Proof yet. Search and the phone layout both change the reading-list screen, so treat that shared file as a reason to look closer: your agent should explain whether the changes fit together, need an order, or belong in one task. Inside a task's worktree, `discern status --all` adds the fleet.

To look around a worktree yourself, `discern enter` opens a shell in it, at the same place in the project as you are now.

## Decide from the desk

The **desk** is the interactive view that opens when you run `discern` in your main checkout. It lists every task, shows which ones need a decision from you, and keeps itself up to date, so you can leave it open and come back when a task needs you instead of opening each agent's session to ask how it's going.

```sh
discern
```

Tasks stay in order by title, so rows don't jump around as work changes. Each row shows the task's title, what it's doing, and the state of its Proof. An `i` marks a task that changes files another task also changes, and **Task details** lists those files, with the task's branch and path.

Select a task to see its main choices:

| Choice                               | What it does                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| **Proof and changes**                | Shows the Proof, the changed files and commits, and the full diff.        |
| **Start or resume agent**            | Opens your coding agent in the task's worktree.                           |
| **Pre-authorize landing once green** | Lets the task land when its checks pass, without asking you again.        |
| **Accept and land now**              | Submits the checked commit and starts landing it.                         |
| **Join the landing queue**           | Adds the checked commit to the landing queue, without starting a landing. |
| **Drop**                             | Discards a task you've decided to abandon. It asks you to confirm first.  |

**More actions** holds the rest, such as recovery steps, the final checks, and cleanup. An action that can't run right now is marked unavailable, and picking it tells you why. The [desk actions reference](../30-reference/worktrees-and-status.md#desk-actions) lists every action and the command behind it.

Before an action changes anything, the desk shows you its plan. When you confirm, discern checks the task again, and if the action no longer fits, it says why and changes nothing. Each time you open the desk, it also shows one short tip about a feature that suits your project's current state.

### Choose how a checked task lands

The desk keeps three facts about each task separate: whether its checks passed, whether it may land, and whether it's in the landing queue. So a task can read:

```text
Proof valid · Authorized · Not queued
```

It passed, you approved it, and nobody has asked to land it yet.

- **Pre-authorize landing once green** records your permission for this task. discern asks `Allow <branch> to land once green without a further conversation?` The permission follows the task's branch, so it still covers the task after review fixes. Landing uses it up, you can revoke it from the desk, and it ends if the worktree is removed. Giving permission doesn't queue the task by itself.
- **Accept and land now** submits the checked commit and lands it. If another landing is running, it waits its turn, and if `main` has moved on, discern checks the combined code first and lands what passed. Afterwards, discern tries the other queued tasks in order, each under its own permission, and stops at the first one that still needs you.
- **Join the landing queue** records the checked commit and returns, running no checks and starting no landing. If the task has no permission yet, the desk asks whether to grant it. A landing that's already running, or the next one you start, picks it up.

The queue keeps the exact commit that joined it. If your agent commits more work later, the queue still holds the earlier commit, and because any new commit makes the old Proof stale, the new version needs fresh checks and its own place in the queue. No permission from the desk covers a change that falls short of one of your project's review questions (an unmet **checkpoint**) or raises one of its measured limits (a **standard**). Those wait for your explicit decision.

To join the queue from the command line, your agent runs `discern accept queue` in the task's worktree.

## Keep each task up to date

Each landing moves the **trunk**, your project's shared branch (usually `main`), so tasks still in progress bring in the new work with `discern update`:

```sh
discern update
```

The result lists files that both changes touched, and your agent reads those again, because edits can merge cleanly and still clash. Search might add a button that the phone layout has no room for, and trying the combined screen is how you catch that.

Each task finishes with `discern done`, which runs the **gate**, your project's required commands, such as its tests and linter, on the committed work. When they pass, discern records [Proof](../10-understand/proof.md) for that exact commit, and the result names the next step and whether landing needs your decision. A pass isn't permission to land.

## Understand the landing queue

A finished task joins the **landing queue** when its agent submits it with `discern accept`. The submission names the exact commit and its Proof, so later edits can't change what waits to land. `discern status`, the desk, and `discern accept --dry-run` all show the same list, in the same order: tasks you've pre-authorized come first, in the order you granted them, and tasks waiting for you follow, in the order they were submitted.

A task that can't land yet says why, in one sentence:

| Why it waits                           | What it means                                          | What happens next                                                        |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| It needs your decision.                | It has Proof, and nothing gives it permission to land. | Approve it in conversation, pre-authorize it from the desk, or leave it. |
| Its branch moved on.                   | Its agent committed more work after submitting.        | The agent runs `discern done`, then `discern accept`, for the new work.  |
| A landing is checking it.              | discern is checking its combined code right now.       | Nothing. The line names the run's progress handle.                       |
| Its combined code raised a checkpoint. | Combining it with newer work fired a review question.  | Its agent runs `discern accept` again to answer the question.            |

Newer work on `main` isn't a reason to wait, because discern checks the combined code when the task lands, as [When other work lands first](finish-and-land-a-change.md#when-other-work-lands-first) describes. A task whose checks failed, or that its agent never submitted, isn't in the queue.

You don't have to land tasks in the order they finished, and a task waiting for you doesn't hold up an independent task you've approved. When you land one task, either from the desk or by asking an agent in your main checkout, which runs `discern accept --target <task>`, discern then lands the other queued tasks in order. Each lands under its own permission, discern stops at the first one that still needs you, and the result lists every landing it tried.

## Build on work before it lands

Sometimes a later task needs a feature before you're ready to land it: the help pages should describe search while you're still reviewing search. Ask for that directly:

> "Let the help task build on search once search has passed its checks. Tell me which approvals each one still needs before it lands."

The search agent commits its work and runs the gate. The help task's agent [waits for search's Proof](wait-for-another-task.md), then starts from, or brings in, the exact commit that passed, which stays usable even if the search branch is later removed. So the help work starts while search waits for your review, and you never tell one agent that the other is ready.

The help task's agent checks that search works in its own copy, then runs the gate on the combined code, because search passing its own checks doesn't prove the combination passes.

Each task still needs its own permission. The help task contains search, so landing it first would land search's code too. Land search first, or review both together and land them as one change from the help task. If search lands first, discern checks the help task against the new `main` when the help task lands.

## Share limited capacity

Several agents can write code at once, and the `[gate].concurrent_test_runs` setting limits how many of them run tests at the same moment. A new project allows one, and `0` removes the limit. When the limit is reached, a test run waits its turn while the other checks carry on. Its result says the shared test capacity is in use, lists other runs that were active, and starts the tests on its own when a slot frees.

Nothing needs fixing while a run waits. Raise the limit only after checking that your machine can handle another run. When the limit is above zero, agents run their own test commands through `discern queue -- <test-command>`, so those runs share the limit too. A test runner still decides how many workers it uses inside one run.

## Coordinate several repositories

If the app and a shared library live in different repositories, each repository has its own configuration, worktrees, checks, and landing decisions. Ask your agent to name the commit or package version that connects the tasks, and to explain how it'll test them together.

No single Proof or permission covers both repositories. You can still direct the work from one plan, and each repository keeps its own evidence.

## Clean up finished worktrees

When a task lands, discern removes its worktree, its resources, and its branch, as long as the branch holds nothing beyond what landed. If anything stays, the first sentence of the landing result says why and names the command that finishes the job, and the change has landed either way. [After it lands](finish-and-land-a-change.md#after-it-lands) walks through each case.

For worktrees left behind for other reasons, ask your agent what can be removed and to show you the plan first. The preview, run from your main checkout, changes nothing:

```sh
discern worktree prune --dry-run
```

It lists the paths that would go. If cleanup finds files or ownership it can't account for, it keeps them and reports the recovery.

Sometimes a later task's branch already contains all the work of an earlier task. discern can then offer to **reclaim** the earlier task: it removes that checkout and keeps its branch as a way back to the committed work.

## Park a task you will return to

Parking frees a task's worktree and resources, and keeps its branch, committed work, title, and brief. Use it when a task is paused for longer than a short wait:

> "Park this task so we can come back to it later. Show me the plan first, and make sure the work I want to keep is committed."

The preview is `discern worktree park <task> --dry-run`, run from your main checkout. Parking needs a clean worktree on a task branch, and it also removes the task's Proof, its permission to land, and its place in the landing queue. Afterwards, `discern status` lists the branch under **Work without a worktree**. To resume, your agent runs `discern start --from <parked-branch>`, and the resumed task needs new Proof and fresh permission to land.

## You're done when

You can tell what each task delivers, which task it depends on, whether it's in the landing queue, and what comes back for your review. The agents handle the worktrees, the waits, the updates, and the checks. [Finish and land a change](finish-and-land-a-change.md) covers reviewing each result and following what reaches `main`.

For more, [Worktrees and trunk](../10-understand/worktrees-and-trunk.md) explains the model, [Worktrees and status](../30-reference/worktrees-and-status.md) lists every field, and [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers setup or cleanup that stopped partway.
