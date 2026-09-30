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

When the gate stops, its result says what happened and what to do next. Your agent can fix the cause and bring you only the decisions that are yours.

The **gate** is your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. **Proof** is discern's record of which of those commands passed on one exact commit. Say the gate stops while your agent adds ingredient search to your recipe app. Hand your agent the result:

> "Explain what stopped the gate, fix the cause, and tell me what's still unchecked or needs my decision."

## A check failed

A red result names each failing command, shows its output, and gives a command that reproduces the failure on its own.

```text
- `test`: test failed (exit 2) Reproduce with `make test`.
```

Below it, the test's message says `search "basil": expected "Tomato soup", found no recipes`. Your agent reproduces the failure first, because a missing tool or a broken test can look the same as a real bug. [Fix a red gate](../20-guides/fix-a-red-gate.md) walks through the procedure. Some failures need a different first step:

- **A command timed out.** The message says it `timed out after <N>s and was killed`, often because a test runner is in watch mode. Find out why before you raise the limit.
- **A command passed but printed errors.** A note such as `Review lint's output at <path>. It passed but printed 12 error-like lines` asks your agent to check whether the linter hid a real failure.
- **The same version already failed.** `discern done` says `the gate already judged this exact candidate red` and asks for a fix first. Your agent adds `--rerun` only when something outside the code changed, such as a test service coming back.

It's fixed when `discern done` ends with a Proof line for the new commit: `Gate passed for agent/recipe-search-ec0b65 at 0eecbd359d17`.

## The gate refuses before running anything

These results stop before any command runs:

| What the result says                                                       | What your agent does                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Completion requires a clean, committed tree — uncommitted:` and the files | Runs `discern prepare`, commits what belongs to the change, and retries.       |
| `This branch is behind main.`                                              | Runs `discern update`, rereads files both changes touched, and retries.        |
| `This change fired one checkpoint that requires your judgment`             | Answers it. See [A checkpoint needs an answer](#a-checkpoint-needs-an-answer). |
| `Completion attempt <id> is still running for this worktree.`              | Reads that run back with `discern progress`.                                   |
| `write_denied` and a path                                                  | Needs write access to that path, and asks you if its own permissions block it. |
| `agent file(s) out of date` or `materialized skills out of date`           | Runs `discern refresh`, commits the result, and retries.                       |

`Current green Proof covers this exact tree; no gate job ran.` isn't a refusal: nothing changed since the last pass, so the Proof still applies.

## The gate is waiting for test capacity

Your project can limit how many test runs happen at once, so a run's tests may wait while its other commands carry on:

```text
Waiting to start tests: the project's shared test capacity is in use.
```

Nothing needs fixing: the tests start by themselves when a slot frees up. [Share limited capacity](../20-guides/coordinate-parallel-tasks.md#share-limited-capacity) explains the limit and when to raise it.

## The result was cut short

A long result may list only the first few failures and count the rest. Your agent reads the full result with the **progress handle** the run announced at its start, as in `discern progress R1-H596-N6BT-K5`, instead of paying for another full run. [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) explains progress handles.

## Files changed while the gate ran

If a command changes files while the gate runs, discern stops instead of recording Proof for a version that doesn't exist:

| What the result names                                     | What your agent does                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `tree_drift`: a step `left N tracked file(s) uncommitted` | Commits a formatter's fixes, or corrects a check that should only read files. |
| `generated_drift`: a generated file is out of date        | Regenerates it, reviews the output, and commits it.                           |
| `Unexpected checkout changes:` and the files              | Keeps intended edits, and points temporary output at a folder Git ignores.    |

A generator whose output changes on every run needs fixing, because committing it again won't settle it.

## The checks passed, but there's no Proof

A green result without Proof says why, such as `The checks passed, but this run is not recorded as complete.`

| Cause                                | What finishes it                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A new commit arrived during the run. | Commit the final version, then run `discern done` again.                                                    |
| The run used `--standalone`.         | It's for investigating, so run `discern done` without it.                                                   |
| The run used `--ci`.                 | It's a [continuous integration](../20-guides/run-the-gate-in-ci.md) (CI) report, which can't land a change. |
| discern couldn't write the Proof.    | Fix the named reason, then run `discern done` again.                                                        |

## Proof was current and went stale

Proof covers one exact version, so any later edit makes it stale, and your agent runs `discern done` again on the new commit. A newer `main` doesn't make Proof stale, because discern checks the combination when the change lands. [Why Proof becomes stale](../10-understand/proof.md#why-proof-becomes-stale) lists every cause.

## `main` moved before the change landed

When another task lands first, discern [checks your change combined with the new `main`](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) and lands exactly what passed. If that fails, nothing lands, your branch stays as it was, and the result says why:

| What the result says                                                           | What happens next                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Landing <branch>'s submission <commit> conflicts with main in:` and the files | Your agent runs `discern update`, resolves the conflict, commits, runs `discern done`, then `discern accept`.                       |
| `The combined check for <branch>'s submission <commit> with main failed`       | The same route.                                                                                                                     |
| The combined code fired a checkpoint question                                  | Your agent answers it with `discern accept --met` or `--unmet`, and the same landing continues. An unmet answer then waits for you. |
| `main moved again while this landing recomposed`                               | Your agent runs `discern accept` again to combine with the newest `main`.                                                           |

A successful landing's result starts `Landed` and says the change was `composed with main`.

## A standard failed

A [standard](../10-understand/standards.md) is a measured limit your project holds, such as the app's download size. Tell a worse value apart from a measurement that couldn't run:

- **The value went past its limit.** Your agent explains what grew and tries to stay within it. If the change needs more room, it proposes a new limit. Only you can approve it, and no advance permission covers it. [Respond when a standard fires](../20-guides/set-and-raise-standards.md#respond-when-a-standard-fires) covers the steps.
- **`Standards limits are UNVERIFIED`.** discern couldn't read the limits on `main`. In CI, it's usually a shallow clone, and the result gives the fetch command, such as `git fetch origin main:main`.
- **The measurement command failed.** Fix it before drawing conclusions about the value.

## A checkpoint needs an answer

A **checkpoint** is a review question, such as whether saved recipes still open, that your agent answers when a change touches certain files. Your agent checks the actual change and records its answer:

```sh
discern done --met <id>
discern done --unmet <id> --why "<reason>"
```

You can read and challenge the answer in the Proof. An **unmet** answer is an ordinary result: the gate still runs, and landing waits for you. You can ask your agent to change the work until the answer is met, or give a **variance**, your permission to land despite that gap. Only you can give one: no general "go ahead" or advance permission covers it.

An answer **reopens** after an edit to what it covered, or to the question. [Checkpoints](../10-understand/checkpoints.md) explains how to weigh an unmet answer.

## When to stop

Your agent can keep fixing within the task you asked for. It brings you the decision when the fix would:

- change what you asked for;
- land despite an unmet checkpoint;
- raise a standard's limit;
- remove or weaken a check;
- land without permission you've given.

A green gate isn't permission to land. [Finish and land a change](../20-guides/finish-and-land-a-change.md) covers that step.

If the named fix doesn't work, keep both results. Your agent should rerun the full gate only when it can say what changed or what the new run will show.
