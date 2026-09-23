---
id: explanation-checkpoints
title: "Checkpoints"
description: "Get the review questions that need judgment asked whenever a matching change happens, with your agent's answer in the Proof."
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

A checkpoint makes sure a question you care about gets asked whenever a change calls for it. Your agent answers it while the change is in front of it, and the answer comes back in the [Proof](proof.md), discern's record of what passed on that change. You don't have to remember to ask.

Tests check what a machine can decide. Checkpoints cover the questions that need judgment, such as whether a new message tells people what to do next.

## A question at the moment it matters

Say your agent changes how people delete a reading list in your app. The tests pass. The button works, the list disappears, and the other lists are still there. One question is left: will people understand what they're about to lose, and can they back out?

A **checkpoint** puts that question into your project. It has a **trigger**, which picks out the changes that need the question, and the question for your agent to answer. To add one, tell your agent:

> Whenever a change touches how lists get deleted, ask whether people can see what they'll lose and have a clear way to back out.

The agent writes the checkpoint into your project's configuration, aimed at the files that handle deleting. Once that lands, discern asks the question whenever a later task changes those files. The agent looks at the actual change and records its answer.

## Stop or advise

A checkpoint either stops for an answer or gives advice:

- **Stop:** `discern done` won't run the checks until the agent records an answer.
- **Advise:** the question appears as advice. It blocks nothing, and it needs no answer.

The agent sees a stop question early. `discern status` and `discern prepare` show it as soon as the change matches, while the agent is still working.

For a stop checkpoint, the agent answers **met** or **unmet**. Both are useful answers:

| The agent finds                                                                 | Its answer                                                                | What happens next                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| The dialog names the list and the books in it, and has a clear Cancel button.   | **Declared met.** People know what they'll lose and can back out.         | The checks run. You see the answer beside their results. |
| A new action deletes several lists at once, with no warning and no way to undo. | **Declared unmet.** The agent explains the risk and why it's still there. | The checks still run, but landing needs your decision.   |

## The answer is your agent's judgment

**Declared met** means your agent reached that conclusion. discern doesn't check whether it's right. discern has no AI model of its own, so it can't judge a design.

The Proof keeps the two apart. Check results come from discern running your project's commands. Checkpoint answers come from your agent. You can ask the agent why it decided, try deleting a list yourself, or ask another agent to review it.

That's what makes a checkpoint more useful than a general reminder to be careful. You know which question was asked about this change, and what the agent concluded.

## Declared unmet, and your variance

An unmet answer gives you a clear decision. You can ask the agent to add a warning or an undo. Or you can decide the risk is fine for this change and approve a **variance**: permission to land despite the unmet answer.

Only you can approve a variance, in the current conversation. The agent first shows you the question, the files, and its reason. A general "go ahead" doesn't approve one, and neither does any grant you set up in advance. The variance covers this answer on this change. It doesn't weaken the question for future tasks.

So your agent can be honest about a gap and still finish its work. The checks run as usual, and the decision that needs you comes to you.

## The checkpoints discern ships

discern comes with checkpoints for problems that often show up in projects agents build. Here are some of them:

| The problem                                                         | The checkpoint              | What it asks your agent                                                           |
| ------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| A cleanup removes code another part of the app still uses.          | **Deletion-heavy change**   | Is every removal proven safe, with tests and docs updated to match?               |
| A second version of a feature appears beside the first.             | **Parallel implementation** | Should the original have changed instead, so future fixes have one place to go?   |
| One small request grows into unrelated repairs.                     | **Effort sprawl**           | Is this still one change you can review?                                          |
| An image or other binary file arrives with no history.              | **New binary asset**        | Is it clear where it came from, whether you may use it, and how to update it?     |
| The code changes but the project's map still describes the old way. | **Map drift**               | Does the map still describe how the code works?                                   |
| The instructions every session reads keep growing.                  | **Instruction economy**     | Does each new line earn its place, or does it belong somewhere read only at need? |

The built-in checkpoints that watch code changes only advise, so none of them blocks a code change. The ones that watch changes to your project's instructions, skills, map, and gate-gotchas page stop for an answer, because every later session reads those. The gate-gotchas one stays quiet until `[project].gotchas_doc` names that page. Your project chooses which checkpoints to use and can change any of them. `discern checkpoints` lists the ones that apply to yours.

## The answer belongs to the change

The agent's answer covers the question and the files it looked at. If a later edit touches other files, the answer still stands. If the edit changes those files, changes which files match, or changes the question, discern asks again. The agent then judges the new version.

A changed answer makes the Proof stale, even when the commit hasn't changed. The Proof records the agent's answers beside the check results, so the agent runs `discern done` again.

## Trigger composition

A trigger starts with a set of files, or with a **scope**: a named area of your project, such as its documentation. It can then narrow to certain kinds of change. For example, it can pick new files, lines added or removed that contain some text, a large deletion, a new binary file, or a change that touches many files. For anything those can't express, a trigger can run a short script from your project.

That keeps each question to the changes where it helps. Your agent picks the details. [Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) shows how. The [configuration reference](../30-reference/config-reference.md#checkpointsname) lists every field.

## Which checkpoints apply to a change

The checkpoints that apply to a task come from the trunk, your project's shared branch. A task's own branch can't change them, so a change can't rewrite the questions it has to answer. Adding or editing a checkpoint is a change for you to review like any other. It applies to later tasks once it lands.

If discern can't read part of a checkpoint, it doesn't block the work. It records a **drop**: a note in the Proof that names the checkpoint and the reason. When a stop checkpoint's script can't decide, discern asks the question anyway, over every file the trigger matched. Landing that change then needs your approval in the conversation. No grant covers it.

In continuous integration, `discern done --ci` lists the questions a change would need answered, while it runs the checks. It can't answer them, and you can't land a change with its Proof.

## Checkpoints should earn their interruptions

A stop checkpoint interrupts every change that matches it, so it should ask a useful question each time. One that fires on almost every change becomes routine. One that never fires may be aimed at the wrong files.

discern records how often each checkpoint fires, how often the answer is unmet, and how often you approve a variance. Ask your agent to review them:

> Which of our checkpoints are worth their interruptions? Show me how often each one fired and what the answers were.

If a machine can decide the rule, it belongs in a test or a [standard](standards.md). A rule every session needs belongs in the [project instructions](instructions-skills-and-map.md). A checkpoint is for a question that needs judgment when a certain change happens.

[Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) shows how to add or tune one. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) lists the exact states and answer fields.
