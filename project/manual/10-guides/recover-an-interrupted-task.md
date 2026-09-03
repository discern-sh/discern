---
id: guide-recover-an-interrupted-task
title: "Recover an interrupted task"
description: "Resume a partially completed or dropped task from durable state without widening cleanup."
order: 80
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
---

# Recover an interrupted task

Use this guide when a coding-agent session ended while its worktree still exists, an acceptance stopped partway through, or a worktree drop removed a branch you now need. Recovery begins from repository state and discern's recorded transition evidence. The missing conversation is unnecessary.

The safe action depends on what already happened. Observe first, then resume the same lifecycle command or restore a retained commit. Do not widen cleanup to make the state look tidy.

## Starting state

- Run from the task's existing worktree when it still exists. Run from the main checkout when status says the worktree is gone.
- Preserve any returned result, branch name, worktree path, recovery ref, or `data.landing` fields.
- Do not create a replacement worktree for the same effort until status proves the original is gone and the recovery route calls for one.

## Resume an unfinished worktree

**Coding agent:** Call `discern_status` with the existing worktree's absolute path. The command-line form is:

```sh
discern status
```

Read Git state, branch drift, Proof state, resources, pending refresh, and the result's next action. A worktree survives the session that created it; its branch and local Git-admin state carry the effort forward.

If the result says setup or environment readiness is incomplete, follow the named `discern worktree ensure` or setup recovery. If the branch is behind, use `discern_update`. If the tree is dirty, inspect and continue the work before running the Gate.

A returned session should be able to state its branch, current commit, changed files, last completed discern action, and immediate next action without consulting the earlier chat.

## Recover an interrupted acceptance

Acceptance can move the trunk before later checkout convergence or cleanup fails. Retrying must reconcile that recorded transaction instead of starting a new landing.

### 1. Read the surviving location and effects

**Coding agent:** Inspect the failed result's `data.root` and `data.landing`:

| Field                | What it establishes                                            |
| -------------------- | -------------------------------------------------------------- |
| `recovery_performed` | This call reconciled an earlier acceptance transaction.        |
| `trunk_landed`       | The trunk reached the accepted commit and was not rolled back. |
| `worktree_removed`   | The checkout and Git worktree registration are gone.           |
| `branch_deleted`     | The merged local branch is gone.                               |

Do not assume the original worktree still exists. When cleanup removed it, continue from the main checkout path returned in `data.root`.

### 2. Choose recovery from the recorded landing state

When `worktree_removed` is false, return to the original worktree and follow the result's recovery. If it calls for a retry, rerun acceptance there:

```sh
discern accept
```

discern reads that worktree's journal, marker, current refs, authority, and checkout state before acting. It reuses consent only when it is bound to the interrupted transaction. A Standard proposal or an authority record that cannot be verified still requires the person to supply the served approval.

When `worktree_removed` is true, do not rerun acceptance: `data.root` is the main checkout, the worktree-local journal is gone, and the trunk has already landed. From `data.root`, verify that the trunk still names the exact landed SHA reported by the Proof:

```sh
git rev-parse --verify '<trunk>^{commit}'
```

If Git still registers the removed checkout, run `discern worktree prune`. If `branch_deleted` is false, first verify that the retained branch still names the landed SHA, then delete it with Git's merged-only form:

```sh
git rev-parse --verify 'refs/heads/<branch>^{commit}'
git branch -d '<branch>'
```

Run the deletion only when the first command prints the exact landed SHA. This post-removal cleanup neither needs nor replays landing consent.

If another acceptance owns the repository lock, the refusal says that this call changed nothing. Wait for that operation to finish, then retry.

### 3. Distinguish landed from cleaned up

A result can be `ok: false` after `trunk_landed: true`. Later ensure, smoke, materialization, or deletion failures cannot undo the trunk move.

**Person and coding agent:** Treat the commit as landed when the result says so. Continue only the named convergence or cleanup action. Do not ask for a second landing decision or rerun the Gate for a commit already on the trunk.

Recovery is complete when status shows the trunk at the accepted commit and the result accounts for any checkout or branch that remains.

## Recover a dropped branch

`discern worktree drop` stores any branch tip it deletes (and any unlanded detached HEAD it discards) under `refs/discern/recovery/` before removing the checkout and prints the full ref. The newest 32 refs remain local to this clone.

### 1. Select the retained commit

Use the printed ref. If that output is unavailable, **coding agent or person:** list retained tips newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

Choose by branch identity, timestamp, and commit inspection. Do not select by recency alone when several tasks were dropped.

### 2. Restore and inspect a normal branch

```sh
git switch -c recovered-work refs/discern/recovery/20260811T120000000Z-example-1234abcd
git log --stat recovered-work
```

If work should resume under discern, start a new owned worktree from the recovered commit and re-root into the returned path:

```sh
discern start --name recovered-work --from recovered-work
```

Run the relevant focused checks, commit any new work, and produce fresh Proof. A recovery ref carries no current worktree Proof or landing authority.

### 3. Keep the data-loss boundary visible

The recovery ref retains committed Git objects only. Staged, modified, ignored, and untracked bytes do not belong to the branch tip. A forced drop can therefore destroy them without a discern recovery path.

Keep the recovery ref until the restored branch has been reviewed. Remove it later with `git update-ref -d <ref>` only when the person no longer needs it. Use `git reflog` for lost refs outside discern's drop workflow.

## When setup itself is ambiguous

A `[worktree.setup].steps` command recorded as `running` may have completed before the process ended. discern refuses automatic replay. Observe the external state, then have the person choose the served `--mark-step-complete <id> --confirmed` or `--retry-step <id> --confirmed` route. [Setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) holds that separate procedure.

## Completion

A resumed task is complete when its original worktree again has a grounded next action. Interrupted acceptance is complete when the trunk, checkout, and branch effects are accounted for and converged. Drop recovery is complete when a reviewed normal branch points at the intended retained commit and any resumed work has new Proof.

Use [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) when cleanup ownership, resources, or a reappeared path blocks recovery. Continue recovered implementation through [Finish and land a change](finish-and-land-a-change.md).
