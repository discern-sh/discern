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

When one task needs another's result, its agent waits for it and carries on as soon as it's ready. You don't have to watch both sessions or pass messages between them.

## Ask for the handoff you want

Say one agent is adding search to your reading-list app while another writes help pages that describe it. Ask the help task's agent:

> "Write the help pages once search has passed its checks. Bring in the search work and try it before you start writing."

Your agent follows discern's `discern-await-the-fleet` **skill**, a playbook for this job. Name it in your request to be sure. Give the search task's branch or path if you have one, because tasks can share a title. If search is already ready, the wait ends straight away, so you don't need to check first.

## Choose what to wait for

A task is **green** when it has current **Proof**: discern's record of which of your project's commands, such as its tests and linter, passed on one exact commit.

| What you want                           | The agent waits for                                                                 | Choose it when                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| "Use search once it has current Proof." | **Green:** search has current Proof, or has landed.                                 | The help can start while you review search.     |
| "Use search after it lands."            | **Landed:** search's work is on the **trunk**, your shared branch (usually `main`). | You want to build only on work you've accepted. |
| "Carry on when anything lands."         | **Trunk moved:** the trunk changed after the wait began.                            | Any new work on `main` matters.                 |

Green isn't landed: search's Proof doesn't give it permission to land, so that decision still waits for you, or for permission you set up earlier.

## What the agent runs

You don't need to run anything yourself. Your agent calls the `discern_await` tool with one condition. On the command line, the same wait looks like this:

```sh
discern await --green agent/reading-search-b41f2c
```

The [CLI reference](../30-reference/cli-reference.md#discern-await) lists the other conditions and options. discern holds each call as long as your coding agent's connection reliably allows, up to 55 minutes, so you don't need to set a delay or ask your agent to check back.

## Keep a long wait going

If the call ends before search is ready, the result gives your agent a short **resume handle**. The agent calls again with it, and the wait carries on, still noticing any change between calls. It keeps going until search is ready, you tell it to stop, or the help task no longer needs search.

## Bring in what arrived

When search is ready, the result tells your agent how to bring the work in:

```text
`agent/reading-search-b41f2c` is green — its worktree holds valid Proof. Build on it with `discern update --from 24ffe2d0b6716fe466cace4df4f3aa919c1c0547`. The immutable commit remains valid if acceptance deletes the branch.
```

After a green wait, your agent builds on the exact commit that passed, which stays usable even if the search branch is later removed. After a landing or a trunk move, it brings in the trunk with `discern update`.

Then your agent tries search before writing about it, because the wait only says the work has arrived. `discern update` also names files both tasks changed, which your agent rereads, because sensible changes can still clash once combined. The help task then finishes as usual: its own checks, your review, and its own permission to land.

## Handle a refusal

A refusal means discern can't answer the wait as asked, so resuming won't help. The result says why and what to do instead, and your agent follows it or tells you what's left. For example:

- Proof lives in a task's **worktree**, its separate copy of the project, so a green wait refuses if search's worktree was reclaimed because a later task holds its work. The result names that task or suggests waiting for the landing.
- A mistyped or unclear task name gets a request for an exact path or branch.
- A damaged or expired resume handle can't continue, so your agent starts the wait again.

You can ask:

> "Explain why this wait can't continue, where the search work is now, and which next step still fits our plan."

## When not to wait

Waits are for tasks in the same project that depend on each other. They don't cover a review decision, a release, helpers inside the agent's own session, or the agent's own checks.

If the plan changes, tell your agent the help task no longer needs search. Ending the wait changes neither task's code. [Coordinate parallel tasks](coordinate-parallel-tasks.md) shows how waits fit a larger plan.
