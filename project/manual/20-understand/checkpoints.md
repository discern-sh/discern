---
id: explanation-checkpoints
title: "Checkpoints"
description: "Put important review questions where changes need them, with the agent's judgment visible in the result."
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

An agent changes how someone deletes a reading list. The tests pass: the button works, the list disappears, and the remaining lists are intact. There is still a question worth asking: will someone understand what they are about to lose, with a reasonable chance to change their mind?

A **checkpoint** puts a review question like that into the project. It has a **trigger**, which selects the changes that need attention, and a question for your coding agent to consider. A required answer becomes part of the change's completion evidence, so it can reach your review without relying on you to remember to ask.

## A question at the right moment

For the reading-list app, you might ask:

> When we change how lists are deleted, have the agent judge whether the flow makes the consequences clear and gives people a reasonable way to avoid an accidental loss.

Your agent can turn that request into a checkpoint aimed at the relevant files. When a later task changes them, discern presents the question. The agent examines the actual change and records its conclusion.

A test can verify that a confirmation dialog appears. Judging whether its wording, timing, and choices are appropriate takes a broader view of the experience. The checkpoint creates a place for that judgment alongside the tests.

## What happens at the gate

Checkpoints have two modes:

- **Stop:** the gate, the project's configured checks, waits until the agent records a conclusion about the matching change.
- **Advise:** the question appears as advice, without blocking the gate or requiring a recorded declaration.

For a stop checkpoint, the agent can declare the question **met** or **unmet**. Both are useful answers. In this illustrative example:

| The agent finds                                                                        | The conclusion                                                                      | What follows                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The dialog names the list and the books it removes, and offers a clear cancel action.  | **Declared met:** the agent judges that people have enough information and control. | The gate can run; you can review the judgment alongside its results.    |
| A new bulk-delete action removes several lists immediately, without a warning or undo. | **Declared unmet:** the agent explains the risk and why it remains.                 | The gate can still run, but landing needs a separate decision from you. |

`discern status` and `discern prepare` identify relevant questions early. At completion, `discern done` serves any required question still awaiting an answer. The agent has the changed content in front of it when it decides.

## A declaration is the agent's judgment

**Declared met** means the agent reached a conclusion. It does not mean discern independently verified that conclusion. discern contains no model that judges the design.

[Proof](proof.md), the completion evidence, keeps the distinction visible. Machine checks are verified within their stated scope; checkpoint answers are declared by the agent. You can ask why the agent reached its conclusion, inspect the experience yourself, or ask another agent to review it.

That makes a checkpoint more useful than a general reminder to “be careful.” You know which question was considered for this particular change.

## Declared unmet, and your variance

An unmet answer gives you a concrete decision. You might ask the agent to add a confirmation or undo action. If you decide the remaining tradeoff is acceptable for this change, you can authorize a **variance**: permission to land despite the stated unmet question.

The agent explains the current question, affected work, and reason before you decide. A general instruction to land, or a permission recorded in advance, does not approve that exception. The variance applies to the exact current declaration and change; it does not weaken the question for future tasks.

An unmet conclusion can therefore be honest without leaving the agent unable to finish its investigation. The checks still establish what they can, while the decision that needs you stays visible.

## Questions already available

discern includes checkpoints for recurring problems in agent-written projects. These examples show what they help you notice:

| Problem                                                             | What the bundled question asks the agent to consider                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A cleanup removes code that another part of the app still needs.    | **Deletion-heavy change:** is the removal supported by checks for remaining uses, with related tests and docs kept current? |
| A second version of an existing feature appears beside the first.   | **Parallel implementation:** should the original have been changed instead, so future fixes do not have two places to go?   |
| One small request expands into unrelated repairs.                   | **Effort sprawl:** is this still one change you can understand and review?                                                  |
| An image or other binary file adds hidden maintenance work.         | **New binary asset:** are its source, permissions, size, and future update path clear?                                      |
| A feature changes but the project's explanation of it stays behind. | **Map drift:** does the project documentation still describe how the code behaves?                                          |
| Every session receives more and more instruction text.              | **Instruction economy:** does the added text belong in every session, or would it work better where it is needed?           |

The shipped questions about code-change shapes use advise mode. The built-in questions about authored project knowledge use stop mode, because that material guides later sessions. Projects can choose their enabled set and override the defaults; `discern checkpoints` shows what applies to yours.

## The answer binds to the change

The agent's answer applies to the question and content it examined. Editing unrelated work can leave the answer valid. Changing the matched content, its file set, or the question reopens it, so the agent must judge the changed work again.

A changed declaration also affects Proof, even if the code commit stays the same. The record includes the judgment as well as the machine checks. The agent follows the returned instructions to review the new subject and renew the evidence.

## Trigger composition

A trigger starts with relevant files or a named project scope. It can narrow the selection by what changed: a new file, removed text, a large deletion, or another supported condition. This helps a question appear where it is useful rather than on every task.

Your agent can choose those details. [Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) shows the workflow, and the [configuration reference](../30-reference/config-reference.md) lists the fields and the optional `when` command for conditions that need a script.

## The existing policy governs the questions

A change is assessed against the committed policy that precedes it. Editing a checkpoint in the same change does not rewrite its own review requirement. New questions and policy changes are work for you to review, too.

In ordinary work, checkpoint inspection uses the branch's shared starting point with the trunk. Completion of a queued candidate uses its recorded predecessor, which may include earlier ready work. The result identifies the governing policy so the agent can explain which question applies.

If discern cannot resolve a question or evaluate part of its trigger, it records that uncertainty as a **drop**, including the reason. An uncertain stop trigger serves the question over the full matching content; the uncertainty stays in Proof and cannot be hidden by reusing it or relying on a recorded landing grant. An uncertain advise trigger remains non-blocking. Your agent should explain the actual missing evidence and the next action.

In continuous integration, `discern done --ci` can report unanswered questions while running machine checks. That report does not answer them or supply evidence that can authorize landing.

## Interruptions have to earn their keep

A checkpoint is worth keeping when a matching change raises a useful question. A question that fires constantly can become routine noise; one that never fires may miss the work it was meant to catch.

You can ask the agent to review which checkpoints are useful, using their recorded history. If the rule can be decided by a machine, it may belong in a test or [standard](standards.md). A general convention belongs in [project instructions](instructions-skills-and-map.md). Questions that need judgment at a particular change are the checkpoint's role.

Use [Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) to add or tune a question. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) contains the exact states and declaration fields.
