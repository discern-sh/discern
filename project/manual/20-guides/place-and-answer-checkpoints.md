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

Name a review question once, and your agent answers it every time a matching change comes along. You don't have to remember to ask, and the answer arrives with the change, ready for your review.

A **checkpoint** is that question plus a **trigger**: the rule that picks out the changes it applies to. Your agent proposes both, sets them up, and answers the question on each task. You decide what the question asks, and when the answer is no, only you can let the change land anyway.

If a checkpoint has already fired on a task, skip to [Answer a checkpoint when it fires](#answer-a-checkpoint-when-it-fires).

## Decide whether a checkpoint fits

Say people keep reading lists in your app, and you want deleting a list to be clear and hard to do by accident.

A checkpoint fits a concern that needs judgment on some changes. A test can confirm that Cancel leaves the list alone, but it can't judge whether the dialog makes clear what will be lost, so that question belongs in a checkpoint.

| If your concern is…                              | Use                                                    |
| ------------------------------------------------ | ------------------------------------------------------ |
| Fixed behavior, such as "Cancel deletes nothing" | A test.                                                |
| A rule every session should follow               | [Project instructions](write-project-instructions.md). |
| A number that shouldn't get worse                | A [standard](set-and-raise-standards.md).              |
| A judgment about certain changes                 | A checkpoint.                                          |

Choose a mode with the agent:

- **Stop:** the **gate**, your project's own commands, such as its linter and tests, won't run until the agent records an answer. Use it when every matching change needs the review.
- **Advise:** the question appears as advice, blocks nothing, and needs no answer, so keep it for a useful prompt whose trigger may also catch harmless changes.

## Ask for the checkpoint

Describe the concern in your own words:

> "Every time a change touches how lists get deleted, I want the agent making it to check that people can tell what they'll lose and can back out. Suggest how to catch those changes without interrupting other work, and show me before you add it."

Your agent uses the bundled `discern-place-a-checkpoint` skill, which checks whether a checkpoint is the right home for the concern, then proposes the question, the trigger, and the mode.

## Review the question and trigger

The agent adds the checkpoint to `discern.toml`, your project's discern configuration. For the reading-list app, it might write:

```toml
[checkpoints.list-deletion]
paths = ["src/lists/**"]
mode = "stop"
question = "Does the delete flow make clear which saved books will be removed and give people a reasonable way to avoid an accidental loss?"
teach = "Review the wording, available choices, and recovery from a mistaken deletion."
```

The path is an example: the agent aims the trigger at the files that matter in your project, or at a named **scope**, an area of the project your configuration already defines. With neither, the question applies to every change. Triggers can also narrow by what changed, such as a new file or a large deletion. The [configuration reference](../30-reference/config-reference.md#checkpointsname) lists every option.

You don't need to choose file patterns yourself. Ask the agent for one change that would fire the question and one that wouldn't, and judge whether that line falls where you want it.

Then read the question as one the agent may have to answer "no". "Have you been careful?" can't fail, so it gives neither of you anything to check.

The optional `teach` text says what to consider, and a long question can live in its own file, named with `question_file`. Keep secrets out of both, because questions and answers appear in reports and in **Proof**, discern's record of which commands passed on exactly which commit.

## Land it, then try it

A checkpoint doesn't apply to the change that adds it. discern uses the rules committed where the task's branch started, so a change can't rewrite its own review. The agent commits the new checkpoint, runs the gate, and brings it back for you to land, as in [Finish and land a change](finish-and-land-a-change.md).

Once it has landed on the **trunk**, your project's shared branch, new tasks face it. Each task works in its own **worktree**, a separate copy of the project, and a worktree created before the checkpoint landed keeps the old rules until the agent runs `discern update`.

Next, ask the agent to try the trigger in a new task. It makes a change to the delete flow and a change elsewhere, and checks each one with:

```sh
discern checkpoints
```

The result lists each question, its mode, and whether the current change fires it. On the delete-flow change, it shows:

```text
`list-deletion` (stop): would fire at done (1 matched).
```

On the other change, the same line ends in `idle`. A `discern done --dry-run` preview shows the same, without writing anything. If the question fires on almost everything, narrow the trigger before you rely on it.

## Answer a checkpoint when it fires

Say a later task adds a way to delete several lists at once. When the agent runs `discern done` on that change, discern runs none of your project's commands and shows the question instead:

```text
This change fired one checkpoint that requires your judgment before any gate job runs:

list-deletion — changed: `src/lists/delete.ts`
  Question: Does the delete flow make clear which saved books will be removed and give people a reasonable way to avoid an accidental loss?
  Teach: Review the wording, available choices, and recovery from a mistaken deletion.
```

`discern status` and `discern prepare` show the question earlier, while the agent is still working. You can ask:

> "Judge the deletion question against the change as it stands. Tell me what your answer rests on, and record it as unmet if the concern is still there."

A good answer might mention the list name and book count in the dialog, what Cancel does, and whether a deleted list can be restored. When the agent judges the question met, it runs:

```sh
discern done --met list-deletion
```

When the concern remains, it records that with a reason:

```sh
discern done --unmet list-deletion --why "Bulk deletion takes effect immediately, with no confirmation or undo"
```

Either way, the gate then runs in the same call, and the answer goes into the Proof.

A met answer is the agent's judgment. discern makes sure the question gets an answer, but it has no AI model of its own to judge whether the answer is right, so ask what it rests on if you're unsure.

### A later edit reopens the question

The answer covers the delete flow as the agent saw it. If the agent changes those files again, the question reopens and the agent judges the new version. A changed answer or reason also makes the Proof stale, even without a new commit, so the agent runs `discern done` again for fresh Proof.

## Decide on an unmet answer

An unmet answer is an ordinary result: the gate still runs, and landing waits for your decision. The Proof line says so:

> **Proof:** Gate passed for `agent/bulk-delete-7c21e4` at `4b8e0f13a9d2` · 3 files changed (+58 −6) vs `main` · 1 declared unmet — owner variance required to land · View the full Proof: `discern status --verbose`

The agent brings you the question, the reason, and the options. You can:

- ask for a fix, such as a confirmation step or an undo;
- change the plan, for example by dropping bulk deletion;
- approve a **variance**: permission to land this change despite the unmet question.

A variance covers this change only, and the question stays in force for every future task. If you approve it, the agent lands with:

```sh
discern accept --confirmed --variance list-deletion
```

The command must name every unmet question on the change. A general "land it" doesn't approve a variance, and neither does any grant you set up in advance: only your explicit decision does.

## Tune a checkpoint after real use

Once the question has fired on a few tasks, ask:

> "How is the deletion question working out? Tell me whether it catches real problems, fires on unrelated work, or keeps needing my approval to land, and suggest a better question or trigger if it needs one."

`discern checkpoints` shows how often each question fired, how often the answer was unmet, and how many variances you approved, and `discern patterns` flags checkpoints that never fire, fire on most changes, or keep needing variances. Those counts show how the question behaves, but they can't tell you whether the agent's answers were right.

You might narrow the trigger, reword the question, switch it to advise, or remove it. If the concern turns out to be testable, move it into a test. Any of these changes goes through the same review as the original.

discern also ships built-in checkpoints, such as questions about large deletions and drifting documentation. [Checkpoints](../10-understand/checkpoints.md) describes them, and `discern checkpoints` lists the ones your project uses.

## When it's done

A new checkpoint is in place when:

- it has landed on the trunk;
- it fires on the changes you meant, and stays quiet on the rest;
- its question is one the agent could reasonably answer "no".

On a task, every stop question has an answer in the Proof. Before the change lands, the agent fixes any unmet concern, or you approve a variance for it.

From then on, every task that touches the delete flow faces the question, whichever agent does the work. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) lists the exact answer states.
