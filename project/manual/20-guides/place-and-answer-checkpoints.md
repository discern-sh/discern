---
id: guide-place-and-answer-checkpoints
title: "Place and answer checkpoints"
description: "Name a review question once, and your agent answers it on every change it applies to, before you review."
order: 110
publish: true
kind: guide
aliases:
  - "guide-place-and-answer-checkpoints"
  - "Checkpoint recipes"
  - "checkpoint recipe gallery"
  - "checkpoint examples"
---

# Place and answer checkpoints

Name a review question once, and your agent answers it on every change it applies to. You don't have to remember to ask, and the answer arrives with the change for your review.

A **checkpoint** is that question plus a **trigger**, the rule that picks out the changes it applies to. Your agent sets both up, and you decide what the question asks. When the answer is no, only you can let the change land anyway.

If one has already fired, skip to [Answer a checkpoint when it fires](#answer-a-checkpoint-when-it-fires).

## Decide whether a checkpoint fits

Say you want deleting a reading list in your app to be clear and hard to do by accident. A test can confirm that Cancel leaves the list alone, but it can't judge whether the dialog makes clear what will be lost, so that question belongs in a checkpoint.

| If your concern is…                              | Use                                                    |
| ------------------------------------------------ | ------------------------------------------------------ |
| Fixed behavior, such as "Cancel deletes nothing" | A test.                                                |
| A rule every session should follow               | [Project instructions](write-project-instructions.md). |
| A number that shouldn't get worse                | A [standard](set-and-raise-standards.md).              |
| A judgment about certain changes                 | A checkpoint.                                          |

Choose a mode with the agent:

- **Stop:** the **gate**, your project's own commands, such as its linter and tests, won't run until the agent records an answer.
- **Advise:** the question appears as advice and blocks nothing, so use it when a missed answer won't hurt.

[Checkpoints](../10-understand/checkpoints.md) explains both modes and the built-in checkpoints discern ships.

## Ask for the checkpoint

Ask your agent:

> "Whenever a change touches how lists get deleted, check that people can tell what they'll lose and can back out. Show me how you'd catch only those changes before you add it."

Your agent follows the bundled `discern-place-a-checkpoint` skill to propose the question, trigger, and mode.

## Review the question and trigger

The agent adds the checkpoint to `discern.toml`, your project's discern configuration:

```toml
[checkpoints.list-deletion]
paths = ["src/lists/**"]
mode = "stop"
question = "Does the delete flow make clear which saved books will be removed and give people a reasonable way to avoid an accidental loss?"
teach = "Review the wording, available choices, and recovery from a mistaken deletion."
```

You don't need to write file patterns. Ask the agent for one change that would fire the question and one that wouldn't, and judge whether the line falls where you want it. The [configuration reference](../30-reference/config-reference.md#checkpointsname) lists every trigger option.

Then read the question as one the agent may have to answer "no". "Have you been careful?" can't fail, so it gives neither of you anything to check.

Keep secrets out of the question and the optional `teach` line, because questions and answers appear in reports and in **Proof**, discern's record of which commands passed on one exact commit.

## Land it, then try it

A checkpoint doesn't apply to the change that adds it. discern uses the rules committed where the task's branch started, so no change can rewrite its own review. The agent brings it back for you to land, as in [Finish and land a change](finish-and-land-a-change.md).

Once it lands, every new task faces it, whichever agent does the work. A task that started earlier keeps the old rules until the agent runs `discern update`.

Then have the agent try it in a new task, checking one change to the delete flow and one elsewhere with:

```sh
discern checkpoints
```

On the delete-flow change, the result shows:

```text
`list-deletion` (stop): would fire at done (1 matched).
```

The other change shows `idle`. If the question fires on almost everything, narrow the trigger before you rely on it.

## Answer a checkpoint when it fires

Say a later task adds a way to delete several lists at once. When the agent runs `discern done`, discern shows the question before it runs anything else:

```text
This change fired one checkpoint that requires your judgment before any gate job runs:

list-deletion — changed: `src/lists/delete.ts`
  Question: Does the delete flow make clear which saved books will be removed and give people a reasonable way to avoid an accidental loss?
  Teach: Review the wording, available choices, and recovery from a mistaken deletion.
```

You can ask:

> "Judge the deletion question against the change as it stands. Tell me what your answer rests on, and record it as unmet if the concern remains."

A good answer might mention the list name and book count in the dialog, what Cancel does, and whether a deleted list can be restored. The agent records its answer as met, or as unmet with a reason:

```sh
discern done --met list-deletion
discern done --unmet list-deletion --why "Bulk deletion takes effect immediately, with no confirmation or undo"
```

Either way, the gate then runs, and the answer goes into the Proof. A met answer is the agent's judgment, because discern has no AI model of its own to check it.

### A later edit reopens the question

If the agent edits the delete flow again, the question reopens for the new version. Any new commit or changed answer makes the Proof stale, so the agent runs `discern done` again.

## Decide on an unmet answer

An unmet answer is an ordinary result: the gate still runs, and landing waits for your decision. The Proof line says `1 declared unmet — owner variance required to land`.

The agent brings you the question and its reason. You can:

- ask for a fix, such as a confirmation step or an undo;
- drop bulk deletion from the plan;
- approve a **variance**: permission to land this change despite the unmet question.

A variance covers this change only, and the question still applies to every later task. If you approve one, the agent lands with:

```sh
discern accept --confirmed --variance list-deletion
```

A general "land it" doesn't approve a variance, and neither does any grant you set up in advance: only your explicit decision does.

## Tune a checkpoint after real use

Once it has fired a few times, ask:

> "How is the deletion question working out? Tell me whether it catches real problems, fires on unrelated work, or keeps needing my approval."

discern's counts show how often the question fired, came back unmet, or needed a variance, but they can't tell you whether the agent's answers were right.

You might narrow the trigger, reword the question, switch it to advise, move it into a test, or remove it. Each change gets the same review as the original.

## When it's done

A new checkpoint is in place when it has landed, fires on the changes you meant and stays quiet on the rest, and asks a question the agent could reasonably answer "no".

On a task, you're done when every stop question has an answer in the Proof and any unmet concern is fixed or covered by your variance. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) lists the exact answer states.
