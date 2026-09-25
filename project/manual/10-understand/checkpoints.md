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

Say your agent changes how people delete a reading list in your app. The tests pass: the button works, the list disappears, and the other lists are still there. What no test can tell you is whether people understand what they're about to lose, and whether they can back out.

A **checkpoint** puts that question into your project. It pairs a **trigger**, which picks out the changes that need the question, with the question for your agent to answer. To add one, tell your agent:

> "Whenever a change touches how lists get deleted, ask whether people can see what they'll lose and have a clear way to back out."

Your agent writes the checkpoint into `discern.toml`, your project's configuration, aimed at the files that handle deleting:

```toml
[checkpoints.list-deletion]
  paths = ["src/lists/delete*"]
  question = "Can people see what they'll lose when they delete a list, and is there a clear way to back out?"
```

Once that lands, discern asks the question whenever a later task changes those files, and your agent looks at the actual change before it records an answer.

## Stop or advise

A checkpoint either stops for an answer or gives advice:

- **Stop:** `discern done` won't run the **gate**, your project's tests and other required commands, until your agent records an answer. A checkpoint you write stops unless it says otherwise.
- **Advise:** the question appears as advice. It blocks nothing and needs no answer, so keep it for questions a missed answer won't hurt.

Your agent sees a stop question early, because `discern status` and `discern prepare` show it as soon as the change matches, while the agent is still working.

For a stop checkpoint, your agent answers **met** or **unmet**, and both are useful answers:

| Your agent finds                                                                | Its answer                                                                 | What happens next                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| The dialog names the list and the books in it, and has a clear Cancel button.   | **Declared met.** People know what they'll lose and can back out.          | The gate runs. You see the answer beside its results. |
| A new action deletes several lists at once, with no warning and no way to undo. | **Declared unmet.** Your agent explains the risk and why it's still there. | The gate still runs, but landing needs your decision. |

## The answer is your agent's judgment

**Declared met** is your agent's conclusion. discern has no AI model of its own, so it records the answer without judging whether it's right.

The Proof keeps the two apart: test results come from discern running your project's commands, and checkpoint answers come from your agent. So you can ask your agent why it decided, try deleting a list yourself, or ask another agent to review it.

That's what makes a checkpoint more useful than a general reminder to be careful: you know which question was asked about this change, and what your agent concluded.

## Declared unmet, and your variance

An unmet answer is an ordinary result: the gate still runs, and landing waits for your decision. For the action that deletes several lists at once, your agent's report ends with a Proof line that says so:

> **Proof:** Gate passed for `agent/delete-several-lists-7d6507` at `5d949883475a` · 1 file changed (+4 −0) vs `main` · Standards held · 1 declared unmet — owner variance required to land · View the full Proof: `discern status --verbose`

You can ask your agent to add a warning or an undo. Or you can decide the risk is fine for this change and approve a **variance**: permission to land despite the unmet answer. Only you can approve one, in the current conversation, after your agent shows you the question, the files, and its reason. A general "go ahead" doesn't approve a variance, and neither does any grant you set up in advance. The variance covers this answer on this change, and the question still applies to future tasks.

So your agent can be honest about a gap and still finish its work, and the decision that needs you comes to you.

## The checkpoints discern ships

discern comes with checkpoints for problems that often show up in projects agents build. Here are some of them:

| The problem                                                                                           | The checkpoint              | What it asks your agent                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| A cleanup removes code another part of the app still uses.                                            | **Deletion-heavy change**   | Is every removal proven safe, with tests and docs updated to match?               |
| A second version of a feature appears beside the first.                                               | **Parallel implementation** | Should the original have changed instead, so future fixes have one place to go?   |
| One small request grows into unrelated repairs.                                                       | **Effort sprawl**           | Is this still one change you can review?                                          |
| An image or other binary file arrives with no history.                                                | **New binary asset**        | Is it clear where it came from, whether you may use it, and how to update it?     |
| The code changes but the project's [map](instructions-skills-and-map.md) still describes the old way. | **Map drift**               | Does the map still describe how the code works?                                   |
| The instructions every session reads keep growing.                                                    | **Instruction economy**     | Does each new line earn its place, or does it belong somewhere read only at need? |

The built-in checkpoints that watch code changes only advise, so none of them blocks a code change. The ones that watch your project's instructions, skills, map, and page of known gate failures stop for an answer, because every later session reads those files; the last one stays quiet until `[project].gotchas_doc` names the page. Your project chooses which checkpoints to use and can change any of them, and `discern checkpoints` lists the ones that apply to yours.

## The answer belongs to the change

Your agent's answer covers the question and the files it looked at. Say you ask for an undo on the several-lists action: that edit changes the deleting files, so discern asks the question again, and this time your agent can answer met. An edit that touches only other files leaves the answer standing, but discern also asks again when a change alters which files match or the question itself.

Because the Proof records your agent's answers beside the test results, a changed answer makes the Proof stale even when the commit hasn't changed, and your agent runs `discern done` again.

## Trigger composition

The list-deletion trigger is a set of files, but a trigger can also start from a **scope**: a named area of your project, such as its documentation. Either way, it can then narrow to certain kinds of change, such as new files, lines added or removed that contain some text, a large deletion, a new binary file, or a change that touches many files. For anything those can't express, a trigger can run a short script from your project.

That keeps each question to the changes where it helps. Your agent picks the details: [Place and answer checkpoints](../20-guides/place-and-answer-checkpoints.md) shows how, and the [configuration reference](../30-reference/config-reference.md#checkpointsname) lists every field.

## Which checkpoints apply to a change

The checkpoints that apply to a task come from the trunk, your project's shared branch. A task's own branch can't change them, so a change can't rewrite the questions it has to answer. Adding or editing a checkpoint is a change for you to review like any other, and it applies to later tasks once it lands.

If discern can't read part of a checkpoint, it doesn't block the work. It records a **drop**: a note in the Proof that names the checkpoint and the reason. When a stop checkpoint's script can't decide, discern asks the question anyway, over every file the trigger matched, and landing that change then needs your approval in the conversation, which no grant can give.

In continuous integration, `discern done --ci` lists the questions a change would need answered while it runs the gate. It can't answer them, and you can't land a change with its Proof.

## Checkpoints should earn their interruptions

A stop checkpoint interrupts every change that matches it, so it should ask a useful question each time. One that fires on almost every change becomes routine, and one that never fires may be aimed at the wrong files.

discern records how often each checkpoint fires, how often the answer is unmet, and how often you approve a variance. Ask your agent to review them:

> "Which of the questions we ask about changes are worth the interruption? Show me how often each one came up and what the answers were."

If a machine can decide the rule, it belongs in a test or a [standard](standards.md). A rule every session needs belongs in the [project instructions](instructions-skills-and-map.md). A checkpoint is for a question that needs judgment when a certain change happens.

[Place and answer checkpoints](../20-guides/place-and-answer-checkpoints.md) shows how to add or tune one. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) lists the exact states and answer fields.
