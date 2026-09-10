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
  - "hold a task"
  - "reorder landing"
  - "validation capacity"
  - "completion concurrency"
  - "lookahead"
  - "early validation"
---

# Coordinate parallel tasks

You can improve several parts of a project at once without turning every handover into another job for you. Each separate task gets a worktree: its own workspace and branch. discern lands finished tasks in a stable order, tells dependent agents when the work they need is ready, and explains any wait in one sentence.

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

Each task finishes through `discern_done` on its committed work. That runs the project's configured checks, called the gate, and records [Proof](../20-understand/proof.md) for the version that would land. Follow the completion result's next action; it distinguishes evidence, pending work, and permission to land.

## Understand the landing order

Finished tasks form a queue. Each one waits for its own Proof and your approval, and discern lands the approved ones in a stable order. That order is not the order the tasks finished, and it does not change every time another task becomes ready.

The queue explains three situations that look alike:

- **A task builds on another.** The help task was started from the search task's work, so search must land first. discern records that relationship and will not land the help task ahead of it, whatever else you approve.
- **You chose an order.** You asked for the phone layout to land before search so you could review the combined screen. The plan keeps that order until you change it.
- **Two tasks touch the same files.** Neither depends on the other, but the second to land has to take in the first. That is a re-check, not a block.

Approving a task approves that task alone. If the help task lands after search, your approval of the help task does not approve search; search needs its own.

You can change the plan without discarding any work. Ask your agent to hold a task, resume it, take it out of the plan, or reorder the approved tasks. Every change starts with a preview you can read, and the agent applies it only after you confirm:

> Hold the phone-layout task until I've tried the search results with the new layout. Show me the plan before and after.

A held task keeps its evidence and its approval; independent tasks land past it. Taking a task out of the plan keeps its worktree and branch. None of these decisions run any checks.

## Compose dependent work below the trunk

Sometimes a later task needs a finished feature before you are ready to add it to the shared branch. The help writer might need to try search while you are still reviewing it.

Ask for that arrangement directly:

> Let the help task build on the search task once it has current Proof. Keep the combined work available for review, and explain which approvals are still needed before it lands.

The earlier agent commits its work and runs the gate. The dependent agent uses `discern_await` to wait for current Proof, then follows the returned instruction to start from or update from the observed commit. That exact commit remains usable even if the earlier branch name later disappears.

The later agent verifies that the expected behavior is present and runs the full gate on the combined result. Starting from a checked change does not establish that the combination passes. Landing also checks permission for the included work; approving the last task does not approve its predecessors.

[Wait for another task](wait-for-another-task.md) explains the choice between building on checked work and waiting for it to land.

## Share limited capacity

Several agents can write at once. How many can run the project's full checks at the same time is bounded by settings the project chose during setup. Three of them matter here, and they bound different work, so they can legitimately hold different values:

| Setting                        | What it bounds                                                          | What you see at the limit                                                        |
| ------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `[completion].concurrency`     | How many tasks can run their full checks at once.                       | A later `discern done` waits for a slot.                                         |
| `[gate].concurrent_test_runs`  | How many test runs can share this machine at once.                      | The test stage waits its turn; the other checks continue.                        |
| `[execution.<name>].capacity`  | How many workspaces can be prepared for a commit other than their own.  | Early validation waits for a workspace to come back.                             |

When a task waits, the result says which setting is binding, who holds the slots, and what will release them. That sentence is the fact to act on. Ask your agent to explain a wait in terms of the tasks you know, and raise a limit only after checking that the machine can carry the extra run.

By default, discern validates each task on its own commit and lands the tasks in turn. A fourth setting, `[completion].lookahead`, lets a task validate against work that has not landed yet, so it can land the moment its predecessor does. That costs a prepare-and-restore round trip per task and only runs when the project has declared, and setup has proved, an environment that can be prepared for another commit and returned exactly. Until then the setting is inert and `discern doctor` says so. [Configuration reference](../30-reference/config-reference.md#completion) lists the keys.

Agents run direct test commands through `discern queue -- <test-command>` so parallel tasks share the test cap. A test runner still controls how many workers it uses inside its own run.

## Coordinate several repositories

If the app and a shared library live in different repositories, each repository has its own configuration, worktrees, checks, and landing decisions. Ask the agent to name the commit or package version that connects the tasks and explain how it will test them together.

There is no single Proof or landing permission covering both repositories. You can still direct the overall result from one plan, with each part's evidence kept clear.

## Reclaim finished or stale worktrees safely

Successful completion normally releases a checkout from authoring control. discern may use eligible released checkouts for validation and remove them after landing. If further edits are planned, the agent can use `discern done --retain-checkout` to keep authoring control, then `discern done --release-checkout` when review is over.

A landed task's workspace sometimes stays. The landing result and status say why in one sentence and name the command that finishes cleanup; the common reason is a workspace that was retained for review and never released. A task whose work reached the shared branch by another route can also leave a stale entry in the queue; its own row offers to withdraw the entry or reconcile it, and neither lands anything again.

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

You should be able to tell what each task delivers, which result it depends on, where it sits in the landing order, and what comes back for your review. The agents carry the workspace setup, waits, updates, and checks. Use [Finish and land a change](finish-and-land-a-change.md) to review the outcomes and follow what reaches the shared branch.

For more detail, [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains the model, [worktrees and status](../30-reference/worktrees-and-status.md) lists the fields, and [worktree recovery](../40-troubleshooting/worktrees-and-resources.md) covers interrupted setup or cleanup.
