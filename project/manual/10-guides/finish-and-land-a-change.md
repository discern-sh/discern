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
  - "release a worktree"
  - "release-checkout"
  - "retain-checkout"
  - "why did validation run again"
  - "checkout kept after landing"
---

# Finish and land a change

When your agent finishes a task, you should have something you can try, an account of what was checked, and a clear explanation of anything still needing your judgment. discern records the checking so you can spend your attention on the result.

Suppose you asked for a search box that helps people find their saved recipes. When the work comes back, you want to try a search, see whether the results make sense, and decide whether the feature belongs in the project. This guide follows that handoff through to landing: adding the finished change to the shared branch, usually called `main`.

## Ask for a reviewable result

You can give your agent this request:

> Finish the recipe search and bring it back for review. Show me how to try it, explain what was checked and what still needs attention, and include discern's Proof. Keep the worktree available for review fixes. Wait for my decision before landing it.

**Proof** is discern's record that the project's configured checks passed for a particular committed version of the change. A commit is a saved version in Git, the tool that tracks the project's history.

The request also sets a useful boundary: the agent can complete the work and its checks while you retain the landing decision. If you have already approved landing this task, or granted permission for its scope, say so in your brief. discern checks that permission before landing, and a task that carries it can land without another turn from you.

## Start an isolated checkout

Your agent first reads `discern status`. It continues in the task's existing **worktree**, an isolated workspace with its own branch. For a new task, it creates one through `discern start` and moves its file operations there.

The same worktree holds implementation, review fixes, and any resumed sessions. You can keep the returned path with your task notes so another session knows where to continue. [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) explains how this keeps unfinished changes separate from the shared project.

## Prepare the change and its evidence

While working, your agent uses focused checks and `discern prepare`, which runs the project's fast fix-and-check steps. It reviews any rewritten files and commits the intended result before asking for the full gate, the project's configured quality checks.

The full check needs a committed, clean tree. Evidence has to describe a version that can land, and an uncommitted edit is not one. If the agent asks for the full check with unsaved work, discern refuses and names the files. The agent commits the intended files and asks again.

A full check can take a while. It announces a short handle the moment it starts; if the terminal or tool loses the call, the agent reads the run back with `discern progress` instead of starting it again. [Recover an interrupted task](recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) shows what that reading contains.

If other work has landed, your agent follows discern's update or completion instructions. It examines any overlapping changes because two edits can merge successfully and still disagree about how a feature should behave.

For the review request above, the final command is:

```sh
discern done --retain-checkout
```

The `--retain-checkout` option keeps the workspace under the agent's authoring control for follow-up edits and for anything you want to try there before deciding. Ordinary successful `discern done` releases it so discern can use it for later validation and eligible cleanup. Neither command lands the change.

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

Fresh Proof does not always mean every check runs again. discern keeps the results of checks whose inputs have not changed and runs the ones affected by the edit. The Proof still covers the new version.

If you have no changes, the agent releases the workspace without repeating any check:

```sh
discern done --release-checkout
```

Release lets discern reuse or clean up the workspace later; anything the agent left running there is stopped first. It creates no new Proof and gives no permission to land. It also works after other tasks have landed in the meantime. If the workspace was already released, your agent reads its current state and follows the recovery instructions before editing. If its recorded path is unavailable, identify what happened to that task before creating another workspace. [Recover an interrupted task](recover-an-interrupted-task.md) covers these cases.

## Land under verified authority

When you are satisfied, you can say:

> Land the recipe search change we've reviewed.

Your agent runs `discern accept` from the task's worktree and records your consent. When consent comes from this conversation, the command-line form is `discern accept --confirmed`. A valid recorded grant can supply permission without that flag.

That approval is recorded for the exact version you reviewed, so a task that has to wait behind other work keeps it. You can also grant a finished task from the desk (bare `discern` from the main checkout) before its agent asks, or pre-approve a scope of routine changes in the project's configuration. [Proof](../20-understand/proof.md#who-supplies-what) describes the three sources.

The result answers about this task first: whether it landed, and if not, what stands in the way. Read that sentence before anything else in the result. A landing reads like this, with your task's branch in place of the example:

```text
Selected effort `agent/recipe-search-0a7563`: landed. Its checkout was removed.
```

If you ran acceptance from the main checkout with several tasks waiting, name yours with `discern accept --target <task>`; the answer is organized the same way.

Landing is a queue. Several finished tasks can be waiting, and acceptance lands them in a stable order rather than in the order they finished. The command may land approved tasks ahead of yours on the way. It may also stop at a task ahead of yours that still needs someone's approval. Neither outcome says anything about your change; the result names the task it stopped at and what that task needs, then lists the other tasks under their own headings:

```text
Selected effort `agent/recipe-search-0a7563`: not landed.
- Acceptance stopped at agent/recipe-sort-7d41e2, which is ahead of this effort in the queue.

Ahead of it in the queue:
agent/recipe-sort-7d41e2 is waiting: Waiting for the owner's recorded approval of its current source.
```

Approving your change does not approve the ones ahead of it, and a landing headline under another task's branch is that task's, not yours.

Acceptance checks the current evidence and permission for each change it lands. When the shared branch has moved since your Proof, discern needs evidence for the combined version. If the project has declared a validation environment, acceptance can build and check that version itself; otherwise the agent brings the trunk into the worktree and runs the full check again. Any check whose inputs are unchanged is reused. [Proof](../20-understand/proof.md#the-exact-commit-it-covers) explains how evidence follows that combined version.

An unmet checkpoint or a proposed standard limit change needs your explicit decision on that particular exception. General permission to land does not settle either one. The agent should explain the tradeoff and its recommendation before asking you to decide.

## Completion

The acceptance result identifies which changes landed on the shared branch and gives the surviving checkout path.

After a landing, discern removes the task's workspace when nothing else is using it. When it stays, the same first sentence says why and names the command that finishes cleanup. The usual reason is a workspace kept for review and never released:

```text
Selected effort `agent/recipe-search-0a7563`: landed. Its checkout stayed. It remains available for review or further edits until released; when finished with it, run discern done --release-checkout from it and the next discern accept removes it.
```

The other reasons read the same way: a preview or other process is still using it, the branch gained new commits after landing, the workspace holds changed files, or its ownership could not be verified. A kept workspace does not undo the landing.

These are different states, and the result uses different words for them:

| State                 | What it tells you                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Checks passed**     | The configured checks ran and passed on one exact version.                                                                                                  |
| **Proof**             | The complete evidence for that version, including every required context and recorded judgment. Checks can pass while Proof is still pending.               |
| **Approved**          | You, or a recorded grant, gave permission to land this version.                                                                                             |
| **Landed**            | The version is on the shared branch.                                                                                                                        |
| **Deployed**          | Your release process made it available to users. discern never does this.                                                                                   |
| **Emergency landing** | An urgent repair landed before its checks finished, under a fresh decision of yours, with a permanent record of what was skipped. That record is not Proof. |

[Land an urgent repair](land-an-urgent-repair.md) covers the last row. For the evidence and permission model, read [Proof](../20-understand/proof.md). For exact commands, use the [CLI reference](../30-reference/cli-reference.md).
