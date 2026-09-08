---
id: guide-wait-for-another-task
title: "Wait for another task"
description: "Let a dependent agent continue when the work it needs is ready, without carrying messages between sessions."
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

One agent is adding a way to mark books as read in your reading-list app. Another will add a view of unread books. The second task needs the first result, but you do not need to watch both sessions and announce the handover yourself.

Your agent can use `discern_await` to wait for the relevant repository state. When the condition holds, discern returns the next step for bringing that work into the waiting task. For checked work, it looks for **Proof**: discern's record of the configured checks that passed.

## Ask for the handover you want

Tell the waiting agent what it needs and when it may use it:

> Build the unread-books view once the task that marks books as read has current Proof. Use discern-await-the-fleet to wait for it, bring in its work, and check that marking a book as read works before you continue.

Your agent resolves the other task's exact branch or worktree identity. Include its returned branch or path if you have it; a display title alone may not identify one task. The agent keeps working in its own worktree, or waits from the main checkout if its dependent effort has not started yet.

A condition that is already met returns immediately. You can give the request without first checking whether the earlier session has finished.

## Choose the condition

The useful distinction is whether the next task can build on checked work or needs work that has already reached the shared branch.

| What you want                                       | What the agent waits for                                                     | When to choose it                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| “Use the earlier work once it has current Proof.”   | **Green:** the task has current completion evidence, or its work has landed. | Build the unread-books view while you review the earlier feature. |
| “Use the earlier work after it lands.”              | **Landed:** the target's work has reached the trunk, the shared branch.      | Start from the version already accepted into the project.         |
| “Continue when anything reaches the shared branch.” | **Trunk moved:** the branch changed after the watch began.                   | React to the next change without requiring one particular task.   |

A green task is ready to build on under the plan; its Proof does not grant permission to land. If the dependent task needs your approval, that decision still waits for you. [Proof, review, and authority](../20-understand/proof.md) explains the distinction.

## Start the wait

Your agent normally calls the `discern_await` tool with the waiting worktree's absolute `path` and one condition. The command-line equivalent for an illustrative branch is:

```sh
discern await --green agent/mark-books-read-b41f2c
```

The other choices are `--landed <worktree>` and `--trunk-moved`. A named task can be identified by its returned worktree id, absolute path, local branch, or full local ref. The [CLI reference](../30-reference/cli-reference.md#discern-await) lists the exact options.

The agent leaves the timeout unset so discern chooses the longest reliable call window. It follows continuation instructions if the work is still in progress. You do not need to supply a delay or ask it to check again every few minutes.

## Compose what arrived

When the condition holds, the result tells the agent how to bring the work into its own task:

- For green work that has not landed, start from or update from the exact observed commit using `discern start --from <commit>` or `discern update --from <commit>`.
- For landed work or trunk movement, start from the trunk or bring it into the existing worktree with `discern_update`.

The agent then checks the result it received. In the reading-list example, it should be able to mark a book as read before building the unread-books view. A successful wait establishes the repository condition; the task still needs that practical check.

Any overlap named by the update deserves a fresh read. Separate agents can make individually sensible changes that need adjustment when combined. The dependent task finishes with the normal gate and review.

## Continue an unresolved call

If you inspect the raw result, `ok: true` with `data.met: false` means the call window ended while the condition was still unmet. The wait can continue.

The result supplies a `resume` handle. Your agent uses that handle with the same worktree path, without repeating the original condition, and continues until the condition holds or the dependency no longer matters. The handle preserves the original watch, including a relevant change between calls.

These continuation mechanics belong to the agent. The practical outcome for you is that a long-running prerequisite does not need repeated reminders.

## Handle a refusal

An `ok: false` result means discern cannot answer the watch as requested. It has no continuation. The agent follows its recovery and explains anything it cannot resolve.

For example, a green watch needs a worktree that can hold current Proof. If that checkout has been reclaimed, the result may point to a later branch containing the work or suggest waiting for its landing instead. A mistyped or ambiguous task selector needs correcting. A landing watch can recover an already completed landing from its durable Proof note even after the branch is removed.

You can ask:

> Explain why this wait cannot continue, where the earlier work is now, and which next step still fits our plan.

## When waiting is the wrong tool

Use this workflow for dependencies between worktrees in the same repository. It does not wait for a review decision, an external release, or helpers inside the agent's own session. The agent should also continue its own unfinished work rather than wait for itself to become green.

If the plan changes, tell the agent the dependency no longer matters. Ending the watch is safe; it does not change either task's code. Whether your message interrupts a running tool call immediately depends on your coding-agent host.

The bundled `discern-await-the-fleet` [skill](create-and-manage-skills.md) gives agents this procedure. [Coordinate parallel tasks](coordinate-parallel-tasks.md) shows how it fits a larger plan, and [MCP and results](../30-reference/mcp-and-results.md) describes the detailed result and timeout contracts.
