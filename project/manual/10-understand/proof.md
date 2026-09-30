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
---

# Proof

When your agent says a change is finished, Proof shows you what that means: which of your project's commands, such as its tests and linter, passed on the exact commit you're reviewing.

You don't have to take the agent's word for it or dig through the conversation. Your review can go straight to what only you can judge: does the feature work the way you wanted, and does it belong in your project?

## Read a Proof line

Say your agent has added search to your recipe app. It finishes with `discern done`, which runs the **gate**: every command your project requires to pass before a change counts as finished. Its report ends with a line like this:

> **Proof:** Gate passed for `agent/recipe-search-0a7563` at `c5a02addf12a` · 3 files changed (+84 −12) vs `main` · Standards held · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

| Part of the line                                   | What it tells you                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Gate passed**                                    | Every command and measurement in the gate passed.                                                                |
| **`agent/recipe-search-0a7563` at `c5a02addf12a`** | The task's branch, and the commit (the saved version of the code) the gate ran on.                               |
| **3 files changed (+84 −12) vs `main`**            | Files touched, and lines added and removed.                                                                      |
| **Standards held**                                 | The change stays within every **standard**, a measured limit your project holds, such as its download size.      |
| **1 checkpoint declared met**                      | Your agent answered one **checkpoint**, a review question for changes to certain files, and judged it satisfied. |
| **View the full Proof**                            | The command that shows the full record.                                                                          |

Run that command in the task's **worktree**, the separate copy of the project where your agent works, or ask your agent:

> "Explain this Proof in terms of the feature I asked for. What did the tests cover, what did you try yourself, and what should I look at?"

## What a pass does and doesn't tell you

A pass means those commands passed on that commit, and nothing more. A test can confirm that clearing the search box brings back every recipe, but not whether search feels right on a phone, unless your project tests that too.

So use Proof to decide where to look: try the feature, and ask your agent about anything the tests don't cover. How far to go depends on what the change could affect.

## The exact commit it covers

Proof belongs to one commit. discern records it only when every change in the worktree is committed, so the results describe exactly what would land.

If another task lands on `main` first, then when search lands, discern checks the combined code in a temporary copy and lands exactly what passed. [When other work lands first](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) shows what happens if the two changes conflict.

## Why Proof becomes stale

Proof describes one exact state of the work. It becomes stale, and the change needs fresh Proof before it can land, when:

- your agent makes or amends a commit;
- the worktree has staged, uncommitted, or untracked files, including any a formatter or code generator rewrote;
- your agent changes a checkpoint answer or its reasoning;
- a proposed change to a standard's limit changes;
- a later gate run on the same commit fails.

Say you ask for a friendlier message when no recipes match. Your agent commits the new message and runs `discern done` again, because the first Proof covers the version without it.

A newer `main` doesn't make Proof stale, because discern checks the combination when the change lands.

## Checks, judgments, and permission

A Proof keeps these apart, so you can see who vouched for what:

| What                   | Who provides it                                        | What you can do with it              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------ |
| **Check results**      | discern, by running your project's commands.           | See which commands passed.           |
| **Checkpoint answers** | Your agent, answering your project's review questions. | Read its reasoning and challenge it. |
| **Permission to land** | You, now or through a grant you set up earlier.        | Decide what joins your project.      |

**A checkpoint answer is your agent's judgment.** Say a checkpoint asks whether the "no recipes found" message tells people what to do next. discern makes sure your agent answers, but it has no AI model of its own to judge whether the answer is right.

**Permission to land is yours to give.** You can give it in advance for routine changes with a grant, as [Pre-approve routine work](../20-guides/finish-and-land-a-change.md#pre-approve-routine-work) explains, but no grant covers an **unmet** checkpoint answer. Landing despite one takes a **variance**, which only you can approve, in the current conversation, and [Checkpoints](checkpoints.md#declared-unmet-and-your-variance) explains how to weigh it.

**A looser limit needs your approval too.** If better search pushes the app past its download-size standard, the change lands only once you approve the new limit your agent proposes, and no grant covers that. [Standards](standards.md) and [Set and raise standards](../20-guides/set-and-raise-standards.md#respond-when-a-standard-fires) explain the decision.

## From green to live

A finished change passes these milestones:

| Milestone            | What it means                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Green**            | The gate passed.                                                                                  |
| **Ready for review** | Current Proof exists, and your agent has explained the change and what you need to decide.        |
| **Submitted**        | Your agent has asked to land this exact commit, and it waits in the landing queue for permission. |
| **Authorized**       | You approved it, or a grant covers it, and any variance or limit change is settled.               |
| **Landed**           | The commit is on the **trunk**, your shared branch (usually `main`).                              |
| **Live**             | Your release process has shipped it to users. discern never does this step.                       |

A fix that can't wait for the gate can land as an **emergency landing**, but only on your fresh, explicit decision, which no grant can replace. discern keeps a permanent record of the skipped checks, which never counts as Proof. [Land an urgent repair](../20-guides/land-an-urgent-repair.md) explains how.

## Proof stays with the code

When a change lands, discern attaches its Proof to the landed commit as a Git note, so the record outlasts the worktree and the conversation. If recipe search misbehaves months from now, you can still look up what passed for that commit.

The note stays in your local repository, and discern never uploads it. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) shows how to inspect or share it.

## What to ask your agent for

Ask for the changed behavior, current Proof, and any decision that's still open. [Finish and land a change](../20-guides/finish-and-land-a-change.md) walks through the handoff, and [Fix a red gate](../20-guides/fix-a-red-gate.md) helps when a command fails. Only an ordinary `discern done` run produces Proof you can land, so a report from [continuous integration](../20-guides/run-the-gate-in-ci.md) can't let a change land.
