---
id: guide-recover-an-interrupted-task
title: "Recover an interrupted task"
description: "Pick up an unfinished task in a new session, read back a run you lost track of, finish a landing that stopped partway, or restore work from a dropped branch."
order: 40
publish: true
kind: guide
aliases:
  - "guide-recover-an-interrupted-task"
  - "Recover an interrupted landing"
  - "acceptance recovery"
  - "interrupted acceptance"
  - "partial acceptance"
  - "Recover a dropped worktree branch"
  - "dropped worktree"
  - "recover dropped branch"
  - "recovery refs"
  - "refs discern recovery"
  - "stale evidence"
---

# Recover an interrupted task

A task can outlive the session that started it. The task's **worktree**, a separate copy of the project on its own branch, keeps its files, commits, and setup. discern keeps its **Proof**, the record of which of your project's commands passed on one exact commit. A new session picks up from these instead of old chat history.

discern also records a long run or landing that stops partway, so your agent can finish it without guessing which steps happened.

## Resume an unfinished worktree

Say your agent was adding search to your recipe app when the session ended. In a new session, ask:

> "Pick up the recipe search where the last session stopped. Tell me what's finished and what's left before you change anything, and keep anything you don't recognize."

Give your agent the task's worktree path or branch if you have them, and remind it what you wanted. discern records the state of the work and nothing from the conversation, so a preference you only mentioned there needs saying again.

Your agent runs `discern status`, then confirms the worktree belongs to this task before it edits anything, because an idle worktree may still belong to another task. A useful update says what you can already try and what your agent will do next, so you can correct it before it carries on. Then it acts on what it finds:

| What it finds                 | What it does                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes.          | Reads them and carries on with the intended work.                                                                                                                                     |
| Unfinished setup.             | Follows the recovery that status names, and [asks you first](../40-troubleshooting/setup-and-integrations.md#a-worktree-setup-step-may-have-finished) if a step may already have run. |
| New work on `main`, mid-task. | Runs `discern update` and rereads the files both changes touched.                                                                                                                     |
| Current Proof.                | Checks whether the task was submitted and may land.                                                                                                                                   |
| Stale Proof.                  | Commits the version it means to finish, and runs `discern done` again.                                                                                                                |

Any later edit makes Proof stale, but a newer `main` doesn't, as [Why Proof becomes stale](../10-understand/proof.md#why-proof-becomes-stale) explains.

[Finish and land a change](finish-and-land-a-change.md) covers the usual path from here.

## Stop a run you can no longer see

If your coding tool gives up on a long call, the run may still be going, or may have been cancelled. Either way, your agent reads the run back instead of starting it again, so a lost call doesn't cost a second run.

discern records every long run, such as `discern done` or `discern accept`, behind a short **progress handle**, which your agent's tool receives when the run starts:

```text
done is running. If this call is lost, `discern progress R1-H596-N6BT-K5` reads it back.
```

That command reads the run back: whether it's still going, and which commands have failed so far. Once the run finishes, the reading shows the full result:

```text
`done` on agent/recipe-search-0a7563 finished and succeeded. Its result was retained; reading it does not rerun the operation.
```

Without the handle, `discern progress` reads the worktree's most recent run, and `discern status` shows one that's still going. Reading a run never stops or restarts it, and a run whose process died reads as stopped without finishing. To stop a run, stop it where it started, such as by closing its terminal.

## Recover an interrupted acceptance

A landing can stop partway, such as after `main` moves but before discern records the **Proof note**, the copy of the Proof it attaches to the landed commit. discern can always tell whether the change reached `main`, because it writes down what it's about to do first, then moves `main` in one step that happens completely or not at all.

Ask your agent:

> "Check the interrupted landing. Tell me whether the change landed and what cleanup is left, then finish the landing I already approved."

When your agent retries, discern reads that record. If `main` moved, the retry finishes the remaining steps, without landing the change twice or asking for your permission again. If `main` didn't move, the retry undoes the attempt and says what stood in the way.

The result's `data.root` field names the surviving checkout, where your agent carries on. Every discern command that changes your project can preview its plan, so your agent checks what a retry would do first.

```sh
discern accept --dry-run
```

Your agent keeps anything that changed unexpectedly, because deleting it would destroy the evidence it needs.

Ask for a summary in terms you recognize, such as "the search change landed, its Proof note still needs recording, and the worktree stayed because a preview server was writing in it." The [result reference](../30-reference/mcp-and-results.md#completion-and-landing-results) lists the fields behind it. A worktree can stay after the change lands, and [After it lands](finish-and-land-a-change.md#after-it-lands) lists why. Recovery is done when you know what landed, and why anything is still there.

## Recover a dropped branch

discern keeps a local way back to a dropped task's committed work. Before `discern worktree drop` deletes a branch, it saves the branch's last commit under `refs/discern/recovery/` and prints the saved reference's name. Your repository keeps the newest 32, and they stay local.

Only committed work comes back: a forced drop deletes uncommitted, untracked, and ignored files for good.

Say you dropped the recipe search task last week and want it back. Give your agent the printed reference, or it lists what's kept, newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

It checks each entry's branch name, date, and commits, because the newest one may belong to a different task. Then it makes an ordinary branch at the chosen reference, without switching your main checkout, your original project folder.

```sh
git branch recovered-work refs/discern/recovery/20260811T120000000Z-recipe-search-0a7563-1234abcd
git log --stat recovered-work
```

To carry on, it starts a new worktree from that branch.

```sh
discern start --name recovered-work --from recovered-work
```

Review the restored work before you rely on it, and keep the saved reference until you have. The resumed task needs new Proof and its own permission to land. For a branch lost some other way, `git reflog` may help.
