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
  - "land once green"
  - "worktree stayed after landing"
---

# Finish and land a change

When your agent finishes a task, you get the change to try, a **Proof** that shows which of your project's commands passed on the exact commit you'll review, and a short list of anything that needs your decision. Once you're happy, the change lands on your project's shared branch. Nothing lands until you say so, unless a rule you set up in advance covers it.

If other work lands first, discern checks the two changes together instead of sending yours back to the start.

## Ask for a result you can review

Say your agent is adding search to your recipe app. Tell it what "finished" should include:

> "Finish the recipe search and bring it back for review. Show me how to try it, tell me what you tested and what still needs my decision, and include the Proof. Don't land it until I say so."

The last sentence keeps the landing decision with you. For routine work you'd rather not be asked about, you can [pre-approve it](#pre-approve-routine-work). [Proof](../10-understand/proof.md) explains how to read what comes back.

## What your agent does

You don't need to run any of these commands yourself: each result tells your agent what to do next.

**It works in its own worktree.** Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, usually `main`, stays untouched while it works. It creates the worktree with `discern start` and keeps using it through review fixes and later sessions, until the change lands. [Worktrees and trunk](../10-understand/worktrees-and-trunk.md) explains the model.

**It hears about failures while they're cheap to fix.** `discern prepare` runs your project's formatter and other tools that rewrite files, then its quicker checks, such as the linter and type checker, without the full test suite. Each failure comes with its output and a command that reproduces it on its own, so your agent fixes a mistake while the change is still small.

**It hears about files it may have missed.** By default, when `discern prepare` or `discern done` passes, discern reads your project's Git history for files that usually change together with the ones your agent touched. If this change leaves one out, discern names it:

```text
Start with `search.test.js`: it changed in 4 of the 4 recent commits that touched `search.js` (100%), and this branch changed `search.js` without it.
```

Here, your agent changed how search matches words without touching its tests, so it checks whether the new matching needs one. The finding is advice: it never fails a run, and your agent decides whether it matters.

**It commits, then runs the gate.** The **gate** runs your project's own commands, such as its formatter, linter, type checker, and test suite, and a change counts as finished only when every one of them passes:

```sh
discern done
```

The gate only runs on committed work, so the Proof always describes a version that can land. If anything is uncommitted, `discern done` stops and names the files. If your project defines **scopes**, named areas such as `docs/` that can have a check of their own, the gate runs a scope's check only when the change touches that area, and runs every other command on every change.

A full run can take a while. If your agent's session loses track of it, the agent reads the result back with `discern progress` instead of running everything again. If a command fails, the agent fixes the cause, as [Fix a red gate](fix-a-red-gate.md) describes.

Your project may also have **checkpoints**: review questions that apply to certain kinds of change. When one applies, your agent answers it before the gate runs, and the answer goes into the Proof. If it answers **unmet**, the change falls short of the question, and only you can let it land anyway. [Checkpoints](../10-understand/checkpoints.md) explains how they work.

**It keeps up with `main`.** If other work has landed since the task started, `discern done` asks your agent to run `discern update` first. That merges the new work into the task's branch and lists the files both changes touched, so the agent reads them again. Changes can merge without a conflict and still clash, such as two features that both want the same spot on the screen.

## Review what comes back

A good handoff says what changed, how to try it, what your agent tested, and what's still open, and it ends with the Proof line. A pass makes the change ready for your review. It isn't on `main` until it lands.

Try search the way someone using your app would: look for a recipe you know is there, a word that matches several, and something with no matches. Then ask:

> "Which of these behaviors have automated tests? What did you try by hand? Is there anything this change affects that I haven't seen?"

The answers tell you where to spend your review time, because a pass covers only what your project's commands test. If the change touches something you can't judge yourself, such as security, ask for an independent review. To see the full Proof, run this in the task's worktree:

```sh
discern status --verbose
```

## Ask for changes

Describe the result you want, and leave the code to your agent:

> "When nothing matches, suggest trying another word, and keep the search text so people can edit it."

Your agent makes the change in the same worktree, commits it, and runs `discern done` again. The first Proof covered the version before your fix, and any new commit makes it stale, so the new handoff comes with new Proof. discern reuses the earlier result of any command it can show the edit didn't affect.

## Land it

When you're happy, say so:

> "Land the recipe search."

Your agent runs `discern accept --confirmed`, where `--confirmed` records that you said yes in this conversation. First, the command **submits** the change: it records the commit and its Proof outside the branch, where later edits can't reach them, so the version that lands is the version you reviewed. Then it **lands** the change, moving `main` forward to include it. The first sentence of the result says whether the change landed and, if it didn't, what happens next:

```text
Landed agent/recipe-search-0a7563 at 3f9c2d81a4b7 on main; its checkout, branch, and resources are gone. You are on main in /Users/ada/projects/recipes.
```

### When other work lands first

Another task may land on `main` while yours waits for review. That doesn't send your change back to the start. When your change lands, discern combines it with the new `main` in a temporary **integration worktree**, runs the gate on the combined code, and lands exactly what passed, instead of landing your change on top of work its tests never saw. If another landing is already running, yours waits its turn, then carries on by itself.

If the changes conflict, or a command fails on the combined code, nothing lands. Your agent gets the conflicting files or the failing command, brings the new `main` into its worktree, fixes the problem, and tries again.

If the combined code triggers a checkpoint, your agent answers it, and the same landing continues. A decision that needs you still waits for you, such as an unmet checkpoint or a raised limit on a **standard**, one of the measured limits your project holds.

### Without permission, nothing lands

If nothing gives the change permission to land, `discern accept` records the submission and lands nothing. The change waits in the **landing queue**, the list of submitted changes waiting to land, and the result starts:

```text
The revision is submitted and waits in the landing queue for the owner.
```

Your agent passes you the Proof line and stops. When you're ready, you can:

- approve it in conversation;
- pre-approve it from the desk, as the next section describes; or
- ask an agent in your main checkout to land it, which it does with `discern accept --target <task>`.

## Pre-approve routine work

You don't have to approve every change by hand. You can pre-approve the changes you don't need to see, and everything else still comes back to you. Permission to land can come from:

| Source                | How you give it                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This conversation** | You say the change can land. Your agent records your yes with `discern accept --confirmed`.                                                                                                                                                 |
| **A standing grant**  | Your project's configuration pre-approves named areas, such as documentation. A change that stays inside them lands without asking.                                                                                                         |
| **A one-task grant**  | Run `discern` in your main checkout (your original project folder) to open the **desk**. Select the task and choose **Pre-authorize landing once green**. discern asks `Allow <branch> to land once green without a further conversation?` |

At every landing, discern checks a standing grant against the files the change touches, so a grant for documentation can't carry a code change with it. If even one file falls outside the granted areas, the change comes back to you. Your approval in conversation, or a one-task grant, covers every file in the change.

A one-task grant follows the task's branch, so it still covers the change after review fixes, and the next green run lands as soon as your agent submits it. Landing uses up the grant. Until then you can revoke it from the desk, and it ends if the worktree is removed.

No grant covers an unmet checkpoint, a change to a standard's limit, or an emergency landing. Each of those needs your explicit decision at the time.

## After it lands

When the change lands, discern:

- moves `main` to the exact commit it checked;
- attaches the Proof to that commit as a Git note;
- updates your main checkout;
- removes the task's worktree, branch, and resources.

If anything is left behind, the result's first sentence says why and names the command that finishes the job:

- **The branch has newer commits.** They haven't landed yet. Your agent runs `discern done`, then `discern accept`, for them.
- **The worktree has uncommitted changes.** discern keeps them, and the branch. Your agent commits what should stay, then runs `discern done`, then `discern accept`.
- **The Proof note wasn't recorded.** The change has landed. discern keeps the worktree and its branch until the note is recorded. Once the reported problem is fixed, your agent runs `discern accept` from that worktree, which records the note without landing again and then removes the worktree.
- **Cleanup didn't finish**, perhaps because another program was still using the folder, or a resource couldn't be removed. The change has landed. Once the cause is fixed, run `discern worktree prune` from your main checkout to finish.

Landing isn't releasing: getting the change to your users is still up to your release process. [From green to live](../10-understand/proof.md#from-green-to-live) shows every stage. If a fix is too urgent to wait for its checks, see [Land an urgent repair](land-an-urgent-repair.md). For every command and flag, see the [CLI reference](../30-reference/cli-reference.md).
