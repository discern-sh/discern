---
id: guide-recover-an-interrupted-task
title: "Recover an interrupted task"
description: "Pick up an unfinished task, find out what happened during an interrupted landing, or restore retained committed work."
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
---

# Recover an interrupted task

A closed session does not necessarily mean lost work. A task's worktree can hold its files, commits, setup state, and completion evidence after the conversation ends. Start by asking your agent to find out what remains:

> Continue the recipe-search task in its existing worktree. Read discern's status, inspect the saved work, and tell me what finished and what remains. Preserve anything unfamiliar and follow the recovery instructions before making further changes.

Include the task's worktree path or branch name when you have it, along with the outcome you wanted. Repository records can recover the work's state. A preference or decision that existed only in the old conversation may need explaining again.

## Resume an unfinished worktree

Your agent calls `discern status` at the task's recorded path. If that path is unavailable, it checks the main checkout to learn what happened. It should identify this effort before editing; another task's idle workspace is still another task's workspace.

For example, the recipe-search interface might be committed while a test is still unfinished. A useful update would explain which part you can already try, what the test is checking, and what the agent will do next. You can then correct its understanding before it continues.

The next step follows the observed state:

| What remains                                   | How work continues                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Uncommitted changes                            | The agent reads the files and continues from the intended work.                               |
| Incomplete setup                               | It follows the named setup or environment recovery.                                           |
| New work on the shared branch                  | It follows discern's update instructions and reviews any overlapping changes.                 |
| Current Proof                                  | It checks the task's landing and authoring state before deciding whether more work is needed. |
| A released workspace or interrupted validation | It follows the recorded recovery route before editing.                                        |

Keep the same worktree through the resumed task and its review. If the original cannot be recovered, establish that fact before starting a replacement. [Finish and land a change](finish-and-land-a-change.md) covers the normal path once work resumes.

## Return a workspace after interrupted validation

discern can temporarily use an eligible workspace to validate a candidate, the proposed version of a change. If that process stops before returning the workspace to its author, status names the environment and the recovery action.

You can ask:

> Recover this task's validation workspace. Explain any files or processes that prevent its return, and preserve the retained artifacts.

Your agent previews the return from the owning worktree, using the environment ID supplied by the result:

```sh
discern done --recover <environment-id> --dry-run
```

It resolves the reported condition, then runs the same command without `--dry-run`. Recovery checks that child processes have stopped, accounts for retained files, and returns authoring control when the recorded conditions hold. Unfamiliar files or a changed branch can require investigation first.

This recovery action runs no validation and lands no change. After the workspace returns, ordinary `discern done` can reuse applicable passing evidence and obtain anything still missing. Use `--rerun` when the result calls for a deliberate new validation attempt.

## Recover an interrupted acceptance

An acceptance can land a change and then stop while updating the main checkout, recording its Proof note, or cleaning up. The first useful question is whether the change reached the shared branch.

Ask your agent:

> Check the interrupted acceptance. Tell me which changes landed, which remain pending, and what cleanup or recovery is still needed. Continue the recorded recovery for the landing I already approved.

The result accounts for each task separately. A later failure does not undo an earlier landing, and that completed landing does not need a second approval. Any task still awaiting evidence or permission remains pending on its own terms.

### Read the surviving location and effects

The result's `data.root` gives the surviving checkout path. Your agent continues there even if the original worktree has been removed. Shared repository records retain the landing evidence.

Ask for a summary in terms of the work you recognize. For example:

> The search change landed. The documentation task is waiting for approval. Your old workspace remains because it contains files that need review.

That tells you what is already shared, which decision remains, and what must be preserved. The [completion and landing result reference](../30-reference/mcp-and-results.md#completion-and-landing-results) gives your agent the exact fields behind that account.

### Preview and follow the recorded recovery

From the surviving checkout, your agent previews acceptance:

```sh
discern accept --dry-run
```

It follows the reported remedy and retries acceptance when instructed. discern reconciles the recorded landing and resumes unfinished effects without landing that same change again or spending its permission twice.

Acceptance from the main checkout can also advance later ready tasks that have their own evidence and permission. The agent should inspect each row in the preview. A new exception or uncovered task comes back for the decision it needs.

If another process is handling the operation, let it finish. If files, branches, or resources have changed unexpectedly, preserve them and investigate the named condition. Forcing branch positions or deleting retained files would discard the evidence needed to choose the next step.

### Distinguish landed from retired

“Landed, workspace retained” can be a valid outcome. The change is already part of the shared project; the workspace remains because it is still held for editing or cannot yet be removed under its cleanup rules.

Recovery is accounted for when you know what landed, what remains pending, and why each retained workspace or resource remains. [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers cleanup and resource conditions.

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
