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

When your agent finishes a task, you get the change to try, a Proof showing which checks passed, and a short list of anything that needs your decision. Once you're happy, the change lands on your project's shared branch. Nothing lands until you say so, unless it's covered by a rule you set up in advance.

This guide follows one change from finished to landed: a search box for a recipe app.

## Ask for a result you can review

Tell your agent what "finished" should include:

> Finish the recipe search and bring it back for review. Show me how to try it, tell me what was checked and what still needs attention, and include discern's Proof. Don't land it until I say so.

**Proof** is discern's record of which of your project's checks passed, on exactly which commit (a saved version of your code in Git). [Proof](../20-understand/proof.md) explains how to read it.

The last sentence keeps the landing decision with you. For routine work you'd rather not be asked about, see [Pre-approve routine work](#pre-approve-routine-work).

## What your agent does

You don't need to run any of these commands yourself. They're here so you know what's happening.

**It works in its own worktree.** A worktree is a separate copy of the project with its own branch, so unfinished work stays off your shared branch, usually `main`. The agent creates one with `discern start` and keeps using it through review fixes and later sessions, until the change lands. [Worktrees and trunk](../20-understand/worktrees-and-trunk.md) explains more.

**It gets fast feedback while it works.** `discern prepare` applies the project's fixers, such as the code formatter, then runs its quick checks, like linting and type-checking, without the full test suite. Each failure comes with its output and a command to reproduce it, so problems surface while they're cheap to fix.

**It hears about files it may have missed.** By default, when `discern prepare` or `discern done` passes, discern looks through the project's Git history for files that usually change alongside the ones the agent touched. If this change leaves one out, such as the test for an edited module, discern names it. The agent decides whether it matters.

**It commits, then runs the gate.** The gate is the full set of checks your project requires:

```sh
discern done
```

The gate only runs on committed work. If anything is uncommitted, it stops and names the files, so the Proof always describes a version that can land. If your project defines **scopes**, named areas such as `docs/`, the gate runs only the checks for the areas the change touches. When discern isn't sure what a change affects, it runs everything.

A full run can take a while. If the agent's session loses track of it, the agent reads the result back with `discern progress` instead of starting again. If a check fails, the agent fixes the cause. [Fix a red gate](fix-a-red-gate.md) explains how.

Your project may also have **checkpoints**: review questions that apply to certain kinds of change. When one applies, the agent answers it before the gate runs, and the answer appears in the Proof. [Checkpoints](../20-understand/checkpoints.md) explains how they work.

**It keeps up with `main`.** If other work has landed since the task started, `discern done` asks the agent to run `discern update` first. That brings in the new work and lists any files both changes touched, so the agent can re-read them. Changes can merge cleanly and still clash, such as two features that both want the same spot on screen.

## Review what comes back

A good handoff tells you what changed, how to try it, what the agent tested, and what's unresolved. It ends with the Proof line.

Try the feature the way someone using the app would. Search for a recipe you know is there, a word that matches several, and something with no matches. Then ask:

> Which of these behaviors have automated checks? What did you try by hand? Is there anything this change affects that I haven't seen?

The answers tell you where to spend your review time. If the change touches something you can't judge yourself, such as security, ask for an independent review. To see the full Proof, run this in the task's worktree:

```sh
discern status --verbose
```

## Ask for changes

Describe the result you want, not the code:

> When nothing matches, suggest trying another word, and keep the search text so people can edit it.

The agent makes the change in the same worktree, commits it, and runs `discern done` again. The old Proof covered the old version, so the new handoff comes with new Proof. discern reuses the results of any check it can show the edit didn't affect.

## Land it

When you're happy, say:

> Land the recipe search change.

The agent runs `discern accept --confirmed`, where `--confirmed` records that you said yes in this conversation. First, the command **submits** the change: it records the commit and its Proof outside the branch, where later edits can't reach them. So the version that lands is the version you reviewed. Then it **lands** the change, moving `main` forward to include it.

The first sentence of the result tells you whether the change landed and, if it didn't, what to do next:

```text
Landed agent/recipe-search-0a7563 at 3f9c2d81a4b7 on main; its checkout, branch, and resources are gone. You are on main in /Users/you/projects/recipes.
```

### When other work lands first

Another task may land on `main` while yours waits for review. That doesn't send your change back to the start. At landing, discern combines both changes in a temporary **integration worktree**, runs the checks on the combined code, and lands exactly what passed. If another landing is already running, yours waits its turn, then carries on by itself.

If the changes conflict or the combined checks fail, nothing lands. Your agent gets the exact files or failing check, brings the new `main` into its worktree, fixes the problem, and tries again.

If the combined code triggers a checkpoint, the agent answers the question (with `discern accept --met`, or `--unmet` and a reason) and the same landing continues. Decisions that need you, such as an unmet checkpoint or a change to a standard's limit, still wait for you.

### Without permission, nothing lands

If nothing gives the change permission to land, `discern accept` changes nothing. The change waits in the **landing queue**, and the agent passes you the Proof line and stops. When you're ready, you can:

- approve it in conversation;
- pre-approve it from the desk, as described below; or
- ask an agent in your main checkout to land it with `discern accept --target <task>`.

## Pre-approve routine work

You don't have to approve every change by hand. You can pre-approve the changes you don't need to see, and everything else still comes back to you. Permission to land can come from:

| Source                | How you give it                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **This conversation** | You say the change can land. The agent records this with `discern accept --confirmed`.                                                                                                                                                     |
| **A standing grant**  | Your project's configuration pre-approves named areas, such as documentation. A change that stays inside them lands without asking.                                                                                                        |
| **A one-task grant**  | Run `discern` in your main checkout (your original project folder) to open the **desk**. Select the task and choose **Pre-authorize landing once green**. discern asks `Allow <branch> to land once green without a further conversation?` |

At every landing, discern checks the grant against the files the change touches. If even one file falls outside it, the change comes back to you.

A one-task grant follows the task's branch, so it still covers the change after review fixes: the next green run lands as soon as the agent submits it. Landing uses up the grant. Until then you can revoke it from the desk, and it disappears if the worktree is removed.

No grant covers an unmet checkpoint, a change to a standard's limit, or an emergency landing. Those always need your explicit decision.

## After it lands

When the change lands, discern:

- moves `main` to the exact commit it checked;
- attaches the Proof to that commit as a Git note;
- updates your main checkout;
- removes the task's worktree, branch, and resources.

If the worktree is still there, the result's first sentence says why:

- **The branch has newer commits.** They haven't landed yet. The agent runs `discern done`, then `discern accept`, for them.
- **Cleanup didn't finish**, perhaps because another program was still using the folder. The change has landed. Once that program stops, run `discern worktree prune` from your main checkout to finish.

Landing isn't releasing: getting the change to your users is still up to your release process. [From green to live](../20-understand/proof.md#from-green-to-live) shows every stage. If a fix is too urgent to wait for its checks, see [Land an urgent repair](land-an-urgent-repair.md). For every command and flag, see the [CLI reference](../30-reference/cli-reference.md).
