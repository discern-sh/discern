---
id: guide-place-and-answer-checkpoints
title: "Place and answer Checkpoints"
description: "Place a scarce judgment stop, answer it with evidence, and route an unmet conclusion to the owner."
order: 50
publish: true
kind: guide
aliases:
  - "guide-place-and-answer-checkpoints"
  - "Checkpoint recipes"
  - "checkpoint recipe gallery"
  - "checkpoint examples"
redirect_from:
  - "/docs/quality-gate/checkpoint-recipes"
---

# Place and answer Checkpoints

Use this guide for a review question that becomes relevant when a narrow kind of change occurs and that a machine cannot decide. A Checkpoint pairs a deterministic trigger with a question for the coding agent. It can stop the Gate until the agent records a conclusion, or serve the question as advice.

The coding agent owns the declared conclusion. The person responsible owns policy placement and the decision to land a declared-unmet conclusion. discern records those roles separately from machine-verified Gate results.

## Starting state

To place a Checkpoint, begin with a recurring review question, examples of the changes that should trigger it, and the person's agreement that it belongs in project policy. To answer one, begin in the worktree where `discern prepare`, `discern checkpoints`, or `discern done` served the question and its matched paths.

## Place a Checkpoint

### 1. Put the rule on the right rung

**Coding agent:** Invoke the `discern-place-a-checkpoint` Skill. Use a Checkpoint only when a diff introduces the concern, a machine cannot settle it, and the question deserves attention on each matching change.

Route other rules elsewhere:

- a rule needed throughout most work belongs in project instructions;
- a recurring method belongs in a Skill;
- a numeric rule belongs in a Standard or Gate job;
- a decision only the person may make remains an authority decision.

Use `mode = "stop"` when every matching change must record a conclusion. Use `mode = "advise"` for a heuristic that should inform without blocking.

### 2. Write one narrow trigger and one judgeable question

**Coding agent:** Prefer a named scope or a small path set. Add predicates only to remove irrelevant changes. The question should name what must be true for this matched change and permit a real unmet answer.

This minimal example stops changes to migrations:

```toml
[checkpoints.migration-safety]
paths = ["migrations/**"]
mode = "stop"
question = "Does each migration state its lock behavior and rollback path?"
teach = "The owner needs the operating risk before this change can land."
```

Keep secrets out of `question`, `teach`, and `reference`; they can appear in terminal output, MCP results, CI, and Proof. Use the [Config reference](../30-reference/config-reference.md) for selectors, thresholds, delta predicates, and the `when` protocol instead of copying the full field catalogue into this procedure.

### 3. Land the policy before testing governance

Checkpoint definitions come from the effort's merge base with the trunk. A branch that adds or edits a Checkpoint does not govern its own Gate.

**Coding agent:** Commit the policy change, run the full Gate, and return it for owner review. **Person:** decide whether the question, trigger, and mode should govern future work, then authorize its landing.

After the policy lands, **coding agent or person:** confirm it from the trunk:

```sh
discern checkpoints
```

The result must list the id, mode, question, and trigger summary.

### 4. Exercise the trigger and refusal

**Coding agent:** In a new worktree with a representative matching change, preview the strict decision:

```sh
discern done --dry-run
```

For a `stop` Checkpoint, run bare `discern done` once and verify that it refuses before any Gate job, serves the question, names the matched evidence, and offers both declaration routes. For `advise`, verify that the question appears without preventing the Gate.

If the Checkpoint never fires, fires on most work, or matches the wrong paths, revise the trunk policy. Do not compensate by declaring a noisy question met on every branch.

## Answer a fired Checkpoint

### 1. Judge the current subject

**Coding agent:** Read the served question, teaching note, and matched paths. Inspect the content named by the result. `discern checkpoints` is a read-only way to recover the current open-question state.

If the question is satisfied for that subject, run:

```sh
discern done --met checkpoint-id
```

If it is not satisfied, either change the work and re-evaluate, or record the current conclusion with an owner-facing reason:

```sh
discern done --unmet checkpoint-id --why "Reason this change does not satisfy the question"
```

The Gate records the declaration before it runs. A met declaration is still agent judgment; discern does not verify its truth. An unmet declaration lets the Gate run and carries its rationale into Proof.

### 2. Re-evaluate after relevant edits

A declaration binds to the resolved definition and matched content. A relevant edit reopens the question. Changed declaration evidence also makes existing Proof stale, even when `HEAD` has not changed.

**Coding agent:** Read the question again, record a fresh conclusion, and rerun the Gate. Do not reuse the earlier declaration or Proof for changed evidence.

### 3. Route an unmet conclusion to the person

A green Gate with a declared-unmet Checkpoint remains unlanded.

**Person:** Review the rationale and choose one of two outcomes: require work that makes the conclusion met, or authorize a variance for this declaration and commit. A standing scope grant, one-worktree grant, or generic landing consent cannot authorize the variance.

When the person explicitly approves it in the current conversation, **coding agent:** pass every current unmet id at acceptance:

```sh
discern accept --confirmed --variance checkpoint-id
```

The id set must match the current declared-unmet set. A later relevant edit creates a new subject and requires a new decision.

## Tune the Checkpoint after real use

**Person and coding agent:** Review `discern checkpoints` and `discern patterns` after several efforts. Frequent firing, frequent variances, or no firing are evidence to narrow the trigger, rewrite the question, change `stop` to `advise`, move a mechanical rule into the Gate, or remove the policy. Those changes govern only after they land on the trunk.

## Completion

Placement is complete when the trunk lists the intended policy and a representative change demonstrates the expected fire or advise path. Answering is complete when the current subject has a declared conclusion, the Gate result preserves that qualification, and any unmet variance is either resolved in the work or explicitly authorized by the person before landing.

Read [Checkpoints and judgment](../20-understand/checkpoints.md) for the model, [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) for states and protocols, and [Finish and land a change](finish-and-land-a-change.md) for the surrounding lifecycle.
