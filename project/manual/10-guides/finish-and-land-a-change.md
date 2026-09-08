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
---

# Finish and land a change

When your agent finishes a task, you should have something you can try, an account of what was checked, and a clear explanation of anything still needing your judgment. discern records the checking so you can spend your attention on the result.

Suppose you asked for a search box that helps people find their saved recipes. When the work comes back, you want to try a search, see whether the results make sense, and decide whether the feature belongs in the project. This guide follows that handoff through to landing: adding the finished change to the shared branch, usually called `main`.

## Ask for a reviewable result

You can give your agent this request:

> Finish the recipe search and bring it back for review. Show me how to try it, explain what was checked and what still needs attention, and include discern's Proof. Keep the worktree available for review fixes. Wait for my decision before landing it.

**Proof** is discern's record that the project's configured checks passed for a particular committed version of the change. A commit is a saved version in Git, the tool that tracks the project's history.

The request also sets a useful boundary: the agent can complete the work and its checks while you retain the landing decision. If you have already approved landing this task or granted permission for its scope, say so in your brief; discern checks that permission before landing.

## Start an isolated checkout

Your agent first reads `discern status`. It continues in the task's existing **worktree**, an isolated workspace with its own branch. For a new task, it creates one through `discern start` and moves its file operations there.

The same worktree holds implementation, review fixes, and any resumed sessions. You can keep the returned path with your task notes so another session knows where to continue. [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains how this keeps unfinished changes separate from the shared project.

## Prepare the change and its evidence

While working, your agent uses focused checks and `discern prepare`, which runs the project's fast fix-and-check steps. It reviews any rewritten files and commits the intended result before asking for the full gate, the project's configured quality checks.

If other work has landed, your agent follows discern's update or completion instructions. It examines any overlapping changes because two edits can merge successfully and still disagree about how a feature should behave.

For the review request above, the final command is:

```sh
discern done --retain-checkout
```

The `--retain-checkout` option keeps the workspace under the agent's authoring control for follow-up edits. Ordinary successful `discern done` releases it for later validation and eligible cleanup. Neither command lands the change.

Completion includes every required check and measurement context. A context is a declared environment in which the project requires evidence, such as another operating system. If one is unavailable, the agent should explain what remains unverified. Passing the checks available on this machine alone may leave completion pending.

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

Your agent makes that change in the same worktree, prepares and commits it, then produces fresh Proof. The earlier evidence described an earlier version. The new handoff should show the amended behavior and the evidence that covers it.

If the workspace was already released, your agent reads its current state and follows the recovery instructions before editing. If its recorded path is unavailable, identify what happened to that task before creating another workspace. [Recover an interrupted task](recover-an-interrupted-task.md) covers these cases.

## Land under verified authority

When you are satisfied, you can say:

> Land the recipe search change we've reviewed.

Your agent follows the `discern accept` result and records your consent. When consent comes from this conversation, the command-line form is `discern accept --confirmed`. A valid recorded grant can supply permission without that flag.

Acceptance checks the current evidence and permission for each change it will land. It may need to validate a combined version containing earlier ready work. If that introduces a conflict, missing evidence, or a new decision, the result names what needs attention. [Proof](../20-understand/proof.md#the-exact-commit-it-covers) explains how evidence follows that combined version.

An unmet checkpoint or a proposed standard limit change needs your explicit decision on that particular exception. General permission to land does not settle either one. The agent should explain the tradeoff and its recommendation before asking you to decide.

## Completion

The acceptance result identifies which changes landed on the shared branch and gives the surviving checkout path. It also reports whether temporary worktrees and resources were removed or retained. A cleanup problem can occur after a successful landing; the agent should distinguish those outcomes and follow the reported recovery.

Landing makes the change part of the shared project. Publishing it to users follows your project's release process. Ask your agent for that next step when you are ready to release.

For the evidence and permission model, read [Proof](../20-understand/proof.md). For exact commands, use the [CLI reference](../30-reference/cli-reference.md).
