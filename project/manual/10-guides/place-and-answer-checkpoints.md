---
id: guide-place-and-answer-checkpoints
title: "Place and answer checkpoints"
description: "Make a recurring review question part of the workflow, and understand the decisions its answers bring back."
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

A checkpoint helps you carry a useful review question into future tasks. Instead of remembering to raise it every time, you have the project present it when the relevant kind of change appears.

Your agent proposes where the question belongs, implements the trigger, and answers it when it fires. You review the policy and decide whether to allow a change that leaves a required question unmet.

## Starting state

You can start with a concern in ordinary language. For example, in an app that keeps reading lists, you want deletion to feel deliberate and understandable:

> Use discern-place-a-checkpoint to make agents review changes to list deletion. The question should ask whether people can understand what will be removed and have a reasonable way to avoid an accidental loss. Suggest a trigger that catches the relevant changes without interrupting unrelated work.

If a checkpoint has already fired on a task, go to [Answer a fired checkpoint](#answer-a-fired-checkpoint). You do not need to add another rule to handle the existing question.

## Place a checkpoint

### 1. Put the rule on the right rung

The agent first checks whether a checkpoint is the right home for your concern. It is useful when a specific change raises a question that cannot be fully answered by a repeatable machine check.

For list deletion, tests can establish that Cancel leaves the list intact. An agent still needs to judge whether the dialog clearly describes the loss and offers appropriate choices. That is a reasonable review question.

If the concern is “Cancel must not delete anything,” ask for a test. If it is a convention relevant to most work, put it in [project instructions](write-project-instructions.md). This keeps checkpoints focused on the moments that deserve a judgment.

Choose the mode with the agent:

- **Stop** requires an answer before the gate runs. Use it when every matching change should receive the review.
- **Advise** presents the question without blocking. Use it for a useful hint whose trigger may also match harmless changes.

### 2. Write one narrow trigger and one answerable question

Your agent identifies the files that make the question relevant. It should explain a change that would trigger it and one that would not. You can judge whether that distinction fits the concern without choosing file patterns yourself.

An illustrative reading-list project might use:

```toml
[checkpoints.list-deletion]
paths = ["src/lists/**"]
mode = "stop"
question = "Does the delete flow make clear which saved books will be removed and give people a reasonable way to avoid an accidental loss?"
teach = "Review the wording, available choices, and recovery from a mistaken deletion."
```

Your agent should replace the example path with the actual files or an existing scope in your project, and narrow the trigger if unrelated list changes would produce too many interruptions.

Read the question as something an agent might have to answer “no.” A useful question leaves room for an honest unmet conclusion; “Have you been careful?” gives neither the agent nor you much to assess.

The optional `teach` text explains what to consider. Longer questions can live in a tracked project file through `question_file`. Keep secrets out of both forms, since questions and reasons can appear in reports and Proof. The [configuration reference](../30-reference/config-reference.md) lists the remaining selectors and trigger options.

### 3. Land the policy before testing governance

Review the question, examples of when it fires, and its stop or advise mode. Your agent commits the policy change, runs the full gate, and brings it back for landing through the normal review process.

A new question does not govern the same change that introduces it. Once the policy lands on the trunk, the project's shared branch, the agent can confirm the installed question with:

```sh
discern checkpoints
```

The result lists the question, trigger, and mode. It also shows the policy source used for inspection. Completion evaluates the policy preceding its selected candidate; the agent follows the served question if queued work changes that context.

### 4. Exercise the trigger and refusal

Ask the agent to demonstrate the behavior with representative changes, including a change that should leave the checkpoint quiet. This checks whether the trigger reaches the moment you intended.

A matching worktree can preview completion with:

```sh
discern done --dry-run
```

For stop mode, an ordinary `discern_done` with no declaration should serve the question and wait for the agent's conclusion before running the gate. For advise mode, the question should appear without preventing the checks.

The useful evidence is the actual question as a future agent will receive it, the matched content, and the expected behavior for both matching and unrelated work. If it appears everywhere, narrow the trigger before treating repeated answers as a success.

## Answer a fired checkpoint

### 1. Judge the current subject

When a question appears, the agent reads it with the matched content and any teaching note. You can ask:

> Review the checkpoint against the actual change. Explain what supports your answer, and record an unmet conclusion if the concern remains.

For the delete-list example, a supported answer might describe the list name and book count shown in the dialog, how Cancel behaves, and whether an accidental deletion can be recovered. Base the answer on the implemented behavior.

The agent records a satisfied conclusion with:

```sh
discern done --met list-deletion
```

If the question is unmet, it can improve the work or record that conclusion with a reason:

```sh
discern done --unmet list-deletion --why "Bulk deletion takes effect immediately, with no confirmation or undo"
```

An unmet declaration allows the gate to run while preserving the reason for your review. A met declaration is still the agent's judgment: discern verifies that the required answer was recorded, not that the answer is true.

### 2. Re-evaluate after relevant edits

If the agent changes the delete flow again, its earlier answer may no longer apply. A relevant edit reopens the question. The agent reviews the new content, records a fresh conclusion, and renews the gate evidence.

Changing the conclusion or its rationale also changes the evidence, even without a new code commit. `discern checkpoints` can recover the current question state; an old Proof should not be used to describe a changed judgment.

### 3. Decide what to do with an unmet conclusion

The agent should bring you the question, affected work, reason it remains unmet, and practical alternatives. Ask for a change if the concern should be resolved before landing. You can also approve a **variance**, an exception for the exact current declaration and change.

For example, an immediate bulk-delete action might be unacceptable for people's saved reading lists. That decision is easier when the agent shows the actual behavior and the missing protection, rather than presenting only a green test result.

If you explicitly approve the exception, the agent names the current unmet checkpoint at acceptance:

```sh
discern accept --confirmed --variance list-deletion
```

Where several questions are unmet, the accepted set must match them all. A standing permission, an earlier task grant, or a general “land it” does not approve a variance. Relevant changes require a fresh decision about the new declaration.

## Tune the checkpoint after real use

After the question has appeared on real tasks, ask:

> Review this checkpoint's history. Is it catching useful decisions, firing on unrelated work, or repeatedly needing exceptions? Recommend a better question or trigger if needed.

The agent can inspect `discern checkpoints` and `discern patterns`. The recorded frequency and outcomes support the review; they do not tell you whether the agent's judgments were correct.

Narrowing the trigger, changing the wording, choosing advise mode, or removing an unhelpful checkpoint can all be sensible policy decisions. If the question becomes fully testable, move that check into the gate. Review policy changes through the same workflow as the original addition.

## Completion

Placement succeeds when the question asks something worth considering and representative changes show it appears at the right time. On a task, the current declaration should explain what the agent concluded; any unmet concern is either resolved or explicitly accepted by you before landing.

[Checkpoints](../20-understand/checkpoints.md) shows the model and useful built-in questions. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) contains the exact states and protocols, and [Finish and land a change](finish-and-land-a-change.md) covers the surrounding review.
