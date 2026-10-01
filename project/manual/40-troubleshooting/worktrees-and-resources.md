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

When a task won't land, its worktree won't go away, or its app talks to the wrong database, you can fix it without losing work. Your agent works on each task in its own **worktree**, a separate copy of the project on its own branch.

Say your recipe search task should have landed, but something looks off. Ask your agent:

> "Check the recipe search task and keep its work. Tell me whether the change landed, and separately, whether cleanup finished."

Your agent never takes over another task's worktree, even an idle one.

## `discern accept` refuses

`discern accept` lands a change on `main`, your shared branch, only with your permission and current **Proof**: discern's record of which of your project's commands passed on one exact commit. A refusal lands nothing and leaves the worktree untouched:

| What the result says                                                                              | What to do                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The revision is submitted and waits in the landing queue for the owner.`                         | Current Proof isn't permission to land. Approve it, [pre-approve it](../20-guides/finish-and-land-a-change.md#pre-approve-routine-work), or leave it waiting. |
| `has no honored Proof at HEAD, so there is nothing proven to land`                                | Your agent runs `discern done`, then `discern accept`.                                                                                                        |
| `Main checkout at <path> has uncommitted tracked changes`                                         | Landing updates your main checkout, so it must be clean. Commit or stash the changes with whoever made them, then retry.                                      |
| `The main checkout at <path> is on '<branch>', not '<trunk>'` or `has an in-progress <operation>` | Switch back to `main`, or finish or abort the operation, with the command the result gives. Then retry.                                                       |
| `This branch's tracked refresh convergence is not proved.`                                        | Generated files are out of date. Your agent runs `discern refresh`, commits the result, runs `discern done`, and retries.                                     |

With the cause fixed and permission given, a retry lands the change. If combining it with a newer `main` fails, see [`main` moved before the change landed](gate-and-proof.md#main-moved-before-the-change-landed).

## A landing stopped partway

The code `partial_acceptance` means a landing stopped after a step it can't undo, such as moving `main`, and the result lists what already happened. Your agent reads that list before it retries. The retry finishes the remaining steps without landing twice or asking for your permission again, as [Recover an interrupted acceptance](../20-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance) explains.

## A landed task's worktree stayed behind

A normal landing result reads `Landed agent/recipe-search-ec0b65 at 0eecbd359d17 on main; its checkout, branch, and resources are gone.` When the worktree stays, that sentence says why:

| What the result says                                              | What finishes cleanup                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `the branch holds later commits, so its checkout and branch stay` | Your agent runs `discern done`, then `discern accept`, for them.                                                                            |
| `the checkout has uncommitted changes, so it and its branch stay` | Your agent commits what you want to keep, then takes the same route.                                                                        |
| `its Proof note was not recorded`                                 | Fix the reported Git-notes problem. Your agent then reruns `discern accept` in that worktree, which records the note without landing again. |
| `could not be removed: run discern worktree prune`                | A preview server or other program is using the folder. Stop it and run `discern worktree prune` from your main checkout.                    |

`resource teardown failed` means the worktree and branch are gone, but a resource such as a test database remains. Fix its remove command, then run `discern worktree prune` from your main checkout. None of these undoes the landing or needs new approval.

## Removal failed, or a removed path came back

**Removal reports that a path or Git's record of it remains.** Something such as an editor, a file watcher, or an open shell is still using it. Close it, or apply the Git repair the result names, then repeat the command. It worked when the folder and Git's record are both gone. Don't delete either by hand, because that skips the checks that tell this worktree apart from other work.

**A removed folder came back.** An editor can save into a worktree after discern removes it. During removal, the result says `Git no longer registers '<path>', but the retired path exists again.` Later, status says `1 removed worktree path is present again.` Either way, close the program writing there, then preview the cleanup:

```sh
discern worktree prune --dry-run
```

Check the listed paths before you go ahead. It's done when the path is gone and status no longer reports it. If the folder returns again, the program writing to it is still running.

## Worktrees are taking up space

Landing finished work removes its worktree, so land what's ready first. For the rest, preview the cleanup from your main checkout:

```sh
discern worktree prune --dry-run
```

Say a later task, adding filters to recipe search, started from the search branch and holds all its work. The search worktree is then **contained**, and if you don't need it, you can preview reclaiming it:

```sh
discern worktree prune --contained --dry-run
```

Reclaiming removes the worktree, its resources, and its Proof, and keeps its branch for a later `discern start --from <branch>`. To set aside a task you'll return to, [park it](../20-guides/coordinate-parallel-tasks.md#park-a-task-you-will-return-to) instead.

Leave `integration/` worktrees alone: discern makes them to check combined code at landing, and prune removes each once its landing stops.

## Cleanup kept something you expected it to remove

discern removes a worktree on its own only when its records show it created that worktree and its safety checks pass. A merged branch or a familiar name isn't enough, so cleanup keeps anything it can't account for and says why.

To remove a worktree you've chosen, run `discern worktree drop <worktree>` from your main checkout, after previewing it with `--dry-run`. Drop refuses a worktree with uncommitted changes or unlanded commits unless you add `--force`. It keeps a branch discern can't show it owns, and says `is outside discern ownership`.

## A branch or worktree was dropped by mistake

Drop saves the branch's last commit before deleting it and prints the saved reference, so committed work can come back. A forced drop deletes uncommitted, untracked, and ignored files for good. [Recover a dropped branch](../20-guides/recover-an-interrupted-task.md#recover-a-dropped-branch) shows how to restore the work.

## An app uses the wrong port, database, or setting

Each worktree gets its own port, and its own copy of any **resource** your project declares, such as a test database. Say the recipe search preview shows another task's saved recipes: it's probably using that task's database. Your agent compares what the app reads with discern's values for this worktree:

```sh
discern identity --port
discern identity --resource <name>
```

Fix the mismatch instead of creating another resource.

| What you see                                                | What to do                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A resource failed to start, or it's unclear whether it did. | Read the failing output. A retry first runs the remove command recorded before creation.                                               |
| A value copied from the main checkout is missing.           | Check that its key is in `[worktree].inherit_env` and set in the main checkout's env files. An existing worktree value is kept.        |
| The wrong value wins.                                       | Check the order of `[worktree].env_files`. The last file that sets a key wins, so by default `.env.local` beats `.env`.                |
| A resource remains after its worktree is gone.              | Preview `discern worktree prune --dry-run`. Prune removes recorded resources it can. Remove one your configuration leaves out by hand. |

Changing a value in the main checkout doesn't update existing worktrees, so fix it in the affected worktree. The [environment settings reference](../30-reference/worktrees-and-status.md#inherit-selected-env-values) has the exact rules. Keep discern's list of resources during recovery, because it holds each one's remove command, and `discern uninstall` refuses with `provisioned_resources` while any remain.

## Ignored files changed in a worktree

Files Git ignores, such as `.env` or local test data, aren't in any commit, so copy out what you want to keep before a worktree goes. `discern accept` and its preview warn about ignored paths that changed since setup, but don't save them.

## A task on the desk looks wrong

The **desk** is the interactive view that opens when you run `discern` in your main checkout. When a task there shows broken setup, a missing folder, or Git state discern can't read, select it. Its next step is **Recovery steps**, which shows what discern could and couldn't read, and the next command to run. **Retry setup…** appears instead when no setup step is in doubt. If one may still be running, see [A worktree setup step may have finished](setup-and-integrations.md#a-worktree-setup-step-may-have-finished).

To see local changes that block landing, choose **Main checkout** from the desk's menu. After a refused action, the desk rechecks every task and says what changed.

## When to stop

Stop any cleanup that would remove work or a path you can't account for, and any step that asks for a confirmation you haven't given. If recovery still fails, keep the result and the output of `discern status --json`, and leave discern's records in place, because the recovery needs them.
