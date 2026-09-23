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

When one agent's task needs another agent's result, it can wait for that result by itself. You don't have to watch both sessions, or tell the second agent when the first one is ready. It carries on as soon as the work it needs is there.

This guide uses a reading-list app, where one agent is adding search. Another agent is writing help pages that describe search, so it needs search's code first.

## Ask for the handover you want

Tell the waiting agent what it needs, and when it can use it:

> Write the help pages once the search task has current Proof. Use discern-await-the-fleet to wait for it, bring in its work, and check that search works before you start writing.

**Proof** is discern's record of which of your project's checks passed, on exactly which commit. `discern-await-the-fleet` is a **skill**: a ready-made procedure your agent follows for the wait.

If you have the search task's branch or worktree path, include it. Tasks can share a title, so a title alone may not pick out the right one. Without a branch or path, the agent looks up the exact task with `discern status`.

If search is already ready, the wait ends straight away. So you can make the request without first checking on the search task.

The help agent waits in its own **worktree**, a separate copy of the project on its own branch. If its task hasn't started yet, it waits in your main checkout and creates its worktree once search is ready.

## Choose what to wait for

The main choice is whether to build on checked work now, or to wait until it has landed on your shared branch.

| What you want                           | The agent waits for                                                                           | Choose it when                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| "Use search once it has current Proof." | **Green:** search has current Proof, or has already landed.                                   | The help can start while you review search.     |
| "Use search after it lands."            | **Landed:** search's work is on the **trunk**, your project's shared branch (usually `main`). | You want to build only on work you've accepted. |
| "Carry on when anything lands."         | **Trunk moved:** the trunk changed after the wait began.                                      | Any new work on `main` matters, whoever did it. |

Green isn't landed. A green search task is ready to build on, but its Proof doesn't give it permission to land. That decision still waits for you, or for a grant you set up earlier. [Proof](../20-understand/proof.md) explains the difference.

## What the agent runs

You don't need to run anything yourself. Your agent calls the `discern_await` tool with one condition. On the command line, the same wait looks like this:

```sh
discern await --green agent/reading-search-b41f2c
```

The other conditions are `--landed <task>` and `--trunk-moved`. The agent can name a task by its worktree id, path, or branch. A landed wait also counts search when discern combined it with other work as it landed, so the commit on `main` may differ from search's last commit. The [CLI reference](../30-reference/cli-reference.md#discern-await) lists every option.

The agent doesn't set a time limit. discern then holds the call as long as the agent's tool connection reliably allows, up to 55 minutes, depending on the coding agent. You don't need to give it a delay, or ask it to check again every few minutes.

## Keep a long wait going

If the call ends before search is ready, the result says so and gives the agent a short **resume handle**. The agent calls again with that handle, and the wait carries on where it left off. It still notices a change that happened between the two calls. The agent keeps going until search is ready, you tell it to stop, or the help task no longer needs search.

So a long-running search task doesn't need reminders from you.

## Bring in what arrived

When search is ready, the result tells the agent how to bring the work into its own task:

- **Green, before landing:** the agent starts from, or updates to, the exact commit that passed, with `discern start --from <commit>` or `discern update --from <commit>`. That commit stays usable even if the search branch is later removed.
- **Landed, or trunk moved:** the agent starts from the trunk, or brings the trunk into its worktree with `discern update`.

Then the agent checks what it received. Here, it tries search before writing about it. The wait tells the agent that the work has arrived. Only trying it shows that search does what the help will describe.

`discern update` names any files both tasks changed, and the agent reads those again. Separate agents can each make sensible changes that need adjusting once combined. The help task then finishes as usual, with the gate, your review, and its own permission to land.

## Handle a refusal

A refusal means discern can't answer the wait as asked. Unlike an unfinished wait, it can't be resumed. The result says why and what to do instead, and the agent follows it or explains what it can't resolve. For example:

- A green wait needs a worktree that can hold current Proof. If the search worktree was reclaimed because a later task already holds its work, the result points to that later task, or suggests waiting for the landing instead.
- A mistyped or unclear task name needs correcting. The result asks for an exact path or branch.
- If search has already landed and its branch is gone, a landed wait given search's exact branch name still finds it. discern reads the Proof note it recorded on `main` when search landed.

You can ask:

> Explain why this wait can't continue, where the search work is now, and which next step still fits our plan.

## When not to wait

Use this for tasks in the same project that depend on each other. It doesn't wait for a review decision, a release, or helpers inside the agent's own session. An agent doesn't wait for its own task to pass its checks. It keeps working on it instead.

If the plan changes, tell the agent the help task no longer needs search. Ending a wait is safe, because it doesn't change either task's code. Whether your message interrupts a running call straight away depends on your coding agent.

[Coordinate parallel tasks](coordinate-parallel-tasks.md) shows how waits fit a larger plan, and [MCP and results](../30-reference/mcp-and-results.md#call-duration-and-continuation) has the exact time limits and result fields.
