---
id: guide-wait-for-another-task
title: "Wait for another task"
description: "Let an agent carry on as soon as the work it needs from another task is ready, without you passing messages between them."
order: 70
publish: true
kind: guide
aliases:
  - "guide-wait-for-another-task"
  - "Awaiting the fleet"
  - "await a sibling"
  - "wait for a branch"
  - "fleet coordination"
---

# Wait for another task

When one task needs another task's result, its agent can wait for that result by itself and carry on as soon as the work is there. You don't have to watch both sessions, or tell the second agent when the first one is ready.

## Ask for the handoff you want

Say one agent is adding search to your reading-list app, and another is writing help pages that describe search, so the help needs search's code first. Tell the help task's agent what it needs, and when it can use it:

> "Write the help pages once search has passed its checks. Bring in the search work and try it before you start writing."

Your agent follows discern's `discern-await-the-fleet` **skill**, a ready-made procedure for waiting on another task. To be sure it does, name the skill in your request.

If you have the search task's branch or worktree path, include it, because tasks can share a title, and a title alone may not pick out the right one. Without a branch or path, your agent looks up the exact task with `discern status`.

If search is already ready, the wait ends straight away, so you can make the request without first checking on search.

The help agent waits in its own **worktree**, a separate copy of the project on its own branch. If its task hasn't started yet, it waits in your main checkout and creates its worktree once search is ready.

## Choose what to wait for

The main choice is whether to build on checked work now, or to wait until it has landed on your shared branch. A task is **green** when it has current **Proof**, discern's record of which of your project's commands, such as its tests and linter, passed on exactly which commit.

| What you want                           | The agent waits for                                                                           | Choose it when                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| "Use search once it has current Proof." | **Green:** search has current Proof, or has already landed.                                   | The help can start while you review search.     |
| "Use search after it lands."            | **Landed:** search's work is on the **trunk**, your project's shared branch (usually `main`). | You want to build only on work you've accepted. |
| "Carry on when anything lands."         | **Trunk moved:** the trunk changed after the wait began.                                      | Any new work on `main` matters, whoever did it. |

Green isn't landed. A green search task is ready to build on, but its Proof doesn't give it permission to land, so that decision still waits for you, or for permission you set up earlier. [Proof](../10-understand/proof.md) explains the difference.

## What the agent runs

You don't need to run anything yourself. Your agent calls the `discern_await` tool with one condition, and on the command line the same wait looks like this:

```sh
discern await --green agent/reading-search-b41f2c
```

The other conditions are `--landed <task>` and `--trunk-moved`. Your agent can name a task by its worktree id, path, or branch. A landed wait also counts search when discern combined it with other work as it landed, so the commit on `main` may differ from search's last commit. The [CLI reference](../30-reference/cli-reference.md#discern-await) lists every option.

Your agent doesn't set a time limit. discern holds the call as long as the agent's tool connection reliably allows, up to 55 minutes, depending on the coding agent, so you don't need to give it a delay or ask it to check again every few minutes.

## Keep a long wait going

If the call ends before search is ready, the result says so and gives your agent a short **resume handle**. Your agent calls again with that handle, and the wait carries on where it left off, still noticing a change that happened between the two calls. It keeps going until search is ready, you tell it to stop, or the help task no longer needs search, so a long-running search task doesn't need reminders from you.

## Bring in what arrived

When search is ready, the result tells your agent how to bring the work into its own task:

```text
`agent/reading-search-b41f2c` is green — its worktree holds valid Proof. Build on it with `discern update --from 24ffe2d0b6716fe466cace4df4f3aa919c1c0547`. The immutable commit remains valid if acceptance deletes the branch.
```

- **Green, before landing:** your agent starts from, or updates to, the exact commit that passed, with `discern start --from <commit>` or `discern update --from <commit>`. That commit stays usable even if the search branch is later removed.
- **Landed, or trunk moved:** your agent starts from the trunk, or brings the trunk into its worktree with `discern update`.

Then your agent checks what it received. Here, it tries search before writing about it, because the wait only tells it that the work has arrived. Trying it shows whether search does what the help will describe.

`discern update` names any files both tasks changed, and your agent reads those again, because separate agents can each make sensible changes that need adjusting once combined. The help task then finishes as usual, with the gate, your review, and its own permission to land.

## Handle a refusal

A refusal means discern can't answer the wait as asked, and unlike an unfinished wait, it can't be resumed. The result says why and what to do instead, and your agent follows it or explains what it can't resolve. For example:

- A green wait needs a worktree that can hold current Proof. If the search worktree was reclaimed because a later task already holds its work, the result points to that later task, or suggests waiting for the landing instead.
- A mistyped or unclear task name needs correcting, and the result asks for an exact path or branch.
- If search has already landed and its branch is gone, a landed wait given search's exact branch name still finds it, because discern reads the **Proof note**, the copy of search's Proof it attached to the landed commit on `main`.

You can ask:

> "Explain why this wait can't continue, where the search work is now, and which next step still fits our plan."

## When not to wait

Use this for tasks in the same project that depend on each other. It doesn't wait for a review decision, a release, or helpers inside the agent's own session. An agent doesn't wait for its own task to pass its checks either: it keeps working on it instead.

If the plan changes, tell your agent the help task no longer needs search. Ending a wait is safe, because it doesn't change either task's code. Whether your message interrupts a running call straight away depends on your coding agent.

[Coordinate parallel tasks](coordinate-parallel-tasks.md) shows how waits fit a larger plan, and [MCP and results](../30-reference/mcp-and-results.md#call-duration-and-continuation) has the exact time limits and result fields.
