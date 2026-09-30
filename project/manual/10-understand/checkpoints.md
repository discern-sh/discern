---
id: explanation-checkpoints
title: "Checkpoints"
description: "Have the review questions that need judgment asked whenever a matching change happens, with your agent's answer in the Proof."
order: 50
publish: true
kind: explanation
aliases:
  - "explanation-checkpoints"
  - "checkpoints guide"
  - "judgment stop"
  - "stop checkpoint"
  - "advise checkpoint"
  - "checkpoint question"
  - "checkpoint subject"
  - "checkpoint policy"
  - "owner variance"
  - "built-in checkpoints"
  - "checkpoints"
  - "variance"
  - "open question"
---

# Checkpoints

A checkpoint makes your agent answer your question whenever a change touches the files it watches, and the answer goes into the change's [Proof](proof.md), discern's record of what passed, for you to read. You don't have to remember to ask.

Tests settle what a machine can decide. The questions you'd raise in a review, such as whether a new message tells people what to do next, need judgment, and they're easy to skip when every test is green.

## A question at the moment it matters

Say your agent changes how people delete a reading list in your app. The tests pass, but no test can tell you whether people understand what they're about to lose, or can back out.

A **checkpoint** puts that question into your project, paired with a **trigger** that picks out the changes that need it. To add one, tell your agent:

> "Whenever a change touches how lists get deleted, ask whether people can see what they'll lose and have a clear way to back out."

Your agent adds it to `discern.toml`, your project's configuration, aimed at the files that handle deleting:

```toml
[checkpoints.list-deletion]
  paths = ["src/lists/delete*"]
  question = "Can people see what they'll lose when they delete a list, and is there a clear way to back out?"
```

Once that lands, every later task that changes those files gets the question, and your agent judges the actual change before it answers.

## Stop or advise

- **Stop**, the default: `discern done` won't run the **gate**, your project's tests and other required commands, until your agent records an answer.
- **Advise:** the question appears as advice. It blocks nothing and needs no answer, so keep it for questions a missed answer won't hurt.

## The answer is your agent's judgment

For a stop checkpoint, your agent answers **met** or **unmet**, and both are useful answers:

| Your agent finds                                                                | Its answer                                                                 | What happens next                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| The dialog names the list and the books in it, and has a clear Cancel button.   | **Declared met.** People know what they'll lose and can back out.          | The gate runs. You see the answer beside its results. |
| A new action deletes several lists at once, with no warning and no way to undo. | **Declared unmet.** Your agent explains the risk and why it's still there. | The gate still runs, but landing needs your decision. |

**Declared met** is your agent's conclusion. discern has no AI model of its own, so it records the answer without judging whether it's right. The Proof keeps it apart from the test results, so you can ask your agent why it decided, or try deleting a list yourself.

## Declared unmet, and your variance

An unmet answer is an ordinary result: the gate still runs, and landing waits for your decision. So your agent can be honest about a gap and still finish its work. For the action that deletes several lists at once, the Proof line says so:

> **Proof:** Gate passed for `agent/delete-several-lists-7d6507` at `5d949883475a` · 1 file changed (+4 −0) vs `main` · Standards held · 1 declared unmet — owner variance required to land · View the full Proof: `discern status --verbose`

You can ask your agent to add a warning or an undo. Or you can decide the risk is fine for this change and approve a **variance**: your permission to land despite the unmet answer. Only you can approve one, in the current conversation, after your agent shows you the question and its reason. A general "go ahead" doesn't approve one, and neither does any grant you set up in advance. The variance covers this answer on this change, and the question still applies to later tasks.

## The answer belongs to the change

Your agent's answer covers the question and the files it looked at. Say you ask for an undo on the several-lists action: that edit changes the deleting files, so the question reopens, and this time your agent can answer met. An edit to other files leaves the answer standing, unless it changes which files match.

Like any later edit, a changed answer makes the Proof [stale](proof.md#why-proof-becomes-stale), even on the same commit, so your agent runs `discern done` again.

## The checkpoints discern ships

discern ships built-in checkpoints for problems common in agent-built projects, including:

| The problem                                                                                  | The checkpoint              | What it asks                                    |
| -------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| A cleanup removes code something else still uses.                                            | **Deletion-heavy change**   | Is every removal proven safe?                   |
| A second version of a feature appears beside the first.                                      | **Parallel implementation** | Should the original have changed instead?       |
| The code changes, but the [map](instructions-skills-and-map.md) still describes the old way. | **Map drift**               | Does the map still describe how the code works? |
| The instructions every session reads keep growing.                                           | **Instruction economy**     | Does each new line earn its place?              |

Those that watch code only advise, so none blocks a code change. Those that watch your instructions, skills, and map stop for an answer, because every later session reads those files. You choose which to use, and `discern checkpoints` lists the ones that apply.

## Trigger composition

A trigger can start from a set of files, like the list-deletion one, or from a **scope**, a named area of your project such as its documentation. Either way, it can narrow to kinds of change, such as new files or a large deletion. For anything else, it can run a short script from your project. Your agent picks the details, so each question reaches only the changes where it helps.

## Which checkpoints apply to a change

A task's checkpoints come from the trunk, your project's shared branch, so a change can't rewrite the questions it has to answer. Adding or editing a checkpoint is a change you review like any other.

If discern can't read part of a checkpoint, it records a **drop** in the Proof, naming the checkpoint and the reason, instead of blocking the work. In continuous integration, `discern done --ci` lists the questions a change would need answered, but it can't answer them.

## Checkpoints should earn their interruptions

A stop checkpoint interrupts every change it matches, so it should ask a useful question each time. discern counts how often each one fires, comes back unmet, or gets your variance, so your agent can show you which ones earn their place.

A rule a machine can decide belongs in a test or a [standard](standards.md), and one every session needs belongs in the [project instructions](instructions-skills-and-map.md). A checkpoint is for a question that needs judgment when a certain change happens.

[Place and answer checkpoints](../20-guides/place-and-answer-checkpoints.md) shows how to add or tune one, and the [configuration reference](../30-reference/config-reference.md#checkpointsname) lists every field.
