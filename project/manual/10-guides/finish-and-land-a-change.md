---
id: guide-finish-and-land-a-change
title: "Finish and land a change"
description: "Ask for a finished change, review the result and its evidence, and decide when it joins the shared project."
order: 20
publish: true
kind: guide
aliases:
  - "guide-finish-and-land-a-change"
  - "Start, update, and accept a worktree"
  - "worktree lifecycle"
  - "can't edit main"
  - "update my branch"
  - "resume a worktree"
  - "follow-up fixes"
  - "Hand work back for review"
  - "handoff"
  - "hand work back"
  - "give this back"
  - "ready for review"
  - "accept work"
  - "submit a change"
  - "submission"
  - "pre-authorize landing"
  - "land once green"
  - "worktree stayed after landing"
---

# Finish and land a change

When your agent finishes a task, you should have something you can try, an account of what was checked, and a clear explanation of anything still needing your judgment. discern records the checking so you can spend your attention on the result, and it lands the change only when you have said it may.

Suppose you asked for a search box that helps people find their saved recipes. When the work comes back, you want to try a search, see whether the results make sense, and decide whether the feature belongs in the project. This guide follows that handoff through to landing: adding the finished change to the shared branch, usually called `main`.

## Ask for a reviewable result

You can give your agent this request:

> Finish the recipe search and bring it back for review. Show me how to try it, explain what was checked and what still needs attention, and include discern's Proof. Wait for my decision before landing it.

**Proof** is discern's record that the project's configured checks passed for a particular committed version of the change. A commit is a saved version in Git, the tool that tracks the project's history.

The request also sets a useful boundary: the agent can complete the work and its checks while you retain the landing decision. If you would rather not be asked again, you can pre-authorize the task from the desk before its agent finishes; [Land under verified authority](#land-under-verified-authority) explains that choice.

## Start an isolated checkout

Your agent first reads `discern status`. It continues in the task's existing **worktree**, an isolated workspace with its own branch. For a new task, it creates one through `discern start` and moves its file operations there.

The same worktree holds implementation, review fixes, and any resumed sessions, and it stays the agent's until the change lands. discern changes a worktree only through the command the agent runs in it; it never installs another version of the project into the agent's workspace. You can keep the returned path with your task notes so another session knows where to continue. [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains how this keeps unfinished changes separate from the shared project.

## Prepare the change and its evidence

While working, your agent uses focused checks and `discern prepare`, which runs the project's fast fix-and-check steps. It reviews any rewritten files and commits the intended result before asking for the full gate, the project's configured quality checks.

The full check needs a committed, clean tree. Evidence has to describe a version that can land, and an uncommitted edit is not one. If the agent asks for the full check with unsaved work, discern refuses and names the files. The agent commits the intended files and asks again.

If other work has landed since the task started, your agent runs `discern update` to bring the shared branch into its worktree. It examines any overlapping changes because two edits can merge successfully and still disagree about how a feature should behave.

The final command is:

```sh
discern done
```

It runs every configured check and measurement against the committed version in the worktree and records Proof for that exact commit. A full check can take a while. It announces a short handle the moment it starts; if the terminal or tool loses the call, the agent reads the run back with `discern progress` instead of starting it again. [Recover an interrupted task](recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) shows what that reading contains.

Your agent also considers **checkpoints**, the project's written review questions. Recorded conclusions appear in Proof as declared judgments, separately from machine-verified results. A checkpoint that pauses completion needs an answer before work can proceed. A failed check goes through [Fix a red gate](fix-a-red-gate.md).

## Review what comes back

A useful handoff tells you what changed, how to try it, what the agent exercised, and anything still unresolved. It ends with the Proof line. Ask your agent to explain any part you do not recognize, or open the full record from the worktree:

```sh
discern status --verbose
```

For recipe search, try a recipe you know is present, a word that matches several recipes, and a search with no matches. Look at the wording and the results as someone using the app would. Then compare what you saw with what you requested.

You can ask:

> Which of those behaviors have automated checks? What did you try directly? Is there anything this change affects that I haven't seen yet?

This helps you choose where to spend more review time. If the task changes something consequential that you cannot assess, ask for an independent review with the relevant expertise. Proof establishes what the configured checks cover; review addresses whether the result meets your needs and whether that coverage is sufficient.

## Apply review feedback

Give feedback in terms of the outcome you want:

> When there are no matches, suggest trying another word. Keep the search text so the person can edit it.

Your agent makes that change in the same worktree, prepares and commits it, then runs `discern done` again. The earlier evidence described an earlier version. The new handoff should show the amended behavior and the evidence that covers it.

Fresh Proof does not always mean every check runs again. discern keeps the results of checks whose inputs have not changed and runs the ones affected by the edit. The Proof still covers the new version.

## Land under verified authority

When you are satisfied, you can say:

> Land the recipe search change we've reviewed.

Your agent runs `discern accept` from the task's worktree. The command first records the task's **submission**: the exact commit the agent is asking to land, with the Proof that covers it. discern stores that record beside the worktree, outside any file the branch could edit, so the version you approved and the version that lands are the same one. A later `discern accept` from the same task replaces the submission, and a landing consumes it.

Permission to land comes from you in this conversation, from a standing grant in the project's configuration, or from a task you pre-authorized at the desk. discern checks it before moving anything:

| Source                                | How you give it                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This conversation**                 | You say the change may land. The agent records that with `discern accept --confirmed`.                                                                                                                        |
| **A standing grant**                  | The project's configuration pre-authorizes named areas of the project, such as documentation. A change confined to those areas lands without asking.                                                          |
| **A task pre-authorized at the desk** | From bare `discern` in the main checkout, choose **Pre-authorize landing once green** for the task. discern asks `Allow <branch> to land once green without a further conversation?` and records your answer. |

A desk grant covers the task's branch, so it survives review. If you ask for a change after granting it, the next green run on that branch is still covered, and its agent's own `discern accept` lands it without another turn from you. The landing consumes the grant; you can revoke it from the desk until then, and it disappears with the worktree. No grant covers an unmet checkpoint, a proposed change to a standard's limit, or an emergency landing; those need your explicit decision each time. [Proof](../20-understand/proof.md#who-supplies-what) describes each source in more detail.

Without permission, `discern accept` changes nothing. The submission stays in the landing queue waiting for you, and the agent relays the Proof line and stops. You can then approve it in conversation, pre-authorize it from the desk, or ask an agent in the main checkout to land it with `discern accept --target <task>` once you have said it may.

Read the first sentence of the result before anything else: it names your task's branch, says whether it landed, and gives the next command when it did not. A landing reads like this, with your task's branch in place of the example:

```text
Landed agent/recipe-search-0a7563 at 3f9c2d81a4b7 on main; its checkout, branch, and resources are gone. You are on main in /Users/you/projects/recipes.
```

If the shared branch moved after the Proof was recorded, acceptance refuses in one sentence and names the route: the agent runs `discern update`, then `discern done`, then `discern accept` again. Checks that the incoming changes do not affect are reused.

## Completion

A landing moves the shared branch to the submitted commit, attaches the Proof to that commit as a durable note, brings the main checkout up to date, and removes the task's worktree, its resources, and its branch. That cleanup happens when the branch holds nothing beyond what landed.

When the worktree stays, the first sentence says why and names the command that finishes the work:

- The branch gained commits after the submission. Those commits have not landed. The agent runs `discern done` and then `discern accept` for them.
- Cleanup could not complete, for example because another program is still writing in the directory. The landing stands; `discern worktree prune` from the main checkout finishes the removal once that program stops.

These are different states, and the result uses different words for them:

| State                 | What it tells you                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Checks passed**     | The configured checks ran and passed on one exact version.                                                                                                  |
| **Proof**             | The complete evidence for that version, including every measurement and recorded judgment.                                                                  |
| **Submitted**         | The agent asked to land that exact version. The submission waits in the landing queue until permission arrives.                                             |
| **Approved**          | You, or a recorded grant, gave permission to land it.                                                                                                       |
| **Landed**            | The version is on the shared branch.                                                                                                                        |
| **Deployed**          | Your release process made it available to users. discern never does this.                                                                                   |
| **Emergency landing** | An urgent repair landed before its checks finished, under a fresh decision of yours, with a permanent record of what was skipped. That record is not Proof. |

[Land an urgent repair](land-an-urgent-repair.md) covers the last row. For the evidence and permission model, read [Proof](../20-understand/proof.md). For exact commands, use the [CLI reference](../30-reference/cli-reference.md).
