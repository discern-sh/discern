---
id: troubleshoot-worktrees-and-resources
title: "Worktrees and resources"
description: "Recover an interrupted task, resolve cleanup problems, and check its local services and environment settings."
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
  - "retired worktree path"
  - "precondition_failed"
  - "awaiting_consent"
  - "partial_acceptance"
  - "provisioned_resources"
  - "worktree disk usage"
  - "checkout kept"
  - "landed but worktree remains"
  - "stale queue entry"
  - "wrong task landed"
---

# Worktrees and resources

Start with `discern status` and the lifecycle command's result. Ask your agent:

> Identify the affected task and what discern observed. Preserve its work, follow the named recovery, and tell me whether the change has landed separately from whether cleanup finished.

Keep the task's existing worktree where available. A clean or idle-looking row may belong to another effort. The cases below help you choose the right repair without reconstructing the task from scratch.

## A lifecycle command refuses

Read the named condition before retrying:

| Condition                                                   | Next action                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The worktree has uncommitted changes                        | Review and commit intended work. Preserve unfamiliar files and resolve their ownership before removing them.                                                                     |
| The proposed landing needs the latest trunk                 | Follow the result. Acceptance can compose and validate it in an eligible released workspace; otherwise the source agent updates, reviews the overlap, and runs completion again. |
| The main checkout has local changes or is on another branch | Resolve those changes with their owner and return main to the trunk before retrying the operation that needs it.                                                                 |
| Generated output needs repair                               | Run the named generator or refresh action, review its changes, and complete validation on the intended result.                                                                   |
| Landing authority is missing                                | Review the proposed change and the requested consent. Passing Proof alone does not authorize landing.                                                                            |

Acceptance accounts for each task separately. Read every task's outcome: an earlier change may have landed while a later one remains pending. [Landing result fields](../30-reference/mcp-and-results.md#the-discernresult-envelope) give the structured contract.

## Acceptance was interrupted partway

Read status and the acceptance result before attempting another landing. Ask which tasks landed, whether their Proof notes were recorded locally, and whether their checkouts were retained, removed, or left needing recovery.

If landing already happened, the reported recovery reconciles the recorded transition and remaining work without spending its authority again. A cleanup failure does not undo the landed change. If landing did not happen, resolve the named blocker and follow the returned acceptance action.

A retained checkout can be expected: acceptance removes only eligible released checkouts. Keeping authoring control with `discern done --retain-checkout` also keeps the checkout from automatic retirement.

[Recover an interrupted acceptance](../10-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance) walks through the full procedure. If the problem instead concerns a workspace still held by validation, use [workspace recovery](../10-guides/recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation).

## Removal failed, or a removed path came back

**Removal reports a remaining path or registration.** Read which check failed. Close the editor, watcher, or shell still writing to that path, or perform the specific Git registration repair named in the result. Then repeat the reported lifecycle action.

Success means both the filesystem path and Git's registration are absent. If the same writer recreates the files, address that writer before trying again. Deleting a parent directory or clearing Git metadata bypasses the checks that distinguish this checkout from other work.

**A removed directory reappeared.** An editor can save into a checkout after it was removed. When discern has recorded that removal, status can identify the reappeared path. Close its writer and inspect the cleanup plan:

```sh
discern worktree prune --dry-run
```

Review the exact paths before authorizing the prune. It uses discern's own removal records and rechecks Git registration and filesystem state. A similar-looking neighboring directory is outside that authority. Unreadable paths, paths containing Git metadata, or paths that change during inspection are kept.

Success is the recorded path absent and its status finding cleared. If it appears again, the writer still needs attention.

## A finished stage's checkout is taking space

Preview the available cleanup:

```sh
discern worktree prune --dry-run
```

A **contained** worktree has a clean, idle checkout whose committed work is already included in another live branch. The plan names that containing branch. If you no longer need the earlier checkout or its local files, preview its explicit reclaim option:

```sh
discern worktree prune --contained --dry-run
```

Reclaim removes the checkout, its resources, and its worktree-local Proof after confirmation. Its branch ref remains available for `discern start --from <branch>`. A later `discern await --green` watch on the removed checkout refuses and points to the containing branch.

For finished work ready to land, use acceptance first and read its retirement outcome. A retained checkout may still be useful or ineligible for automatic removal; landing alone does not guarantee that its directory disappears.

## A healthy task should pause without its checkout

Use Park when the unlanded branch should remain resumable but its checkout and resources are no longer needed:

```sh
discern worktree park <target> --dry-run
discern worktree park <target>
```

Review the preview before confirming. It names the kept branch and commit, retained task wording, destroyed resources, removed checkout, and consumed worktree-local Proof and landing grant. Park refuses a dirty, unreadable, setup-incomplete, trunk, detached, or branch-mismatched checkout. It has no force option: a branch cannot preserve uncommitted files.

After success, open the branch under **Work without a worktree** in the desk, or resume directly:

```sh
discern start --from <parked-branch>
```

The saved title and brief become defaults when the branch still points at the parked commit. Use Reclaim for a contained stage and Drop for an effort you intend to discard.

## Cleanup kept something you expected it to remove

Read the reason it was kept. Automatic cleanup needs recorded ownership, matching identity, and the relevant current-state checks. A merged branch or a familiar name alone cannot establish that discern owns its checkout.

For a deliberately chosen foreign checkout, `discern worktree drop <worktree>` accepts its exact id, path, local branch, or full local ref. Review that destructive action explicitly. When discern cannot prove ownership of the branch, it keeps the branch ref.

For a landed task, a kept workspace and a workspace whose cleanup needs recovery are different outcomes. The first is a choice or a protection; the second names unfinished cleanup to resolve. Use the returned reason rather than assuming every remaining directory is a failed removal.

## A landed task's workspace stayed behind

The change is on the shared branch, and its worktree is still there. The landing result and `discern status` say why in one sentence. The reasons, and what finishes cleanup:

| Why it stayed                     | What finishes cleanup                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| It was never released for cleanup | It was kept for review or further edits. Stop active use, have the agent run `discern done --release-checkout` there, then `discern accept` from the main checkout. |
| It is still in use                | Stop the preview or other operation running in it, then retry `discern accept` from the main checkout.                                                              |
| The branch changed after landing  | New commits exist that never landed. Preserve them and read `discern status` from that worktree before deciding what they are.                                      |
| It contains changed files         | Preserve and review them before retrying cleanup from the main checkout.                                                                                            |
| Ownership could not be verified   | Preserve its files and resources and inspect `discern status --verbose` from the main checkout.                                                                     |

None of these undo the landing, and none need the change approved again. If the result says cleanup needs recovery rather than that the workspace was kept, follow the named recovery instead.

## The landing result was about a different task

Acceptance lands finished tasks in a stable order, so a run from one worktree can land approved tasks ahead of it and stop at one that needs approval. The result answers about the task you ran it from first, in a line that starts `Selected effort` and names your branch: landed, or not landed and why. Read that line before the sections headed `Ahead of it in the queue` and `Behind it in the queue`; a Proof line under another task's branch is that task's, not yours.

If you ran acceptance from the main checkout with several tasks pending, name the task you mean with `--target`. [Finish and land a change](../10-guides/finish-and-land-a-change.md#land-under-verified-authority) explains the order.

## A queue entry is stale

A task whose work is already on the shared branch, but that discern never landed, keeps a waiting entry. Its own row in status and in the acceptance preview says `Its work is already on main` and offers the two ways to settle it: withdraw the entry if the work is not coming back through discern, or reconcile it when the exact proven version is on the shared branch. Both start with a preview and apply with its token; neither lands anything or spends any approval. [Reconcile work that reached the trunk another way](../10-guides/recover-an-interrupted-task.md#reconcile-work-that-reached-the-trunk-another-way) gives the procedure.

## A validation run was abandoned

Status names a validation environment and says no executor is active. The workspace has not been returned to its author. Have the agent recover it from the owning worktree with `discern done --recover <environment-id>`; recovery does not wait for the run's time limit and stops safely if a process from the run is still alive or its state is unknown. [Return a workspace after interrupted validation](../10-guides/recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation) lists the conditions.

## A branch or worktree was dropped by mistake

Find the recovery ref printed by `discern worktree drop`. The [dropped-branch recovery procedure](../10-guides/recover-an-interrupted-task.md#recover-a-dropped-branch) shows how to list the retained refs and restore committed work.

Those refs preserve committed tips, with a bounded retention count. They cannot recover uncommitted, untracked, or ignored files discarded by a forced drop. For a ref lost outside discern's lifecycle, investigate Git's reflog before further cleanup.

## A resource, port, or environment value is wrong

Run these from the affected worktree, using the resource name from its configuration:

```sh
discern identity
discern identity --resource <name>
```

Have the agent compare those values with what the application actually reads. For example, a preview showing another task's saved recipes may be connected to that task's database. Finding the mismatch is more useful than creating another resource immediately.

| Symptom                                              | Next action                                                                                                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource creation failed or its outcome is uncertain | Read the failing output and recorded recovery. A retry first uses the destroy action recorded before creation to reconcile uncertain state. If that is unavailable or fails, resolve the named resource before another create attempt. |
| An inherited environment value is missing            | Check that its key is in `[worktree].inherit_env` and is defined in main's configured env files. Only named values are copied, not entire files.                                                                                       |
| The wrong env value wins                             | Check the ordered `[worktree].env_files` list. The last file defining a key supplies its value. See the [env rules](../30-reference/worktrees-and-status.md#inherit-selected-env-values).                                              |
| A resource remains after its worktree vanished       | Preview `discern worktree prune --dry-run` and inspect the recorded resource. Garbage collection acts on eligible recorded resources; a resource configured out of it needs the project's own teardown.                                |

Changing a value in main does not update an existing worktree automatically. Make the intended correction in the affected worktree, following the project's configuration, and verify the application now uses its own identity and resource.

Keep the resource ledger during recovery. It stores the recorded teardown action; uninstall refuses while recorded resources remain.

## Ignored files changed under a worktree

Read the named files before releasing or removing the checkout. Ignored files may hold local settings or data that no commit preserves. Copy out anything you want to keep.

When enabled, discern compares ignored files with the baseline recorded during worktree setup. That comparison is advisory; it does not preserve the file contents for you. Completion's separate workspace checks may also retain a checkout when its state no longer matches the recorded release.

For the optional comparison setting, see `[worktree].ignored_file_drift` in the [configuration reference](../30-reference/config-reference.md). Disabling the report does not turn local-only files into recoverable Git history.

## A fleet row looks wrong

`discern status` from the main checkout surveys every worktree. Open the row in `discern desk` and choose **Show recovery steps** when it reports broken setup, incomplete setup, a missing checkout, or unreadable Git state. The recovery view separates what discern observed from what remains unavailable:

- the exact Git or setup failure and command;
- Git registration, branch reachability, and filesystem presence;
- checkout, branch, task, and resource identities;
- setup-ready marker and step-journal evidence;
- the last lifecycle result and one next command.

`Retry setup` is available when no setup step remains ambiguous. A journal with a running one-shot step serves the specific owner-confirmed recovery command. A missing journal beside configured one-shot steps serves `discern worktree setup begin --dry-run` for inspection. An unreadable Git registration serves its failed Git command or `discern doctor`. The task remains intact while those checks are unresolved.

If main has local changes or unreadable Git state, choose **Inspect main checkout**. Its detail can show status and diff or open a shell or editor at main. It also names the landing and cleanup operations that remain blocked. Main stays outside the task list, and agent work remains in linked worktrees.

After a refused repair or cleanup, the desk surveys again. `Task changed; refreshed` means the selected row changed or disappeared. A parked task opens its resumable branch. A task found in local landing evidence reports `Task landed; refreshed` and remains available under **Recent completed tasks**.

Never adopt another effort's worktree because it looks idle or clean. Do not repair a confusing row by deleting a path or Git registration by hand. Follow its diagnosis first. Park, Reclaim, Drop, and prune each apply their own ownership and final-state checks.

## When to stop

Pause destructive cleanup when you cannot account for the work or path it would remove, or when the reported owner confirmation has not been given. Resolve an active writer, ambiguous setup effect, or uncertain external resource before retrying its teardown.

If the supported recovery still fails, keep `discern status --json` and the lifecycle result for investigation. Preserve the named state; deleting Git records by hand can remove the evidence the recovery needs.
