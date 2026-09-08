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
---

# Coordinate parallel tasks

You can improve several parts of a project at once without turning every handover into another job for you. Each separate task gets a worktree: its own workspace and branch. discern can tell dependent agents when the work they need is ready.

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

Separate files are only part of a working environment. Two copies of an app may also need different development-server ports or test databases. Otherwise, one task's test could change the data another task is using.

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

Each task finishes through `discern_done`, which runs the project's configured checks, called the gate. It records [Proof](../20-understand/proof.md) for the validated candidate—the committed change proposed for landing, which may include earlier ready work. Follow the completion result's next action; it distinguishes evidence, pending work, and permission to land.

## Compose dependent work below the trunk

Sometimes a later task needs a finished feature before you are ready to add it to the shared branch. The help writer might need to try search while you are still reviewing it.

Ask for that arrangement directly:

> Let the help task build on the search task once it has current Proof. Keep the combined work available for review, and explain which approvals are still needed before it lands.

The earlier agent commits its work and runs the gate. The dependent agent uses `discern_await` to wait for current Proof, then follows the returned instruction to start from or update from the observed commit. That exact commit remains usable even if the earlier branch name later disappears.

The later agent verifies that the expected behavior is present and runs the full gate on the combined result. Starting from a checked change does not establish that the combination passes. Landing also checks permission for the included work; approving the last task does not approve its predecessors.

[Wait for another task](wait-for-another-task.md) explains the choice between building on checked work and waiting for it to land.

## Share limited test capacity

Several agents can write at once while their full test runs take turns. This helps when tests compete for memory, processors, or a limited local service.

Ask your agent to recommend a cap appropriate to the project. For example, this setting allows two test runs at once:

```toml
[gate]
concurrent_test_runs = 2
```

The cap applies across the repository's worktrees. discern queues its test-stage work and relevant measurements; agents run direct test commands through `discern queue -- <test-command>`. A test runner still controls how many workers it uses inside its own run, so the cap is not a limit on individual test processes.

## Coordinate several repositories

If the app and a shared library live in different repositories, each repository has its own configuration, worktrees, checks, and landing decisions. Ask the agent to name the commit or package version that connects the tasks and explain how it will test them together.

There is no single Proof or landing permission covering both repositories. You can still direct the overall result from one plan, with each part's evidence kept clear.

## Reclaim finished or stale worktrees safely

Successful completion normally releases a checkout from authoring control. discern may use eligible released checkouts for validation and remove them after landing. If further edits are planned, the agent can use `discern done --retain-checkout` to keep authoring control.

For workspaces left behind, ask your agent to inspect what can be reclaimed and show the removal plan. The command-line preview from the main checkout is:

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

You should be able to tell what each task delivers, which result it depends on, and what comes back for your review. The agents carry the workspace setup, waits, updates, and checks. Use [Finish and land a change](finish-and-land-a-change.md) to review the outcomes and follow what reaches the shared branch.

For more detail, [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains the model, [worktrees and status](../30-reference/worktrees-and-status.md) lists the fields, and [worktree recovery](../40-troubleshooting/worktrees-and-resources.md) covers interrupted setup or cleanup.
