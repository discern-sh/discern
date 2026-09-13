---
id: guide-coordinate-parallel-tasks
title: "Coordinate parallel tasks"
description: "Keep several tasks moving, understand their dependencies, and bring their results together."
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
---

# Coordinate parallel tasks

You can improve several parts of a project at once without turning every handover into another job for you. Each separate task gets a worktree: its own workspace and branch. discern keeps the finished tasks that are waiting to land in one list, tells dependent agents when the work they need is ready, and explains any wait in one sentence.

This guide follows the work after you have agreed a task plan. If you are still deciding how to divide an idea, start with [Delegate substantial work](delegate-work.md).

## Starting state

Suppose you are improving an app that keeps a reading list. One task adds search, another improves the phone layout, and a third updates the help. Your agent has checked which files they touch and proposed how to handle anything shared.

You can ask:

> Start the agreed reading-list tasks in their own worktrees. Have the help task wait for the search result it needs. Keep track of where each task is working, and explain any decisions that need me.

Your project should already be set up with discern. If it uses a local database or similar service, the agent also checks that each worktree can have the separate resources it needs.

## Start one worktree per task

Your agent uses `discern_start` from the main checkout and moves each task into the path the result returns. The command-line equivalent for one task is:

```sh
discern start --name reading-search
```

The name helps you recognize the work; discern adds a unique suffix. The returned branch and absolute path identify the actual task. A second independent task gets a different worktree. Helpers working under one coordinating agent can share that agent's effort, with their file assignments kept separate.

Keep each effort in its worktree through review and resumed sessions. An idle or clean worktree still belongs to its existing task. If a task cannot start, its result explains what needs attention; the agent should resolve that condition rather than move into another task's workspace.

## Confirm isolation beyond the checkout

Separate files are only part of a working environment. Each copy of an app may need its own development-server port or test database. Otherwise, one task's test could change the data another task is using.

discern prepares the resources declared for each worktree. Your agent can inspect them with `discern identity --resources` and use their returned values. You can ask it to check this without choosing port numbers or writing database setup commands yourself:

> Check that these tasks can run the app and its tests side by side. Tell me if any shared service still needs a decision or setup from me.

If a required resource fails to start, discern leaves the unfinished setup visible and reports the failed command. The agent follows that recovery before continuing. The [configuration reference](../30-reference/config-reference.md) contains the resource and environment settings.

## Inspect and open the fleet

The **fleet** is the set of task worktrees in the repository. Ask your agent for an account of what is moving and what needs you:

> Check the fleet. Tell me which tasks are progressing, which are waiting on another task, and which need my decision. Explain any overlap that could change our plan.

For a direct view, run this from the main checkout:

```sh
discern status
```

From inside a task, `discern status --all` includes the fleet. It reports worktree state and files changed by more than one task; it does not need to infer progress from chat summaries. Bare `discern` opens the [desk](delegate-work.md#inspect-decisions-from-the-desk) in an interactive terminal. `discern enter` opens a child shell in a selected worktree when you want to inspect it yourself.

Treat file overlap as a reason to look closer. Search and the phone layout might both change the reading-list screen. The agent should explain whether the changes fit together, need an agreed order, or are better handled by one task.

## Keep independent streams current

When an earlier change lands on the **trunk**, the shared branch usually called `main`, other tasks can bring it into their own worktrees with `discern_update`:

```sh
discern update
```

The result names overlapping files for the agent to re-read. Git may combine two edits successfully even when their behavior disagrees. For example, search could add a button that the phone layout has no room for. Trying the combined screen is how you catch that problem.

Each task finishes through `discern_done` on its committed work. That runs the project's configured checks, called the gate, and records [Proof](../20-understand/proof.md) for the exact commit in the worktree. Follow the completion result's next action; it distinguishes evidence, pending work, and permission to land.

## Understand the landing queue

A finished task enters the landing queue when its agent submits it with `discern accept`. The **submission** names the exact commit and the Proof that covers it, so nothing waits in the queue that its agent is still changing. `discern status` from the main checkout, the desk, and the acceptance preview all show the same list: tasks you have pre-authorized first, in the order you granted them, then tasks waiting for your decision, in the order they were submitted.

Each line names the task's branch and, when it cannot land yet, the reason:

| Why a task waits                           | What it means                                      | What happens next                                                              |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| It is waiting for your decision            | The submission has Proof, and no grant covers it.  | Approve it in conversation, pre-authorize it from the desk, or leave it.       |
| Its branch moved on after it was submitted | The agent committed more work after submitting.    | Its agent runs `discern done`, then `discern accept` for the new work.         |
| A landing is checking it now               | Its combined code is being proven before landing.  | Nothing; the line names the running landing's progress handle.                 |
| Its combined result awaits a judgment      | A checkpoint question fired about the composition. | Its agent re-runs `discern accept` to be served the question, then answers it. |

A submission the shared branch overtook does not wait on its author: its landing checks the combined version in a fresh integration worktree and lands the exact commit it proved, and its queue line says the composition is what landing will do. A task you pre-authorized lands with its agent's next `discern accept`. A task that failed its checks, or that its agent never submitted, is not in the list. Approving one task approves that task alone; if the help task depends on search, each needs its own permission.

You do not have to land tasks in the order they finished. Decide about each one when you are ready; a task waiting for you does not block an independent task you have approved. When you land a selected task with `discern accept --target`, the remaining submissions follow in the queue's own order, each under its own grant, and the walk stops at the first task that still needs you — the result reports every landing it attempted.

## Compose dependent work below the trunk

Sometimes a later task needs a finished feature before you are ready to add it to the shared branch. The help writer might need to try search while you are still reviewing it.

Ask for that arrangement directly:

> Let the help task build on the search task once it has current Proof. Keep the combined work available for review, and explain which approvals are still needed before it lands.

The earlier agent commits its work and runs the gate. The dependent agent uses `discern_await` to wait for current Proof, then follows the returned instruction to start from or update from the observed commit. That exact commit remains usable even if the earlier branch name later disappears.

The later agent verifies that the expected behavior is present and runs the full gate on the combined result. Starting from a checked change does not establish that the combination passes. Each task still lands through its own submission and permission: the search task lands first, and the help task's agent brings the landed trunk into its worktree before landing its own work.

[Wait for another task](wait-for-another-task.md) explains the choice between building on checked work and waiting for it to land.

## Share limited capacity

Several agents can write at once. How many can run the project's tests at the same time is bounded by `[gate].concurrent_test_runs`, the setting the project chose during setup. A test run that reaches the limit waits its turn while the other checks continue, and the result names the task holding the slot and how long its tests usually take.

That sentence is the fact to act on. Raise the limit only after checking that the machine can carry another run. Agents run direct test commands through `discern queue -- <test-command>` so parallel tasks share the cap. A test runner still controls how many workers it uses inside its own run.

## Coordinate several repositories

If the app and a shared library live in different repositories, each repository has its own configuration, worktrees, checks, and landing decisions. Ask the agent to name the commit or package version that connects the tasks and explain how it will test them together.

There is no single Proof or landing permission covering both repositories. You can still direct the overall result from one plan, with each part's evidence kept clear.

## Clean up finished or stale worktrees

A landing removes the task's worktree, its resources, and its branch when the branch holds nothing beyond what landed. When the worktree stays, the landing result and `discern status` say why in one sentence and name the command that finishes cleanup: `discern done` then `discern accept` for commits the agent added after submitting, or `discern worktree prune` when the removal could not complete.

For worktrees left behind, ask your agent to inspect what can be removed and show the plan. The command-line preview from the main checkout is:

```sh
discern worktree prune --dry-run
```

A preview lets you see the affected paths before removal. If cleanup reports files or ownership it cannot account for, follow the reported recovery. A completed landing remains landed even when its checkout cleanup needs attention.

An earlier stage fully included in a later live branch may be offered for reclaim. This removes the eligible checkout while keeping its branch as a route back to the committed work.

## Park a task you will return to

Parking keeps committed work and its task wording while freeing the checkout and its resources. It is useful when a task is paused for more than a short dependency wait:

> Park this task so we can return to it later. Show me the plan first, and make sure the work I want to keep is committed.

The preview is `discern worktree park <id-or-path> --dry-run`. Parking requires a clean checkout on a named task branch. Status then lists the branch under **Work without a worktree**. Your agent can resume it with `discern start --from <parked-branch>`; the resumed task needs fresh Proof and landing authority.

## Completion

You should be able to tell what each task delivers, which result it depends on, whether it is waiting in the landing queue, and what comes back for your review. The agents carry the workspace setup, waits, updates, and checks. Use [Finish and land a change](finish-and-land-a-change.md) to review the outcomes and follow what reaches the shared branch.

For more detail, [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains the model, [worktrees and status](../30-reference/worktrees-and-status.md) lists the fields, and [worktree recovery](../40-troubleshooting/worktrees-and-resources.md) covers interrupted setup or cleanup.
