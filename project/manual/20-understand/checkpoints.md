---
id: explanation-checkpoints
title: "Checkpoints"
description: "Understand triggered judgment, met/unmet declarations, drops, and the owner's separate variance decision."
order: 40
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

Some review questions have no exit status. Is this migration's trade-off acceptable? Does this large deletion keep anything it shouldn't lose? Is this new dependency worth carrying? A test can't answer those, so they usually wait for a person — and as you delegate more work, they either interrupt you constantly or get skipped.

A checkpoint puts such a question into the project. It pairs a trigger, the kind of change that makes the question relevant, with a written question the coding agent must weigh and answer on the record before the project's final quality check (the Gate) runs. The judgment happens at the moment a matching change exists, made by the agent who has the change in front of them, and the recorded answer travels with the evidence to your review.

A checkpoint is one entry in `discern.toml`. A project that wants API changes considered before they land might keep:

```toml
[checkpoints.api-compatibility]
  paths = ["lib/api/**"]
  mode = "stop"
  question = "Does this change preserve compatibility for published API consumers, or state the break and its migration path?"
```

Any change under `lib/api/` now carries that question with it. A longer question can live in a tracked project file instead of the config; [Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) covers authoring both.

## What happens at the Gate

When a change matches a `stop` checkpoint, `discern done` refuses before any job runs and serves the open question (the question now awaiting an answer for this change) together with the files that matched. The agent weighs it against the change and records a conclusion:

- **Declared met:** the agent judges the question satisfied and runs `discern done --met api-compatibility`. The declaration is recorded and the Gate continues in the same run.
- **Declared unmet:** the truthful answer is no, and satisfying the question sits outside this task. The agent runs `discern done --unmet api-compatibility --why "<rationale>"`, with a short rationale written for you. The Gate still runs and can pass; the consequence comes later, at landing.

The questions don't wait for the finish line. `discern prepare` and `discern status` name the questions a change has already triggered, so the agent can answer while the reasoning is fresh.

A checkpoint in `advise` mode serves its question the same way and blocks nothing. Use `stop` for a judgment that must be recorded before work can be called done, and `advise` for a prompt worth seeing.

## A declaration is the agent's judgment

The Gate verifies that a required conclusion exists. It never verifies that the conclusion is right — no machine can. [Proof](proof.md) therefore keeps the vocabulary apart: job and Standard results are **verified**, machine-run and machine-measured, while checkpoint conclusions are **declared**, the agent's recorded judgment, labeled as such wherever they appear.

That separation is what makes the record trustworthy. A declared-met conclusion tells you which questions were considered and by whom; it doesn't launder the agent's judgment into a machine result. When you review Proof, you can see both kinds of evidence and weigh them differently.

## Declared unmet, and your variance

A declared-unmet conclusion is a valid, useful answer. The work can still go green, and it then waits. `discern accept` refuses to land while a current unmet conclusion stands, serving you the question, the matched files, and the agent's rationale.

Only you can resolve that. Either ask for the change to satisfy the question, or authorize a **variance**: permission to land despite this unmet conclusion, given in the current conversation, naming the declared-unmet set as it stands. Recorded grants never cover a variance, and the agent can't accept its own judgment. The rationale exists so that a person reads it before the work becomes shared.

## The answer binds to the change

A declaration is an answer about the change the agent examined, so it stays valid only while that examination does. An unrelated edit elsewhere leaves the conclusion standing. A change to the matched content, to the set of matched files, or to the question itself reopens it, and the agent must declare again against the current state. `discern checkpoints` reports each question's state (open, declared met, declared unmet, or reopened) without changing anything.

Proof depends on the same binding: a changed conclusion or rationale makes recorded Proof stale even when the commit hasn't moved, because acceptance relies on those judgments along with the code.

## Trigger composition

A trigger describes the changes that make its question relevant, built from facts discern can read in the diff. It selects changed paths, by pattern or by a named scope, and can narrow from there: the kind of change, literal text being added or removed, the size of the change, and similar bounded facts. When the structured fields can't express the condition, a project `when` command can make the final call: exit 0 fires, exit 10 passes, and every other outcome is indeterminate. Every configured field must hold together for the checkpoint to fire, and a trigger with no path selector watches the complete diff. The [config reference](../30-reference/config-reference.md) lists every field and its semantics, and the recipes in [Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) show combinations for common review moments.

## The trunk governs the questions

The checkpoint policy for a task comes from its branch's merge point with the trunk, the project's shared branch. A branch can't rewrite the question it is being asked, and a policy edit on a branch takes effect for other tasks only after it lands — where, like any `discern.toml` change, it reaches your review.

When uncertainty prevents a checkpoint from being enforced (a rule that can't be resolved, a trigger fact or question file that can't be read), it is recorded as a **drop**: which checkpoint, and why. An indeterminate stop conservatively serves the question over its complete structural match; Proof carrying that drop is not reused, and landing requires your current-conversation confirmation even when a grant exists. An indeterminate advise checkpoint remains non-blocking. A green run can't hide an unenforced judgment.

Continuous integration keeps the same separation. `discern done --ci` runs the machine checks and reports which questions still await review, without answering them, and its report-only evidence can't be used to land. Workflow configuration can't stand in for judgment.

## Interruptions have to earn their keep

A `stop` checkpoint taxes every matching change, so each one should earn its interruption the way a good reviewer's does. A rule agents need while shaping most decisions belongs in the always-loaded instructions; a repeatable method belongs in a Skill; a rule a machine can decide belongs in a Gate job or a Standard; a decision only you may make stays with consent at landing. A checkpoint earns its place when a specific kind of change raises a question that genuinely needs judgment at that moment.

A fresh install activates a small built-in set (one, for example, asks whether a deletion-heavy change is proven safe), and the project adds its own. The record shows how the economics work out in practice: how often each checkpoint fires and how it was answered, so a dead, noisy, or frequently varied question can be reworded or retired. [Improve the practice](../10-guides/improve-the-practice.md) covers reading that evidence.

[Place and answer checkpoints](../10-guides/place-and-answer-checkpoints.md) is the working procedure, with recipes for common review moments. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact states, declaration fields, and trigger protocol, and the [config reference](../30-reference/config-reference.md) lists every trigger field.
