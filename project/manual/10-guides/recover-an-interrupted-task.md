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
- Preserve any returned result, branch name, worktree path, recovery ref, or `data.queue` fields.
- Do not create a replacement worktree for the same effort until status proves the original is gone and the recovery route calls for one.

## Resume an unfinished worktree

**Coding agent:** Call `discern_status` with the existing worktree's absolute path. The command-line form is:

```sh
discern status
```

Read Git state, branch drift, Proof state, resources, pending refresh, and the result's next action. A worktree survives the session that created it; its branch and local Git-admin state carry the effort forward.

If the result says setup or environment readiness is incomplete, follow the named `discern worktree ensure` or setup recovery. If the branch is behind, use `discern_update`. If the tree is dirty, inspect and continue the work before running the gate.

A returned session should be able to state its branch, current commit, changed files, last completed discern action, and immediate next action without consulting the earlier chat.

## Recover an interrupted acceptance

Acceptance can move the trunk before later checkout convergence or cleanup fails. Retrying must reconcile that recorded transaction instead of starting a new landing.

### 1. Read the surviving location and effects

**Coding agent:** Inspect the result's `data.root` and `data.queue`. Each queue row names one task and accounts for its own landing:

| Field                      | What it establishes                                            |
| -------------------------- | -------------------------------------------------------------- |
| `state`                    | Whether this task landed or is still pending.                  |
| `expected_trunk`, `target` | The exact before-and-after commits for this landing.           |
| `authority_settlement`     | Whether the landing's recorded authority was consumed.         |
| `retirement`               | Whether its checkout was retired, retained, or needs recovery. |
| `pending`                  | The conditions preventing further progress.                    |

Do not assume the original worktree still exists. Continue from the surviving path returned in `data.root`; recovery evidence remains in the repository's shared Git storage after checkout removal.

### 2. Preview and follow the recorded recovery

**Coding agent:** Review the remaining work from that location:

```sh
discern accept --dry-run
```

Resolve the condition named by the result. When it calls for a retry, run `discern accept` again. The engine reads the recorded transition, current refs, authority settlement and checkout state before acting. Note publication and checkout retirement can resume after the source checkout is gone; neither repeats the landing nor spends its authority again.

From the main checkout, acceptance can also advance later ready tasks that each have their own current Proof and authority. Review each row in the preview. **Person:** Supply any new landing decision, standard-proposal approval or checkpoint variance the result requires. A recorded grant cannot supply those last two decisions.

If another actor owns the operation, wait for it to finish before retrying. If recovery reports that a ref, checkout or resource changed unexpectedly, preserve that state and follow the named diagnosis. Do not force refs or delete a retained branch to make the result look complete.

### 3. Distinguish landed from retired

A result can report a failure after an earlier task landed. A later note or retirement failure cannot undo that trunk transition.

**Person and coding agent:** Treat each task as landed when its row says so. Continue the named recovery action without asking for a second decision on the same recorded landing. A task still awaiting evidence, judgment or authority remains pending independently.

Recovery is complete when the result accounts for every recorded landing and any checkout, branch or resource that remains. A retained checkout can be the correct result.

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
