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

Several agents can work at once, each in its own copy of your project, so their edits, test data, and running apps stay apart. discern tells a waiting agent when the work it needs is ready, and shows you which tasks need your decision instead of making you check every session.

## Start each task in its own worktree

Say you've agreed a plan for your reading-list app: one task adds search, one improves the phone layout, and one writes help pages that describe search. [Delegate substantial work](delegate-work.md) covers splitting work like this. Ask your agent:

> "Start the tasks we agreed, each in its own worktree, and have the help task wait for search."

From your main checkout, your original project folder, your agent runs `discern start` once per task. Each run creates a **worktree**, a separate copy of the project on its own branch, where the agent makes that task's edits:

```sh
discern start --name reading-search
```

Each worktree stays with its task until it lands or you drop it, so an agent resumes its own after a break and never takes over another's, even an idle one.

## Keep running apps apart too

Separate files aren't enough when your app runs a development server or uses a test database: one task's tests could change data another's are reading.

So each worktree gets its own port. If your project declares **resources**, such as a test database, discern creates one for each worktree and removes it when the worktree goes, so you don't pick ports or script database setup yourself. Ask:

> "Check that these tasks can run the app and its tests side by side."

If a resource fails to start, your agent follows the recovery discern reports. The [configuration reference](../30-reference/config-reference.md#worktreeresourcesname) lists the resource settings.

## See what the fleet is doing

The **fleet** is all your task worktrees. Ask:

> "Which tasks are moving, which are waiting, and which need my decision? Do any two change the same files?"

To see it yourself, run `discern status` in your main checkout. It lists each task with its changes, whether it may land, and its **Proof**: discern's record of which of your project's commands, such as its tests and linter, passed on one exact commit. It also flags files two tasks both change:

```text
- `agent/reading-search-b41f2c`: clean, 1 ahead, 0 behind, Proof `honored`.
- `agent/reading-help-6aec33`: clean, 1 ahead, 0 behind, Proof `missing`.
- `agent/reading-layout-47c1fb`: clean, 1 ahead, 0 behind, Proof `missing`.
- Cross-worktree collisions: 1.
- Note 1 worktree pair changing the same files: agent/reading-layout-47c1fb ↔ agent/reading-search-b41f2c. Both sides may merge cleanly and still conflict semantically. …
```

Search has Proof, and the other tasks don't yet. Search and the phone layout both change the reading-list screen, so ask your agent whether the changes fit together, need an order, or belong in one task.

`discern enter` opens a shell in any worktree, at the same place in the project you're in now.

## Decide from the desk

The **desk** is the interactive view that opens when you run `discern` in your main checkout. It shows which tasks need your decision and keeps itself up to date, so you can leave it open instead of asking each agent how it's going.

```sh
discern
```

Tasks stay in title order, so rows don't jump as work changes. Each row shows what the task is doing and its Proof, and an `i` marks one that changes files another task changes too. Select a task for its main choices:

| Choice                               | What it does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| **Proof and changes**                | Shows the Proof, changed files, and diff.             |
| **Start or resume agent**            | Opens your coding agent in the task's worktree.       |
| **Pre-authorize landing once green** | Lets the task land once its checks pass.              |
| **Accept and land now**              | Lands the checked commit.                             |
| **Join the landing queue**           | Queues the checked commit without starting a landing. |
| **Drop**                             | Discards the task after you confirm.                  |

**More actions** holds the rest, and the [desk actions reference](../30-reference/worktrees-and-status.md#desk-actions) lists every action. An action that can't run yet is marked unavailable and says why. Before an action changes anything, the desk shows its plan, and discern checks the task again when you confirm. The desk also shows one tip suited to your project each time it opens.

## Keep each task up to date

Each landing moves the **trunk**, your shared branch (usually `main`), so your agent brings the new work into each unfinished task with `discern update`. The result lists files both changes touched, which your agent rereads, because edits can merge cleanly and still clash: search might add a button the phone layout has no room for.

Each task finishes with `discern done`, which runs the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. A pass records [Proof](../10-understand/proof.md) for that commit but isn't permission to land.

## Understand the landing queue

A task that passed its checks joins the **landing queue** when its agent submits it with `discern accept`, or when you queue it from the desk. The queue holds that exact commit and its Proof, so later edits can't change what waits to land. Any new commit makes that Proof stale, so the new version needs fresh checks and its own place in the queue.

On the desk, a task can read:

```text
Proof valid · Authorized · Not queued
```

It passed, you approved it, and nobody has asked to land it yet, because pre-authorizing doesn't queue a task. [Pre-approve routine work](finish-and-land-a-change.md#pre-approve-routine-work) explains how long that permission lasts.

`discern status` and the desk show the queue: pre-authorized tasks first, in the order you granted them, then the rest in submission order. A task that can't land yet says why:

| Why it waits                                | What happens next                                     |
| ------------------------------------------- | ----------------------------------------------------- |
| It needs your decision.                     | You approve it, pre-authorize it, or leave it.        |
| Its branch has new commits.                 | Its agent runs `discern done`, then `discern accept`. |
| A landing is checking its combined code.    | Nothing.                                              |
| Its combined code raised a review question. | Its agent runs `discern accept` again to answer it.   |

Newer work on `main` isn't a reason to wait: discern checks the combined code when the task lands, as [When other work lands first](finish-and-land-a-change.md#when-other-work-lands-first) describes.

You don't have to land tasks in the order they finished, and a task waiting for you doesn't hold up one you've approved. Once you land one from the desk or your main checkout, discern tries the other queued tasks in order, each under its own permission, and stops at the first that still needs you.

Some decisions always wait for you, whatever you've pre-approved:

- landing with an unmet **checkpoint**, a review question your agent answers when a change touches certain files;
- a looser limit for a **standard**, one of your project's measured limits;
- an emergency landing.

[Checkpoints](../10-understand/checkpoints.md) explains unmet answers.

## Build on work before it lands

The help pages should describe search while you're still reviewing it. When you ask for that, the help task's agent [waits for search's Proof](wait-for-another-task.md), brings in the exact commit that passed, and runs the gate on the combined code. So the help work starts before search lands, and you never tell one agent that the other is ready. Each task still needs its own permission to land. The help task contains search's code, so landing it first lands search too. Land search first, or review both and land them as one change from the help task.

## Share limited capacity

The `[gate].concurrent_test_runs` setting limits how many test runs go at once, so parallel agents don't overload your machine. A new project allows one, and `0` removes the limit. A test run over the limit waits its turn while other checks carry on, then starts by itself, so nothing needs fixing. Raise the limit only if your machine can handle another run.

Agents run their own test commands through `discern queue -- <test-command>`, so those runs share the limit too. A test runner still decides how many workers it uses inside one run.

## Coordinate several repositories

If the app and a shared library live in different repositories, each keeps its own configuration, worktrees, checks, Proof, and landing decisions, so no single Proof or permission covers both. Ask your agent to name the commit or package version that connects the tasks, and how it'll test them together.

## Clean up finished worktrees

When a task lands, discern removes its worktree, resources, and branch. If anything stays, the landing result says why, and [After it lands](finish-and-land-a-change.md#after-it-lands) lists the reasons.

For anything else left behind, ask your agent what can be removed. It starts with a preview that changes nothing:

```sh
discern worktree prune --dry-run
```

Cleanup keeps anything it can't account for and says why. When a later task's branch already holds all of an earlier task's work, discern can offer to **reclaim** the earlier task: it removes that worktree and keeps its branch as a way back.

## Park a task you will return to

Parking frees a task's worktree and resources, and keeps its branch, committed work, title, and brief. To pause a task for a while, ask:

> "Park the phone layout task for now, and show me the plan first."

Your agent previews it with `discern worktree park <task> --dry-run`. Parking also removes the task's Proof, permission to land, and place in the queue. It refuses a worktree that has uncommitted changes, isn't on its own task branch, didn't finish setup, or can't be read, and it has no force option, so your agent commits what you want to keep first.

Afterwards, `discern status` lists the branch under **Work without a worktree**. To resume, choose **Resume** for that branch on the desk, or have your agent run `discern start --from <parked-branch>`.

## You're done when

You can tell what each task delivers, what it waits for, and whether it's queued, while agents handle worktrees, waits, and checks. A task that passed its checks is ready for review, and it isn't on `main` until it lands.

[Finish and land a change](finish-and-land-a-change.md) covers review and landing, and [Worktrees and resources](../40-troubleshooting/worktrees-and-resources.md) helps when setup or cleanup stops partway.
