---
id: guide-recover-an-interrupted-task
title: "Recover an interrupted task"
description: "Pick up an unfinished task, find out what happened during an interrupted check or landing, or restore committed work from a dropped branch."
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

A closed session does not necessarily mean lost work. A task's worktree can hold its files, commits, setup state, and completion evidence after the conversation ends. Start by asking your agent to find out what remains:

> Continue the recipe-search task in its existing worktree. Read discern's status, inspect the saved work, and tell me what finished and what remains. Preserve anything unfamiliar and follow the recovery instructions before making further changes.

Include the task's worktree path or branch name when you have it, along with the outcome you wanted. Repository records can recover the work's state. A preference or decision that existed only in the old conversation may need explaining again.

## Resume an unfinished worktree

Your agent calls `discern status` at the task's recorded path. If that path is unavailable, it checks the main checkout to learn what happened. It should identify this effort before editing; another task's idle workspace is still another task's workspace.

For example, the recipe-search interface might be committed while a test is still unfinished. A useful update would explain which part you can already try, what the test is checking, and what the agent will do next. You can then correct its understanding before it continues.

The next step follows the observed state:

| What remains                  | How work continues                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes           | The agent reads the files and continues from the intended work.                                                                                                             |
| Incomplete setup              | It follows the named setup or resource recovery.                                                                                                                            |
| New work on the shared branch | It runs `discern update` and reviews any overlapping changes.                                                                                                               |
| Current Proof                 | It checks whether the task was submitted and what permission it has before deciding whether more work is needed.                                                            |
| Stale Proof                   | Something changed since the checks ran: an edit, the shared branch, or a review answer. It commits the intended state and runs `discern done`; unchanged checks are reused. |

Keep the same worktree through the resumed task and its review. If the original cannot be recovered, establish that fact before starting a replacement. [Finish and land a change](finish-and-land-a-change.md) covers the normal path once work resumes.

## Stop a run you can no longer see

If you close a terminal, or your coding tool gives up on a long call, the checks may still be running. Stopping the wait stops only the waiting. Every long run announces a short handle when it starts, in a line like `done is running. If this call is lost, discern progress R1-H596-N6BT-K5 reads it back.` Ask your agent to read the run back with that handle before doing anything else:

```sh
discern progress R1-H596-N6BT-K5
```

The reading says whether the run is still going, what it has counted and which checks have failed so far, and, once it finishes, its complete result. Without a handle, `discern progress` reads the most recent run started from that workspace. A run that is still alive finishes on its own. A run whose process has died reads as stopped without finishing.

Never repeat the checks to recover their output. The reading keeps the result, and each check's full transcript stays in the file the result names.

## Recover an interrupted acceptance

An acceptance can land a change and then stop while updating the main checkout, recording its Proof note, or removing the worktree. The first useful question is whether the change reached the shared branch.

Ask your agent:

> Check the interrupted acceptance. Tell me whether the change landed, and what cleanup or recovery is still needed. Continue the recorded recovery for the landing I already approved.

discern writes a record of the landing before it moves the shared branch, and it moves the branch in one step that either happens or does not. A retry reads that record. If the branch moved, the retry finishes the remaining steps without landing the change again or asking for your permission a second time. If the branch did not move, the retry rolls the attempt back and reports what stood in the way.

### Read the surviving location and effects

The result's `data.root` gives the surviving checkout path. Your agent continues there even if the original worktree has been removed. Shared repository records retain the landing evidence.

Ask for a summary in terms of the work you recognize. For example:

> The search change landed. Its Proof note still needs recording, and the worktree stayed because a preview server was writing in it.

That tells you what is already shared and what must be preserved. The [completion and landing result reference](../30-reference/mcp-and-results.md#completion-and-landing-results) gives your agent the exact fields behind that account.

### Preview and follow the recorded recovery

From the surviving checkout, your agent previews acceptance:

```sh
discern accept --dry-run
```

From the main checkout, it adds `--target <task>` to name the task you approved. It follows the reported remedy and retries acceptance when instructed.

If another process is handling the operation, let it finish. If files, branches, or resources have changed unexpectedly, preserve them and investigate the named condition. Forcing branch positions or deleting files would discard the evidence needed to choose the next step.

### When the worktree stays after landing

A landing whose worktree stays can be a valid outcome. The change is already part of the shared project; the worktree remains because its branch gained commits after the submission, or because cleanup could not complete. The result says which and names the command that finishes the work: `discern done` then `discern accept` for the new commits, or `discern worktree prune` from the main checkout once whatever blocked the removal has stopped.

Recovery is accounted for when you know what landed and why any remaining worktree or resource remains. [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers cleanup and resource conditions.

## Recover a dropped branch

If you dropped a task and later want its committed work back, discern keeps a limited local recovery route. Before deleting a branch tip, `discern worktree drop` saves it under `refs/discern/recovery/` and prints the full reference. The newest 32 references remain in that clone.

Tell your agent which task you want to restore and provide the printed reference if available. It can otherwise list retained commits:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

The agent checks the branch identity, date, and commit contents. The most recent entry may belong to a different task.

It can create a normal branch at the selected reference without switching the main checkout. Use the reference returned for your task in place of this example:

```sh
git branch recovered-work refs/discern/recovery/20260811T120000000Z-example-1234abcd
git log --stat recovered-work
```

To resume implementation, it starts a new worktree from that recovered branch and moves into the returned path:

```sh
discern start --name recovered-work --from recovered-work
```

Review the restored work before relying on it. It needs fresh completion evidence and landing permission for the resumed effort.

Recovery references preserve committed Git objects. Edits that were only staged, modified, ignored, or untracked are absent from the saved branch tip. A forced drop can destroy those files without a discern recovery path. Keep the reference until you have checked the restored work; `git reflog` may help with lost references outside discern's drop workflow.

## When setup itself is ambiguous

A setup command recorded as running may have completed before the process ended. Repeating it could repeat an external effect, so discern asks for that state to be inspected first.

Your agent should explain what it found and recommend whether to mark the step complete or retry it. You decide using the observed result. [Setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) covers the exact confirmation routes.
