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

A closed session doesn't lose the work. Each task has its own **worktree**, a separate copy of the project on its own branch. It keeps the task's files, commits, and setup after the conversation ends. It also keeps the task's **Proof**, discern's record of which checks passed on exactly which commit. And discern keeps a record of any long run or landing that stopped partway. A new session can pick up where the last one left off, and you don't have to rebuild the task from old chat history.

This guide follows a recipe search task whose session ended before the work was done. Ask your agent to start from what's recorded:

> Continue the recipe search task in its existing worktree. Check discern's status, look at the saved work, and tell me what's finished and what's left. Keep anything you don't recognize, and follow discern's recovery steps before you change anything.

Give it the task's worktree path or branch if you have them, and remind it what you wanted. The project records the state of the work. A preference you only mentioned in the old conversation needs saying again.

## Resume an unfinished worktree

Your agent runs `discern status` in the task's worktree. If that folder is gone, the agent checks from your main checkout to learn what happened. It confirms which worktree belongs to this task before it edits anything, because an idle worktree may still belong to another task.

A useful update tells you where things stand. Say the search box is committed, but one test isn't finished. The agent tells you what you can already try, what the test checks, and what it'll do next. You can correct it before it carries on.

What happens next depends on what the agent finds:

| What it finds                 | What it does                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes.          | It reads them and carries on with the intended work.                                                                            |
| Unfinished setup.             | It follows the setup or resource recovery that status names.                                                                    |
| New work on `main`, mid-task. | It runs `discern update` and rereads any files both changes touched.                                                            |
| Current Proof.                | It checks whether the task was submitted and may land, before deciding what's left.                                             |
| Stale Proof.                  | It commits the version it means to finish and runs `discern done` again. Checks whose inputs didn't change reuse their results. |

Proof goes stale when the work changes: a new commit, uncommitted files, a changed checkpoint answer, or a changed limit proposal. New work on `main` doesn't make it stale. discern checks the combination when the task lands.

The agent keeps using the same worktree for the rest of the task and its review. It starts a new one only after confirming the original can't be recovered. [Finish and land a change](finish-and-land-a-change.md) covers the usual path from here.

## Stop a run you can no longer see

If you close a terminal, or your coding tool gives up on a long call, the checks may still be running, or they may have stopped. Either way, the agent reads the run back instead of starting it again.

discern keeps a record of every long run, such as `discern done` or `discern accept`, behind a short **progress handle**. Your agent's tool receives the handle when the run starts, in a line like this:

```text
done is running. If this call is lost, `discern progress R1-H596-N6BT-K5` reads it back.
```

To read the run back:

```sh
discern progress R1-H596-N6BT-K5
```

The reading says whether the run is still going, what it has counted, and which checks have failed so far. Once the run has finished, it shows the full result. Without a handle, `discern progress` reads the most recent run started in that worktree. `discern status` also leads with a run that's still going. Reading a run never stops or restarts it. A run whose process has died reads as stopped without finishing.

Don't rerun the checks only to see their output. The reading keeps the result, and each check's full output stays in the file the result names.

## Recover an interrupted acceptance

A landing can stop partway. `main` may have moved to include the change before discern updated your main checkout, recorded the Proof note, or removed the worktree. So the first question is whether the change reached `main`, and discern can always answer it.

Ask your agent:

> Check the interrupted landing. Tell me whether the change landed, and what cleanup is left. Continue the recorded recovery for the landing I already approved.

Before discern moves `main`, it writes down what it's about to do. Then it moves `main` in one step that either happens completely or doesn't happen at all. When the agent retries, discern reads that record:

- **If `main` moved,** the retry finishes the remaining steps. It doesn't land the change twice or ask for your permission again.
- **If `main` didn't move,** the retry undoes the attempt and says what stood in the way.

### Read what survived

The result names the checkout that still exists, even if the original worktree is gone, and the agent carries on there. Ask for a summary in terms you recognize, such as:

> The search change landed. Its Proof note still needs recording, and the worktree stayed because a preview server was writing in it.

That tells you what's already on `main` and what still needs care. The [completion and landing result reference](../30-reference/mcp-and-results.md#completion-and-landing-results) has the exact fields behind a summary like that.

### Preview and follow the recovery

Every discern command that changes your project can show its plan first with `--dry-run`, without changing anything. From the checkout that survived, the agent previews the landing:

```sh
discern accept --dry-run
```

From your main checkout, it adds `--target <task>` to name the task you approved. It follows the reported remedy and retries when the result says to.

If another process is running the landing, let it finish. If files, branches, or resources changed unexpectedly, the agent keeps them and looks into what the result names. Forcing a branch to a new commit or deleting files would destroy the evidence it needs to choose the next step.

### When the worktree stays after landing

A worktree that stays after landing can be a normal outcome. The change is already on `main`. The result says why the worktree stayed:

- **The branch has newer commits.** They haven't landed yet. The agent runs `discern done`, then `discern accept`, for them.
- **Cleanup couldn't finish**, perhaps because another program was still using the folder. Once it stops, run `discern worktree prune` from your main checkout.

Recovery is done when you know what landed, and why anything is still there. [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers cleanup and resource problems.

## Recover a dropped branch

If you dropped a task and later want its committed work back, discern keeps a local way back. Before `discern worktree drop` deletes a branch, it saves the branch's last commit under `refs/discern/recovery/` and prints the saved reference's full name. Your copy of the repository keeps the newest 32 of these. They aren't pushed anywhere.

Tell your agent which task you want back, and give it the printed reference if you have it. Otherwise it can list what's kept, newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

The agent checks the branch name, date, and commits of each entry, because the newest one may belong to a different task.

It then makes an ordinary branch at the chosen reference, without switching your main checkout. Use your own reference in place of this example:

```sh
git branch recovered-work refs/discern/recovery/20260811T120000000Z-example-1234abcd
git log --stat recovered-work
```

To carry on with the work, it starts a new worktree from that branch and moves into the path it returns:

```sh
discern start --name recovered-work --from recovered-work
```

Review the restored work before relying on it. The resumed task needs new Proof, and its own permission to land.

Only committed work comes back. Changes that were staged, edited, ignored, or untracked aren't in the saved commit, and a forced drop deletes them for good. Keep the saved reference until you've checked the restored work. For branches lost some other way, `git reflog` may help.

## When a setup step may have finished

A setup step recorded as running may have finished before its process ended. Running it again could repeat its effect, such as loading the same sample data twice. So discern stops and asks for a look first.

Your agent tells you what it found, and recommends whether to mark the step finished or run it again. You decide. [Setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) covers the exact commands.
