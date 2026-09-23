---
id: explanation-proof
title: "Proof"
description: "See which checks passed on the exact version you're reviewing, what that leaves for you to judge, and who decides whether it lands."
order: 30
publish: true
kind: explanation
aliases:
  - "gate"
  - "explanation-proof"
  - "The Proof"
  - "gate Proof"
  - "review Proof"
  - "Proof of done"
  - "landing authority"
  - "standing grant"
  - "effort grant"
  - "pre-authorized landing"
---

# Proof

When your agent says a change is finished, Proof shows you what that means: which of your project's checks passed, on exactly which version of the code.

You don't have to take the agent's word for it, or dig through the conversation to see what it ran. Your review can go straight to the questions only you can answer: does the feature work the way you wanted, and does it belong in your project?

## Read a Proof line

When your agent finishes a task with `discern done`, it ends its report with a one-line summary like this:

> **Proof:** Gate passed for `agent/recipe-search-0a7563` at `c5a02addf12a` · 3 files changed (+84 −12) vs `main` · Standards held · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

| Part of the line                                   | What it tells you                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Gate passed**                                    | Every check your project requires passed.                                            |
| **`agent/recipe-search-0a7563` at `c5a02addf12a`** | The task's branch, and the commit (the saved version of the code) that was checked.  |
| **3 files changed (+84 −12) vs `main`**            | The size of the change: files touched, and lines added and removed.                  |
| **Standards held**                                 | The change stays within every quality limit the project sets, such as download size. |
| **1 checkpoint declared met**                      | The agent answered one of your project's review questions and judged it satisfied.   |
| **View the full Proof**                            | The command that shows every check, measurement, and answer in full.                 |

To see the full record, run `discern status --verbose` in the task's worktree, or ask your agent:

> Explain this Proof in terms of the feature I asked for. What did the checks cover, what did you try yourself, and what should I look at?

## What a pass does and doesn't tell you

The **gate** is the set of checks your project requires before a change counts as finished. It might build the app, run the tests, check code style, and measure things like download size. Your project chooses the checks. discern runs them and records the results.

A pass means those checks passed, and nothing more. A test can confirm that clearing the search box brings back the full recipe list. It can't tell you whether search feels right on a phone, unless your project checks that too.

So use Proof to decide where to look. Try the feature, compare it with what you asked for, and ask about anything the checks don't cover. How far to go depends on what the change could affect.

## The exact commit it covers

Proof belongs to one commit. discern records it only when every change in the worktree is committed, so the checks describe exactly what would land.

If other work lands first, discern checks the combination before landing yours. Say one task adds recipe search and another changes how recipes are sorted, and sorting lands first. When search lands, discern combines it with the new `main` in a temporary copy, checks the combined code, and lands exactly what passed. If the two changes conflict or the combined checks fail, nothing lands, and the search task's agent gets the exact files or failing check to fix.

## Why Proof becomes stale

Proof describes one exact state of the work. If that state changes, the work needs fresh Proof before it can land. That happens when:

- the agent makes or amends a commit;
- the worktree has staged, uncommitted, or untracked files;
- the agent changes a checkpoint answer or its reasoning;
- a proposed change to a standard's limit changes.

Files rewritten by a formatter or code generator count too, so the agent commits them before running the gate.

Say you ask for a friendlier message when no recipes match. The first Proof still stands as a record, but it checked a version you no longer want to land. The agent commits the new message and runs `discern done` again.

Fresh Proof doesn't always mean running everything again. A check that declares its inputs reuses its earlier result when none of them changed. If nothing at all has changed since the last pass, `discern done` returns the existing Proof without running any checks. Use `discern done --rerun` to force a full run.

A newer `main` doesn't make Proof stale, because discern checks the combination when the change lands.

## Checks, judgments, and permission

A Proof keeps three things separate, so you can see who vouched for what:

| What                   | Who provides it                                        | What you can do with it              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------ |
| **Check results**      | discern, by running your project's commands.           | See which checks passed.             |
| **Checkpoint answers** | Your agent, answering your project's review questions. | Read its reasoning and challenge it. |
| **Permission to land** | You, now or through a grant you set up earlier.        | Decide what joins your project.      |

**Checkpoint answers are the agent's judgment, not discern's.** A checkpoint might ask whether a new error message tells people what to do next. The agent reads the message and records its answer. discern makes sure the question gets asked and answered. It doesn't judge whether the answer is right.

If the agent answers **unmet**, the Proof keeps its reason. You can ask for a fix, or accept that specific gap, which is called a **variance**. A general "go ahead" doesn't approve a variance, and neither does any grant. [Checkpoints](checkpoints.md) explains how to weigh one.

**Permission to land** can come from:

- you, in the current conversation;
- a **standing grant** in the project's configuration, covering named areas such as documentation;
- a grant for one task, which you record from the **desk**: the interactive view that opens when you run `discern` in your main checkout. It still covers the task after review fixes, so you only grant it once.

Whatever the source, discern checks it against the files the change touches. Anything a grant doesn't cover comes back to you.

### When a feature needs more room than a standard allows

A **standard** is a quality limit the project holds, such as a maximum download size. Better search might push the app past it. The agent should first try to avoid the increase. If raising the limit is justified, it proposes the change, and the Proof shows the current limit, the proposed one, the measured value, and the reason.

You decide whether the feature is worth it. Landing needs your approval of that exact proposal. General permission to land doesn't cover it. If you decline, the agent puts the old limit back, and the change has to fit within it. [Set and raise standards](../10-guides/set-and-raise-standards.md) covers the details.

## From green to live

A finished change passes several milestones on its way to your users:

| Stage                | What it means                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **Green**            | The project's checks passed.                                                                          |
| **Ready for review** | Current Proof exists, and your agent has explained the change and any decisions you need to make.     |
| **Submitted**        | The agent has asked to land this exact commit. It waits in the landing queue until it has permission. |
| **Authorized**       | You approved it, or a grant covers it, and any variance or limit change is settled.                   |
| **Landed**           | The commit is on the **trunk**, your project's shared branch (usually `main`).                        |
| **Live**             | Your release process has shipped it to users. discern never does this step.                           |

**Emergency landings** skip this path. When a fix can't wait for its checks, you can land it anyway, but only by making a fresh, explicit decision. discern keeps a permanent record of which checks failed, didn't run, or were out of date. That record isn't Proof. A later passing run settles the outstanding checks, and the record stays. [Land an urgent repair](../10-guides/land-an-urgent-repair.md) explains how.

## Proof stays with the code

Worktrees are temporary; Proof isn't. By default, when a change lands, discern attaches its Proof to the landed commit as a Git note. Months later, anyone can look up what was checked for that commit, long after the conversation and the workspace are gone.

The note lives in your local repository. discern never uploads it. Sharing notes is an ordinary Git choice. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) has the commands to inspect and share them, and [Local control](local-control.md) explains what else stays on your machine.

## What to ask your agent for

For everyday work, ask for the changed behavior, current Proof, and any decision that's still open. If something is missing, ask what's left and how to get it. If you ask for another edit, expect new Proof for the new version.

Only an ordinary `discern done` produces Proof you can land. Its `--standalone` option, for investigating, and its `--ci` option, for reporting in continuous integration, don't. [Run the gate in CI](../10-guides/run-the-gate-in-ci.md) explains the second.

[Finish and land a change](../10-guides/finish-and-land-a-change.md) walks through the handoff, and [Fix a red gate](../10-guides/fix-a-red-gate.md) helps when a check fails.
