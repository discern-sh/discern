---
id: guide-finish-and-land-a-change
title: "Finish and land a change"
description: "Review a finished change, ask for fixes, and land it on your shared branch, even when other work has landed first."
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
  - "pre-authorized landing"
  - "standing grant"
  - "effort grant"
  - "land once green"
  - "worktree stayed after landing"
---

# Finish and land a change

When your agent finishes a task, you get the change to try and a **Proof**. It shows which of your project's commands passed on the exact commit you'll review. The change lands on your shared branch only when you say so, now or in advance.

If other work lands first, discern checks the two changes together instead of sending yours back to the start.

## Ask for a result you can review

Say your agent is adding search to your recipe app. Tell it what "finished" means:

> "Finish the recipe search and bring it back for review. Show me how to try it, what you tested, and what still needs my decision. Don't land it until I say so."

The last sentence keeps the landing decision with you.

## What your agent does

You don't need to run any of these commands yourself. Each result tells your agent what to do next.

**It works in its own worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk** (usually `main`), stays untouched until the change lands.

**It hears about failures early.** `discern prepare` runs your formatter and quicker checks, such as the linter. Each failure comes with its output and a command that reproduces it, so your agent fixes it while the change is still small.

**It hears about files it may have missed.** By default, when `discern prepare` or `discern done` passes, discern checks your Git history for files that usually change together with the ones your agent touched. It names any the change left out:

```text
Start with `search.test.js`: it changed in 4 of the 4 recent commits that touched `search.js` (100%), and this branch changed `search.js` without it.
```

The finding is advice and never fails a run, so your agent checks whether its change to how search matches words needs new tests.

**It commits, then runs the gate** with `discern done`. The **gate** runs your project's own commands, such as its linter and tests. A change counts as finished only when every one of them passes. The gate only runs on committed work, so the Proof always describes a version that can land.

If your project defines **scopes**, areas such as `docs/` with a check of their own, that check runs only when a change touches the area, so unrelated checks don't slow a focused change. Every other command runs on every change. If a command fails, your agent [fixes the cause](fix-a-red-gate.md).

If the change touches files a **checkpoint** watches, your agent answers that review question first. The answer goes into the Proof. If it's **unmet**, only you can [let the change land anyway](../10-understand/checkpoints.md).

**It keeps up with `main`**, bringing in new work with `discern update`. It rereads the files both changes touched, because changes can merge cleanly and still clash.

## Review what comes back

The handoff ends with the [Proof line](../10-understand/proof.md). A pass means your project's commands passed on that commit, and nothing more. The change is ready for your review, and it isn't on `main` until it lands.

Try search as your users would: a recipe you know is there, a word that matches several, and one that matches nothing. Then ask:

> "Which of these behaviors have automated tests? What did you try by hand? Is there anything this change affects that I haven't seen?"

For what you can't judge yourself, such as security, ask for an independent review. To see the full Proof, run `discern status --verbose` in the task's worktree.

## Ask for changes

Describe the result you want:

> "When nothing matches, suggest trying another word, and keep the search text so people can edit it."

Your agent makes the change in the same worktree and commits it. Then it runs `discern done` again, because any new commit [makes the old Proof stale](../10-understand/proof.md#why-proof-becomes-stale). discern reuses the result of any command it can show the edit didn't affect.

## Land it

When you're happy, say so:

> "Land the recipe search."

Your agent runs `discern accept --confirmed`, which records that you said yes in this conversation. The command **submits** the change, recording the commit and Proof where later edits can't reach them, so what lands is what you reviewed. Then it lands the change. The result's first sentence says whether it landed and what happens next.

```text
Landed agent/recipe-search-0a7563 at 3f9c2d81a4b7 on main; its checkout, branch, and resources are gone. You are on main in /Users/ada/projects/recipes.
```

### When other work lands first

Another task may land on `main` while yours waits for review. That doesn't make your Proof stale or send your change back to the start.

When your change lands, discern combines it with the new `main` in a temporary copy, called an **integration worktree**. It runs the gate on the combined code and lands exactly what passed, instead of landing your change on top of work its tests never saw.

If the changes conflict, or a command fails on the combined code, nothing lands. Your agent gets the conflicting files or failing command, fixes the problem in its worktree, and tries again. If the combined code triggers a checkpoint, your agent answers it and the same landing continues. An unmet answer still waits for you.

### Without permission, nothing lands

Without permission, `discern accept` records the submission and lands nothing. The change waits in the **landing queue**, and the result starts:

```text
The revision is submitted and waits in the landing queue for the owner.
```

Your agent passes you the Proof line and stops. To land the change later, approve it in conversation, [pre-approve it](#pre-approve-routine-work), or ask an agent in your main checkout, your original project folder. [Coordinate parallel tasks](coordinate-parallel-tasks.md) explains the queue.

## Pre-approve routine work

A **grant** is permission to land that you set up in advance, so routine changes land without asking you. Everything else still comes back to you. Permission can come from:

| Source                | How you give it                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **This conversation** | You say the change can land, and your agent records your yes.                                                                               |
| **A standing grant**  | Your project's configuration pre-approves named areas, such as documentation.                                                               |
| **A one-task grant**  | On the **desk**, the interactive view that opens when you run `discern` in your main checkout, choose **Pre-authorize landing once green**. |

At every landing, discern checks a standing grant against each file the change touches. Any file outside the granted areas, such as code in a documentation change, sends the change back to you. Your approval in conversation, or a one-task grant, covers every file.

A one-task grant follows the task's branch, so it still covers the change after review fixes. It lasts until the change lands, you revoke it from the desk, or the worktree is removed.

No grant covers a **variance** (your permission to land despite an unmet checkpoint), a looser limit for a **standard** (one of your project's measured limits), or an [emergency landing](land-an-urgent-repair.md). Each needs your explicit decision at the time.

## After it lands

When the change lands, discern moves `main` to the exact commit it checked and attaches the Proof as a Git note. It updates your main checkout and removes the task's worktree, branch, and resources.

If anything stays behind, the change has still landed. The result's first sentence says why and what finishes the job:

- The branch has newer commits that haven't landed.
- The worktree has uncommitted changes, which discern keeps.
- The Proof note couldn't be recorded.
- Another program was using the folder, or a resource couldn't be removed.

[A landed task's worktree stayed behind](../40-troubleshooting/worktrees-and-resources.md#a-landed-tasks-worktree-stayed-behind) matches each message to its fix.

Landing isn't releasing, which your release process still handles. [From green to live](../10-understand/proof.md#from-green-to-live) shows every stage.
