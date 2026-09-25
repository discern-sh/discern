---
id: explanation-proof
title: "Proof"
description: "See which of your project's commands passed on the exact commit you're reviewing, what that leaves for you to judge, and who decides whether it lands."
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

When your agent says a change is finished, Proof shows you what that means: which of your project's commands passed, such as its tests and code-quality tools, on the exact commit you're reviewing.

You don't have to take the agent's word for it, or dig through the conversation to see what it ran. Your review can go straight to the questions only you can answer: does the feature work the way you wanted, and does it belong in your project?

## Read a Proof line

Say your agent has added search to your recipe app. To finish, it runs the **gate** with `discern done`: discern runs your project's own commands, such as its build, linter, and test suite, measures things such as its download size, and counts the change as finished only when every one of them passes. Your agent then ends its report with a one-line summary like this:

> **Proof:** Gate passed for `agent/recipe-search-0a7563` at `c5a02addf12a` · 3 files changed (+84 −12) vs `main` · Standards held · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

| Part of the line                                   | What it tells you                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Gate passed**                                    | Every command and measurement the gate runs passed.                                                                         |
| **`agent/recipe-search-0a7563` at `c5a02addf12a`** | The task's branch, and the commit (the saved version of the code) the gate ran on.                                          |
| **3 files changed (+84 −12) vs `main`**            | The size of the change: files touched, and lines added and removed.                                                         |
| **Standards held**                                 | The change stays within every **standard**, a measured limit the project holds, such as a maximum download size.            |
| **1 checkpoint declared met**                      | Your agent answered one **checkpoint**, a review question your project asks about certain changes, and judged it satisfied. |
| **View the full Proof**                            | The command that shows every result, measurement, and answer in full.                                                       |

To see the full record, run `discern status --verbose` in the task's **worktree**, the separate copy of the project where your agent made the change. Or ask your agent:

> "Explain this Proof in terms of the feature I asked for. What did the tests cover, what did you try yourself, and what should I look at?"

## What a pass does and doesn't tell you

A pass means those commands passed on that commit, and nothing more. The search test can confirm that clearing the search box brings back the full recipe list, but it can't tell you whether search feels right on a phone, unless your project tests that too.

So use Proof to decide where to look: try the feature, compare it with what you asked for, and ask your agent about anything the tests don't cover. How far to go depends on what the change could affect.

## The exact commit it covers

Proof belongs to one commit. discern records it only when every change in the worktree is committed, so the results describe exactly what would land.

Say another task changes how recipes are sorted, and it lands while search waits for your review. When search lands, discern combines it with the new `main` in a temporary copy and runs the gate on the combined code, instead of landing search on top of work its gate run never saw. It lands exactly what passed. If the two changes conflict, or the combined run fails, nothing lands, and the search task's agent gets the conflicting files or the failing command to fix.

## Why Proof becomes stale

Proof describes one exact state of the work, so when that state changes, the work needs fresh Proof before it can land. That happens when:

- your agent makes or amends a commit;
- the worktree has staged, uncommitted, or untracked files;
- your agent changes a checkpoint answer or its reasoning;
- a proposed change to a standard's limit changes;
- a later gate run on the same commit fails.

Files that a formatter or code generator rewrites count too, so your agent commits them before it runs the gate.

Say you ask for a friendlier message when no recipes match. The first Proof still stands as a record, but it covers a version you no longer want to land, so your agent commits the new message and runs `discern done` again.

Fresh Proof doesn't always mean running everything again. A job or measurement that lists the files it reads reuses its earlier result while none of them has changed. If nothing at all has changed since the last pass and `main` hasn't moved, `discern done` returns the existing Proof without running anything, and your agent can force a full run with `discern done --rerun`.

A newer `main` doesn't make Proof stale for landing, because discern checks the combination when the change lands.

## Checks, judgments, and permission

A Proof keeps three things separate, so you can see who vouched for what:

| What                   | Who provides it                                        | What you can do with it              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------ |
| **Check results**      | discern, by running your project's commands.           | See which commands passed.           |
| **Checkpoint answers** | Your agent, answering your project's review questions. | Read its reasoning and challenge it. |
| **Permission to land** | You, now or through a grant you set up earlier.        | Decide what joins your project.      |

**A checkpoint answer is your agent's judgment.** Say a checkpoint asks whether the new "no recipes found" message tells people what to do next. Your agent reads the message and records its answer. discern makes sure the question gets asked and answered, but it has no AI model of its own, so it doesn't judge whether the answer is right.

If your agent answers **unmet**, the Proof keeps its reason. You can ask for a fix, or accept that specific gap, which is called a **variance**. Only you can approve one, in the current conversation: a general "go ahead" doesn't approve a variance, and neither does any grant. [Checkpoints](checkpoints.md) explains how to weigh one.

**Permission to land** can come from:

- you, in the current conversation;
- a **standing grant** in the project's configuration, covering named areas such as documentation;
- a grant for one task, which you record from the **desk**: the interactive view that opens when you run `discern` in your main checkout. It still covers the task after review fixes, so you only grant it once.

discern checks a standing grant against the files the change touches, and anything the grant doesn't cover comes back to you. Your approval in the conversation, or a grant for one task, covers every file in the change.

### When a feature needs more room than a standard allows

Say better search pushes the recipe app past its download-size standard. Your agent first tries to avoid the increase. If the extra size is justified, it proposes a new limit, and the Proof shows the current limit, the proposed one, the measured value, and the reason.

You decide whether the feature is worth it. Landing needs your approval of that exact proposal, because general permission to land doesn't cover a looser limit. If you decline, your agent puts the old limit back, and the change has to fit within it. [Set and raise standards](../20-guides/set-and-raise-standards.md) covers the details.

## From green to live

A finished change passes several milestones on its way to your users:

| Milestone            | What it means                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **Green**            | The gate passed.                                                                                       |
| **Ready for review** | Current Proof exists, and your agent has explained the change and any decisions you need to make.      |
| **Submitted**        | Your agent has asked to land this exact commit. It waits in the landing queue until it has permission. |
| **Authorized**       | You approved it, or a grant covers it, and any variance or limit change is settled.                    |
| **Landed**           | The commit is on the **trunk**, your project's shared branch (usually `main`).                         |
| **Live**             | Your release process has shipped it to users. discern never does this step.                            |

When a fix can't wait for the gate, an **emergency landing** skips this path, but only when you make a fresh, explicit decision to land it. discern keeps a permanent record of which checks failed, didn't run, or were out of date. That record isn't Proof, and it stays even after a later passing run settles the outstanding checks. [Land an urgent repair](../20-guides/land-an-urgent-repair.md) explains how.

## Proof stays with the code

Worktrees are temporary; Proof isn't. When a change lands, discern attaches its Proof to the landed commit as a Git note. Say recipe search misbehaves months from now: anyone with the repository can look up what passed for the commit that landed it, long after the conversation and the worktree are gone.

The note lives in your local repository, and discern never uploads it. Sharing notes is an ordinary Git choice: [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) has the commands to inspect and share them, and [What stays on your machine](local-control.md) explains what else stays on your machine.

## What to ask your agent for

For everyday work, ask for the changed behavior, current Proof, and any decision that's still open. If something is missing, ask what's left and how to get it, and if you ask for another edit, expect new Proof for the new version.

Only an ordinary `discern done` run produces Proof you can land. A run with `--standalone`, for investigating, or with `--ci`, for reporting in continuous integration, doesn't. [Run the gate in CI](../20-guides/run-the-gate-in-ci.md) explains the second.

[Finish and land a change](../20-guides/finish-and-land-a-change.md) walks through the handoff, and [Fix a red gate](../20-guides/fix-a-red-gate.md) helps when a test or other command fails.
