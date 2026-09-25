---
id: troubleshoot-gate-and-proof
title: "Gate and Proof"
description: "Find out why the gate stopped or gave no Proof, fix the cause, and know which decisions are yours."
order: 30
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-gate-and-proof"
  - "Strand detection"
  - "tree drift"
  - "tree_drift"
  - "dirty gate"
  - "stranded changes"
  - "generated_drift"
  - "gate_failed"
  - "unchanged_tree_rerun"
  - "stale Proof"
  - "Proof skipped"
---

# Gate and Proof

When the gate stops, its result says what happened and what to do next. This page helps you tell a failed test from a refusal, a wait, or Proof that no longer applies, so your agent fixes the real cause, and it names the decisions that stay yours.

The **gate** runs your project's own commands, such as its linter, type checker, and test suite, and a change counts as finished only when every one of them passes. When they pass on a commit, discern records **Proof**: which commands passed, on which commit. Say your agent is adding ingredient search to your recipe app, and the gate stops. Hand the result to your agent:

> "Explain what stopped the gate in terms of the recipe search change. Fix the cause, check the fix, and tell me what's still unchecked or needs my decision."

## A check failed

A red result names each failing command, shows its output, and gives the command that reproduces that failure on its own. When the recipe search test fails, the result names the command and its exit code:

```text
- `test`: test failed (exit 2) Reproduce with `make test`.
```

The output below it shows the test's own message, `search "basil": expected "Tomato soup", found no recipes`. If the output was long, the result shortens it and names the file with the full text as `output_path`.

A good explanation from your agent puts that in your terms: "Searching for basil misses Tomato soup, because search only looks at recipe titles." The failure might also come from a missing tool or a broken test, so the agent reproduces it before choosing a fix. [Fix a red gate](../20-guides/fix-a-red-gate.md) walks through the full procedure.

Some failures need a different first step:

- **A command timed out.** The message says it `timed out after <N>s and was killed`, and names the time limit it hit. A test runner left in watch mode often causes this, because it waits for file changes. Find out why the command doesn't finish before raising its limit.
- **A command passed but printed errors.** discern points it out, such as `Review lint's output at <path>. It passed but printed 12 error-like lines`, and your agent reads the output to see whether the linter hid a real failure.
- **The same version already failed.** If nothing changed since a red run, `discern done` won't repeat it. It says `the gate already judged this exact candidate red` and asks for a fix first. The agent uses `discern done --rerun` only when something outside the code changed, such as a test service coming back.

Once the fix is committed, the agent runs `discern done` again, which runs every required command, including any that stopped early. It's fixed when the result ends with a Proof line for the new commit, such as `Gate passed for agent/recipe-search-ec0b65 at 0eecbd359d17`.

## The gate refuses before running anything

Some results stop before any command runs, and name the condition to fix:

| What the result says                                                                    | What your agent does                                                                                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Completion requires a clean, committed tree — uncommitted:` and the files              | Runs `discern prepare`, reviews the files, commits what belongs to the change, then runs `discern done`.              |
| `This branch is behind main. Run discern update, then discern done.`                    | Runs `discern update`, rereads the files both changes touched, then runs `discern done`.                              |
| `This change fired one checkpoint that requires your judgment before any gate job runs` | Answers the question. See [A checkpoint needs an answer](#a-checkpoint-needs-an-answer).                              |
| `Completion attempt <id> is still running for this worktree.`                           | Reads that run back with `discern progress` instead of starting another.                                              |
| `write_denied` and a path                                                               | Needs write access to that path. If its own permissions block it, it asks you, then retries.                          |
| The project's instructions or skills are out of date                                    | Runs `discern refresh`, reviews and commits the changes, then retries. To change their wording, it edits the sources. |

One result that runs no commands isn't a refusal: `Current green Proof covers this exact tree; no gate job ran.` Nothing changed since the last pass, so the existing Proof still applies.

## The gate is waiting for test capacity

Your project can limit how many test runs happen at once with the `[gate].concurrent_test_runs` setting. When the limit is reached, a run waits its turn while its other commands carry on:

```text
Waiting to start tests: the project's shared test capacity is in use.
```

Nothing needs fixing: the tests start by themselves when a slot frees up.

discern can't tell which task holds the slot. When the run finishes, its result lists the other commands that were running when the wait began, and how long the first one's kind of command usually takes. It then says `These observations do not establish queue order or an estimated start time.` The list is only a clue to what was using the slot.

Raise the limit only if your machine can handle another run. [Share limited capacity](../20-guides/coordinate-parallel-tasks.md#share-limited-capacity) explains the setting.

## The result was cut short

A long result can list only the first few failures, then say how many more it left out. Every long run announces a **progress handle** when it starts, such as `R1-H596-N6BT-K5`, and your agent reads the full result back with it:

```sh
discern progress R1-H596-N6BT-K5
```

discern keeps these results for up to 7 days, and each command's complete output stays in the file its `output_path` names for 24 hours. Running the gate again only to see the missing text costs a full run and tells you nothing new.

If the session that started the run is gone, the run may still be going. [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) covers that case.

## Files changed while the gate ran

Proof has to describe one exact commit, so if a command changes files while the gate runs, discern stops instead of recording Proof for a version that doesn't exist:

| What the result names                                     | What your agent does                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tree_drift`: a step `left N tracked file(s) uncommitted` | Reviews the change. A formatter's fixes get committed. A check that should only read files gets corrected.              |
| `generated_drift`: a generated file is out of date        | Runs the command that regenerates it, reviews the output, and commits it.                                               |
| New files appeared among the project's own files          | Keeps them to look at. It points temporary output at a folder Git ignores, and commits only what belongs to the change. |

Running `discern prepare` before the final commit applies the formatters first, so `discern done` has nothing left to rewrite.

If a generator gives different output every time it runs on the same input, fix the generator, because committing its output again won't settle it.

## The checks passed, but there's no Proof

A green result without Proof says why, such as `The checks passed, but this run is not recorded as complete.` The reason decides what finishes the task:

| Why there's no Proof                 | What finishes it                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A new commit arrived during the run. | Commit the final version, then run `discern done` again.                                                                                       |
| The run used `--standalone`.         | That option is for investigating and never records Proof. Run `discern done` without it.                                                       |
| The run used `--ci`.                 | It reports results in continuous integration, and its Proof can't land a change. See [Run the gate in CI](../20-guides/run-the-gate-in-ci.md). |
| discern couldn't write the Proof.    | Fix the reason it names, then run `discern done` again.                                                                                        |

## Proof was current and went stale

Proof covers one exact version, so it goes stale when the agent makes a new commit, leaves files uncommitted, or changes a checkpoint answer or a proposed limit. Say you ask for a friendlier message when no recipe matches: the old Proof checked the old message, so the agent commits the new one and runs `discern done` again. Commands that declare their inputs reuse earlier results when those inputs didn't change.

A newer `main` doesn't make Proof stale, because discern checks the combination when the change lands, as the next section describes. [Why Proof becomes stale](../10-understand/proof.md#why-proof-becomes-stale) explains the rule.

## `main` moved before the change landed

Another task may land on `main` while yours waits for review. That doesn't send your change back to the start. When yours lands, discern combines it with the new `main` in a temporary copy, runs the gate on the combined code, and lands exactly what passed.

If that fails, nothing lands, and the task's worktree (its own copy of the project), its branch, and `main` stay as they were. The result says why:

| What the result says                                                           | What happens next                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Landing <branch>'s submission <commit> conflicts with main in:` and the files | Your agent runs `discern update`, resolves the conflict, commits, runs `discern done`, then `discern accept`.                       |
| `The combined check for <branch>'s submission <commit> with main failed`       | The same route. The result includes the command that reproduces the failure.                                                        |
| The combined code fired a checkpoint question                                  | Your agent answers it with `discern accept --met` or `--unmet`, and the same landing continues. An unmet answer then waits for you. |
| `main moved again while this landing recomposed`                               | `main` moved twice during the combined check. Your agent runs `discern accept` again to combine with the newest `main`.             |

When the landing works, the result starts `Landed`, and says the change was `composed with main`.

## A standard failed

A **standard** is a quality limit your project holds, such as the app's download size. First tell a worse measurement apart from one that couldn't run:

- **The value went past its limit.** Your agent explains what grew and tries to fix it within the task. If the change still needs more room, it brings you the measurement and a proposed new limit, and you decide. Editing the limit to pass isn't a way around that. A **grant**, permission to land that you set up in advance, doesn't cover it either. [Set and raise standards](../20-guides/set-and-raise-standards.md#respond-when-a-standard-fires) covers the steps.
- **`Standards limits are UNVERIFIED`.** discern couldn't read the limits on `main` to compare against. In CI this usually means a shallow clone, and the result gives the fetch command, such as `git fetch origin main:main`.
- **The measurement command failed.** Fix the command before drawing any conclusion about the value.

## A checkpoint needs an answer

A **checkpoint** is a question your project asks about certain kinds of change. Say a change to saved recipes asks whether recipes people saved before still open. Your agent reads the question, checks the actual change, and records its answer:

```sh
discern done --met <id>
discern done --unmet <id> --why "<reason>"
```

The gate then runs in the same call. The answer appears in the Proof, so you can read the agent's reasoning and challenge it.

An **unmet** answer is an ordinary result: the gate still runs, and landing waits for your approval of that specific gap, called a **variance**. No grant covers a variance, and neither does a general "go ahead". Instead of approving it, you can ask the agent to change the work so the answer becomes met.

A recorded answer **reopens** when a later edit touches what it covered, or when the question itself changes, and the agent answers again for the current version. [Checkpoint state and declarations](../30-reference/proof-and-checkpoint-formats.md#checkpoint-state-and-declarations) lists every state.

## When to stop

Your agent can keep investigating and fixing within the task you asked for. It brings you the decision when the fix would:

- change what you asked for;
- land despite an unmet checkpoint;
- raise a standard's limit;
- remove or weaken a check;
- land without permission you've given.

A green gate isn't permission to land. [Finish and land a change](../20-guides/finish-and-land-a-change.md) covers that step.

If the fix a result names doesn't work, keep the original result and the new output. Before your agent runs the full gate again, it should be able to say what changed since the last run, or what the new run will show. If it can't say either, it investigates instead of repeating the run.
