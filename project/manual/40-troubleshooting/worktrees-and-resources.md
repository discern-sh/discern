---
id: troubleshoot-worktrees-and-resources
title: "Worktrees and resources"
description: "Find out why a task won't land or won't clean up, or why its app uses the wrong settings, and fix it without losing work."
order: 40
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-worktrees-and-resources"
  - "Reclaiming contained worktrees"
  - "contained worktree"
  - "worktree prune --contained"
  - "reclaim a worktree"
  - "spent train stage"
  - "Cleanup ownership and successful teardown"
  - "worktree cleanup ownership"
  - "verified teardown"
  - "branch cleanup"
  - "Reappeared worktree paths"
  - "reappeared worktree path"
  - "stale worktree files"
  - "files left after worktree removal"
  - "precondition_failed"
  - "awaiting_consent"
  - "partial_acceptance"
  - "provisioned_resources"
  - "worktree disk usage"
  - "landed but worktree remains"
---

# Worktrees and resources

Each task works in its own **worktree**, a separate copy of the project on its own branch. When a task won't land, its worktree won't go away, or its app uses the wrong database, this page helps you fix it without losing work. It keeps two questions apart: did the change land, and did cleanup finish?

The examples follow a recipe search task. Start from the task's own worktree and the result you saw. Ask your agent:

> Check the recipe search task and tell me what discern found. Keep its work, follow the recovery the result names, and tell me separately whether the change landed and whether cleanup finished.

Your agent keeps using the task's existing worktree. A worktree that looks clean or idle may belong to another task, so your agent never takes one over.

## `discern accept` refuses

`discern accept` lands a change on `main`, your project's shared branch. It needs current **Proof**, discern's record that your project's checks passed on that exact commit, and your permission. When it refuses, nothing has landed, and your worktree and its commits are untouched. The result names the reason:

| What the result says                                                      | What it means, and what to do                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The revision is submitted and waits in the landing queue for the owner.` | Nothing gives the change permission to land yet. Passing checks aren't permission. Approve it, pre-authorize it from the **desk** (the view that opens when you run `discern` in your main checkout), or leave it waiting. |
| `has no honored Proof at HEAD, so there is nothing proven to land`        | The latest commit has no current Proof. Your agent runs `discern done`, then `discern accept`.                                                                                                                             |
| `Main checkout at <path> has uncommitted tracked changes`                 | discern lands by moving `main` in your main checkout, so it must be clean. Commit or stash those changes, with whoever made them, then retry.                                                                              |
| `The main checkout at <path> is on '<branch>', not '<trunk>'`             | Switch your main checkout back to `main` with the command the result gives, then retry. An unfinished `git merge`, `git rebase`, or `git cherry-pick` there also blocks landing.                                           |
| `This branch's tracked refresh convergence is not proved.`                | discern's generated files on the branch are out of date. Your agent runs `discern refresh`, commits the files it names, runs `discern done`, then retries.                                                                 |

Once the cause is fixed and the change has permission, a retry lands it. Its result starts `Landed`.

A newer `main` doesn't cause a refusal. discern combines the change with it, checks the result, and lands what passed. If the two conflict or the combined checks fail, see [`main` moved before the change landed](gate-and-proof.md#main-moved-before-the-change-landed).

## A landing stopped partway

A landing has several steps. It moves `main`, attaches the Proof to the landed commit as a Git note, updates your main checkout, and removes the worktree. If it stops partway, read the result and `discern status` before trying again. They tell you whether the change reached `main`, whether its Proof note was attached, and whether the worktree was removed.

discern writes down what it's about to do before it moves `main`, and moves it in a single step. So a retry either finishes the remaining steps or undoes the attempt. It never lands the change twice, and never asks for your permission again. The code `partial_acceptance` means discern stopped after a step it can't undo, such as moving `main`. The result lists what already happened.

[Recover an interrupted acceptance](../10-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance) walks through the rest.

## A landed task's worktree stayed behind

The change is on `main`, and its worktree is still there. The first sentence of the landing result says why:

| What the result says                                              | What finishes cleanup                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `the branch holds later commits, so its checkout and branch stay` | Those commits came after the version that landed, so they haven't landed yet. Your agent runs `discern done`, then `discern accept`, for them. |
| `the checkout has uncommitted changes, so it and its branch stay` | Keep the changes you want by committing them. Your agent then runs `discern done`, then `discern accept`.                                      |
| `its Proof note was not recorded`                                 | Fix the reported Git-notes problem. Your agent then runs `discern accept` from that worktree, which records the note without landing again.    |
| `could not be removed: run discern worktree prune`                | A program is still using the folder, such as a preview server. Stop it, then run `discern worktree prune` from your main checkout.             |

If the result says `resource teardown failed`, the worktree and branch are gone, but a resource such as a test database remains. Fix the command that removes it, then run `discern worktree prune` from your main checkout.

None of these undoes the landing, and none needs you to approve the change again.

## Removal failed, or a removed path came back

**Removal reports that a path or Git's record of it remains.** Something is still writing there, such as an editor, a file watcher, or an open shell. Close it, or apply the Git repair the result names. Then repeat the command the result names. Removal has worked when both the folder and Git's record of it are gone.

Don't delete the parent folder or Git's records by hand. That skips the checks that tell this worktree apart from other work.

**A removed folder came back.** An editor can save into a worktree after discern removes it. If that happens during removal, the result says `Git no longer registers '<path>', but the retired path exists again.` If it happens later, status says `1 removed worktree path is present again.` Either way, close the program writing there, and preview the cleanup:

```sh
discern worktree prune --dry-run
```

Check the paths it lists before you go ahead. Prune only removes paths discern recorded removing, and it checks each one again first. It keeps a path it can't read, one that contains Git data, one that changes while it looks, or one with more than 1,000 entries. It's done when the path is gone and status no longer reports it. If the folder comes back again, the program writing to it is still running.

## Worktrees are taking up space

Land finished work first. A landing removes the task's worktree, its resources, and its branch when the branch holds nothing beyond what landed. For the rest, preview the cleanup from your main checkout:

```sh
discern worktree prune --dry-run
```

Sometimes a later task's branch already holds all the work of an earlier task. The earlier worktree is then **contained**, and the plan names the branch that holds its work. If you don't need the earlier worktree, preview reclaiming it:

```sh
discern worktree prune --contained --dry-run
```

Reclaiming removes the worktree, its resources, and its Proof, and keeps its branch. You can start from that branch again with `discern start --from <branch>`. An agent waiting for the earlier task to pass its checks gets a refusal that names the later branch.

You may also see worktrees whose branch starts with `integration/`. discern makes these temporary copies to check combined code when a change lands. Leave them alone. Prune removes one once the landing that made it has stopped.

## Pause a task without its worktree

To pause a task for a while, you can **park** it. Parking removes the worktree and its resources, and keeps the branch, its commits, and the task's title and brief. Preview it first:

```sh
discern worktree park <task> --dry-run
discern worktree park <task>
```

The preview names the branch and commit it keeps, and the folder and resources it removes. It also names the Proof, and any permission you gave the task to land once green. Both go with the worktree. Park refuses a worktree with uncommitted changes, one that isn't on its own task branch, one whose setup didn't finish, and one it can't read. It has no force option, because a branch can't hold uncommitted files.

To resume, choose **Resume** with the branch name from the desk's menu, or ask your agent to run `discern start --from <parked-branch>`. The saved title and brief come back if the branch hasn't moved. The resumed task needs new Proof and new permission to land.

## Cleanup kept something you expected it to remove

discern removes a worktree by itself only when it has a record that it created that worktree, and the current checks pass. A merged branch or a familiar name isn't enough. So cleanup keeps anything it can't account for, and the result says why.

To remove a worktree you've chosen, run `discern worktree drop <worktree>` from your main checkout. It takes the worktree's id, path, branch, or full branch reference. Preview it first with `--dry-run`. Drop won't throw away uncommitted changes, or commits that aren't on `main`, unless you add `--force`. If discern can't show that it owns the branch, it keeps the branch and says `is outside discern ownership`.

## A branch or worktree was dropped by mistake

Before `discern worktree drop` deletes a branch, it saves the branch's last commit and prints the name of the saved reference. Your repository keeps the newest 32 of these. [Recover a dropped branch](../10-guides/recover-an-interrupted-task.md#recover-a-dropped-branch) shows how to list them and bring the work back.

Only committed work comes back. A forced drop deletes uncommitted, untracked, and ignored files for good. For a branch lost some other way, `git reflog` may help.

## An app uses the wrong port, database, or setting

Each worktree gets its own port, and its own copy of any **resource** your project declares, such as a test database. If a task's app uses the wrong one, run these in the affected worktree, using the resource name from your configuration:

```sh
discern identity
discern identity --resource <name>
```

Ask your agent to compare those values with what the app reads. Say the preview shows another task's saved recipes. It's probably connected to that task's database. Finding the mismatch helps more than creating another resource.

| What you see                                           | What to do                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A resource failed to start, or it's unclear if it did. | Read the failing output. A retry first cleans up with the remove command recorded before creation. If there's none, the agent resolves it before creating again.         |
| A value copied from the main checkout is missing.      | Check that its key is in `[worktree].inherit_env` and set in the main checkout's env files. Only named keys are copied, and a value already set in the worktree is kept. |
| The wrong value wins.                                  | Check the order of `[worktree].env_files`. The last file that sets a key wins. The default order is `.env`, then `.env.local`.                                           |
| A resource remains after its worktree is gone.         | Preview `discern worktree prune --dry-run`. Prune removes recorded resources it can. One your configuration leaves out needs removing by hand.                           |

Changing a value in the main checkout doesn't update existing worktrees. Fix it in the affected worktree, then check that the app uses its own values. The [environment settings reference](../30-reference/worktrees-and-status.md#inherit-selected-env-values) has the exact rules.

Keep discern's list of resources during recovery. It holds the command that removes each one, and `discern uninstall` refuses with `provisioned_resources` while any remain.

## Ignored files changed in a worktree

Files Git ignores, such as `.env` or local test data, aren't in any commit. Before a worktree goes, copy out anything you want to keep.

By default, `discern accept` and its preview list the ignored paths that changed since the worktree was set up. The list is a warning. It doesn't save the files. The `[worktree].track_ignored_drift` setting turns it off, and the [configuration reference](../30-reference/config-reference.md#worktree) covers it.

## A task on the desk looks wrong

On the desk, select a task that shows broken or unfinished setup, a missing folder, or Git state discern can't read. Then choose **Show recovery steps**. It shows what discern could see, what it couldn't read, and the next command to run.

**Retry setup** appears when no setup step is in doubt. If a step is recorded as still running, see [A worktree setup step may have finished](setup-and-integrations.md#a-worktree-setup-step-may-have-finished).

If your main checkout has local changes that block landing, choose **Main checkout** from the desk's menu. From there you can see its status and changes, or open a shell or editor in it.

After an action the desk refused, it checks every task again. A notice such as `Task landed` or `Task checkout closed; branch available to resume` says what changed.

Don't repair a confusing task by deleting folders or Git records by hand. Follow its recovery steps. Park, reclaim, drop, and prune each check who owns what before they remove anything.

## When to stop

Pause any cleanup that would remove work or a path you can't account for. Stop, too, when the result asks for your confirmation and you haven't given it. Sort out a program still writing to the folder, a setup step that may have run, or a resource you're unsure about before you try again.

If the recovery still fails, keep the output of `discern status --json` and the result. Leave discern's records in place, because the recovery needs them.
