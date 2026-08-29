---
id: explanation-practice-and-roles
title: "Practice and roles"
description: "Understand discern as a project-installed practice, the coding agent as operator, and the human as owner and reviewer."
order: 20
publish: true
kind: explanation
aliases:
  - "explanation-practice-and-roles"
  - "Concepts: how discern fits together"
  - "concepts"
  - "overview"
  - "mental model"
  - "how discern works"
  - "Design principles"
  - "principles"
  - "philosophy"
  - "design"
  - "why"
  - "practice"
redirect_from:
  - "/docs/orientation/concepts"
  - "/docs/orientation/design-principles"
  - "/docs/orientation/system-map"
---

# Practice and roles

Handing real work to coding agents changes what your day looks like: less typing code, more directing, reviewing, and deciding. It also exposes a problem. Every session starts empty. The project's conventions, its checks, and its definition of "done" live in your head and in chat transcripts, so you repeat them, and an agent's "finished" means whatever that session decided it meant.

discern moves that standard out of conversation and into the project. It installs an engineering practice as part of the repository itself: a definition of done, an isolated workspace for each task, evidence for completed work, and durable homes for project knowledge. Every session, from any configured coding agent, starts under the same conditions, and what one task teaches the project, the next inherits.

## Who does what

The practice runs on a relationship between you, the coding agent, and the project. Keeping the roles apart is most of the mental model.

**You** set intent, supply the judgment only a person can, and hold authority over what becomes shared. You brief the work, answer the questions that reach you, review the evidence, and decide what lands.

**The coding agent** operates discern. It starts tasks, makes the changes, runs the checks, answers judgment questions on the record, and reports back with evidence. discern's interaction design treats the agent as its principal day-to-day operator: its tools, results, and instructions are built for that reader.

**The project** carries the practice. One root file, `discern.toml`, declares what the checks are; the instructions, Skills, and Map carry what the project knows; Git history and recorded evidence carry what has happened. The repository outlives every session that works on it.

Operating and deciding stay separate. The agent drives the tools, and the authority stays with you: a passing check never becomes permission, and an agent's confidence never becomes evidence. discern itself contains no AI model and is not another agent — it's a deterministic local program. The agent supplies the intelligence; discern supplies the working conditions and the checks.

## What the practice consists of

Each piece answers a question you would otherwise be answering by hand:

- **The Gate** is the project's definition of done. `discern done` runs the jobs the project declares (format, build, lint, tests, and the rest), plus extra checks for the areas the change touched, and every quality measure the project keeps. Because the project declares the commands, the same practice serves any stack: discern ships none of your build tools and runs whatever `discern.toml` names.
- **[Proof](proof.md)** is the evidence a passing Gate produces: a record that the declared checks passed for one exact commit, presented for your review and kept with the landed change.
- **[Worktrees](worktrees-and-trunk.md)** give each task its own checkout and branch, so parallel work stays separate and unfinished work stays off the shared branch until you accept it.
- **[Checkpoints](checkpoints.md)** pause the Gate for questions that need judgment rather than a command's exit status, and record the agent's answer where your review can see it.
- **[Standards](standards.md)** hold the project's measured quality at limits that can only improve, so a gain earned once is kept.
- **[Instructions, Skills, and the Map](instructions-skills-and-map.md)** are the knowledge homes: rules every session loads, playbooks loaded when a task matches, and a maintained account of what the agents understand about the project.

## The working loop

A task moves through the practice in a repeating rhythm. The agent orients with `discern status`, a read-only report of the current state and next action. It starts a worktree for the task, makes the change, and iterates with `discern prepare`, the fast check for work still in motion. When the change is complete, the agent commits it and runs `discern done`; a pass over that clean commit produces Proof. The agent reports back with the Proof and waits.

Now the work is yours: review the change and its evidence, exercise the behavior, and decide. With your authority, given in the conversation or recorded in advance, `discern accept` lands the reviewed branch on the shared branch and cleans up the worktree.

Your part of the loop is concentrated at its ends: the brief at the start, any judgment questions that arise in the middle, and the review and landing decision at the end. From the main checkout, running `discern` with no arguments opens the Desk, your view over the tasks in flight; [Delegate work](../10-guides/delegate-work.md) covers directing several at once.

## Why the project carries it

Anything that lives in conversation has to be re-established: sessions end, context fills up, and providers change. What lives in the repository persists, and it's reviewed and versioned like the code it governs.

That's also why switching coding agents doesn't reset the practice. The instructions are written once and compiled into each configured agent's own file, the Skills materialize for every agent, and the Gate reads the same `discern.toml` regardless of who invokes it. The project's way of working belongs to the project.

Where a behavior matters, the practice prefers a check to a request. A rule written as prose can fall out of a crowded session; a rule written as a Gate job, a Standard, or a checkpoint holds regardless of what the session remembers.

## What discern doesn't do

The boundaries are as much a part of the model as the pieces:

- It doesn't restrict your agent. What an agent may read, run, or change is governed by the agent's own permission system, and discern is not a sandbox.
- It doesn't judge beyond the declared checks. Green means the checks the project declared passed for that tree; whether the design is right, and whether the result should ship, remain review and release questions.
- It doesn't move shared state on its own. Landing requires authority you supplied; [Proof](proof.md) explains how that decision works.
- It doesn't run a service or call home. discern is a local binary whose state lives in the repository; [Local control](local-control.md) draws that boundary precisely.

To decide whether the practice fits a project, read [Evaluate discern](../00-start/evaluate-discern.md). To watch the loop run once end to end, follow [Install and set up discern](../00-start/first-success.md).
