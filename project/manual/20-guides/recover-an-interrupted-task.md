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

When a session ends partway through a task, the work doesn't end with it. The task's **worktree**, a separate copy of the project on its own branch, still holds its files, commits, and setup, and discern still has the task's **Proof**, its record of which of your project's commands passed on exactly which commit. So a new session picks up from what's recorded instead of rebuilding the task from old chat history.

discern also keeps a record of any long run or landing that stopped partway, so your agent can finish it without guessing which steps already happened.

## Resume an unfinished worktree

Say your agent was adding search to your recipe app when the session ended. In a new session, ask:

> "Pick up the recipe search where the last session stopped. Tell me what's finished and what's left before you change anything, and keep anything you don't recognize."

Give your agent the task's worktree path or branch if you have them, and remind it what you wanted. discern records the state of the work and nothing from the conversation, so a preference you only mentioned there needs saying again.

Your agent runs `discern status` in the task's worktree, or from your main checkout if that folder is gone, to learn what happened. It confirms which worktree belongs to this task before it edits anything, because an idle worktree may still belong to another task.

A useful update tells you where things stand. Say the search box is committed, but one test isn't finished. Your agent tells you what you can already try, what the test will check, and what it'll do next, so you can correct it before it carries on. What it does depends on what it finds:

| What it finds                 | What it does                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes.          | It reads them and carries on with the intended work.                                                                              |
| Unfinished setup.             | It follows the setup or resource recovery that status names.                                                                      |
| New work on `main`, mid-task. | It runs `discern update` and rereads any files both changes touched.                                                              |
| Current Proof.                | It checks whether the task was submitted and may land, before deciding what's left.                                               |
| Stale Proof.                  | It commits the version it means to finish and runs `discern done` again. Commands whose inputs didn't change reuse their results. |

Proof goes stale when the work changes: a new commit, uncommitted files, a changed answer to a **checkpoint** (one of your project's review questions), or a changed proposal to raise one of its measured limits. A later failing run on the same commit makes it stale too. New work on `main` doesn't, because discern checks the combination when the task lands.

Your agent keeps using the same worktree for the rest of the task and its review, and starts a new one only after confirming the original can't be recovered. [Finish and land a change](finish-and-land-a-change.md) covers the usual path from here.

## Stop a run you can no longer see

If your coding tool gives up on a long call, the run may still be going, or it may have been cancelled. Closing the terminal a run started in stops that run. Either way, your agent reads the run back instead of starting it again, so a lost call doesn't cost a second run.

discern records every long run, such as `discern done` or `discern accept`, behind a short **progress handle**. Your agent's tool receives the handle when the run starts, in a line like this:

```text
done is running. If this call is lost, `discern progress R1-H596-N6BT-K5` reads it back.
```

To read the run back:

```sh
discern progress R1-H596-N6BT-K5
```

The reading says whether the run is still going, what it has counted, and which commands have failed so far. Once the run has finished, it shows the full result, and it starts like this:

```text
`done` on agent/recipe-search-0a7563 finished and succeeded. Its result was retained; reading it does not rerun the operation.
```

Without a handle, `discern progress` reads the most recent run started in that worktree, and `discern status` also leads with a run that's still going. Reading a run never stops or restarts it. A run whose process has died reads as stopped without finishing.

Don't rerun the commands only to see their output. The reading keeps the result, and each command's full output stays in the file the result names.

## Recover an interrupted acceptance

A landing can stop partway. `main` may have moved to include the change before discern updated your main checkout, recorded the Proof note, or removed the worktree. So the first question is whether the change reached `main`, and discern can always answer it: before it moves `main`, it writes down what it's about to do, then moves `main` in one step that either happens completely or doesn't happen at all.

Ask your agent:

> "Check the interrupted landing. Tell me whether the change landed and what cleanup is left, then finish the landing I already approved."

When your agent retries, discern reads that record:

- **If `main` moved,** the retry finishes the remaining steps. It doesn't land the change twice or ask for your permission again.
- **If `main` didn't move,** the retry undoes the attempt and says what stood in the way.

### Read what survived

The result's `data.root` field names the surviving checkout, even if the original worktree is gone, and your agent carries on there. Ask for a summary in terms you recognize, such as "the search change landed, its Proof note still needs recording, and the worktree stayed because a preview server was writing in it." That tells you what's already on `main` and what still needs care. The [completion and landing result reference](../30-reference/mcp-and-results.md#completion-and-landing-results) has the exact fields behind a summary like that.

### Preview and follow the recovery

Every discern command that changes your project can show its plan first with `--dry-run`, without changing anything, so your agent sees what a retry would do before it runs one. From the surviving checkout, your agent previews the landing:

```sh
discern accept --dry-run
```

From your main checkout, it adds `--target <task>` to name the task you approved. It follows the reported remedy and retries when the result says to.

If another process is running the landing, your agent lets it finish. If files, branches, or resources changed unexpectedly, it keeps them and looks into what the result names, because forcing a branch to a new commit or deleting files would destroy the evidence it needs to choose the next step.

### When the worktree stays after landing

A worktree that stays after landing can be a normal outcome. The change is already on `main`, and the result's first sentence says why the worktree stayed and names the command that finishes the job, whether that's landing newer commits, committing changes left in the worktree, recording a Proof note that couldn't be written, or finishing a cleanup another program blocked. [After it lands](finish-and-land-a-change.md#after-it-lands) walks through each case.

A resource that couldn't be removed, such as a test database, doesn't keep the worktree. The worktree and branch go, the result names the resource, and once its cause is fixed, `discern worktree prune` removes it.

Recovery is done when you know what landed, and why anything is still there. [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers cleanup and resource problems.

## Recover a dropped branch

If you dropped a task and later want its committed work back, discern keeps a local way back. Before `discern worktree drop` deletes a branch, it saves the branch's last commit under `refs/discern/recovery/` and prints the saved reference's full name. Your copy of the repository keeps the newest 32 of these, and they aren't pushed anywhere.

Say you dropped the recipe search task last week and now want it back. Tell your agent which task you mean, and give it the printed reference if you have it. Otherwise it lists what's kept, newest first:

```sh
git for-each-ref --sort=-refname --format='%(refname) %(objectname:short)' refs/discern/recovery/
```

Your agent checks the branch name, date, and commits of each entry, because the newest one may belong to a different task. Then it makes an ordinary branch at the chosen reference, without switching your main checkout, for example:

```sh
git branch recovered-work refs/discern/recovery/20260811T120000000Z-recipe-search-0a7563-1234abcd
git log --stat recovered-work
```

To carry on with the work, it starts a new worktree from that branch and moves into the path it returns:

```sh
discern start --name recovered-work --from recovered-work
```

Review the restored work before relying on it. The resumed task needs new Proof, and its own permission to land.

Only committed work comes back. Changes that were staged, edited, ignored, or untracked aren't in the saved commit, and a forced drop deletes them for good. Keep the saved reference until you've checked the restored work. For branches lost some other way, `git reflog` may help.

## When a setup step may have finished

A setup step recorded as running may have finished before its process ended, and running it again could repeat its effect, such as loading the same sample data twice. So discern stops and asks for a look first instead of guessing.

Your agent tells you what it found and recommends whether to mark the step finished or run it again. You decide. [Setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) covers the exact commands.
