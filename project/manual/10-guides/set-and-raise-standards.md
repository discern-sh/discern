---
id: guide-set-and-raise-standards
title: "Set and raise standards"
description: "Add a meaningful standard, respond without weakening it, and pin an earned gain."
order: 40
publish: true
kind: guide
aliases:
  - "guide-set-and-raise-standards"
  - "quality metrics"
  - "metric floors"
  - "metric ceilings"
---

# Set and raise Standards

Use this guide when a project has a deterministic quality number that future changes must preserve. A Standard holds today's earned ground: a floor may rise, or a ceiling may fall. It is the wrong tool for a question that needs judgment or an aspirational target the project has not reached.

The person responsible decides whether the metric deserves to block work and owns any proposal to move a limit in the weaker direction. The coding agent designs and tests the measurement, follows the `discern-set-the-standard` skill, and never loosens an existing limit to pass.

## Starting state

- The project already runs discern from a clean worktree.
- The person has named the quality to preserve and accepts that a breach will stop the gate.
- The current trunk has a measurable baseline. The initial limit will describe that baseline rather than a future goal.

## Add a Standard

### 1. Choose a defensible number

**Coding agent:** Invoke the `discern-set-the-standard` skill. Confirm that the measurement is deterministic, affordable, meaningful, and owned.

Classify the number before writing config:

- An invariant, such as suppressions or uses of a deprecated API, holds a raw count.
- A quality that moves with healthy project growth, such as coverage, usually holds a rate with `per` and `scale`.
- A growing total, such as an asset size, needs a defensible rate or an explicit `margin`. A zero-margin ceiling at today's total will block the next legitimate increase.

Use `direction = "up"` for a floor and `direction = "down"` for a ceiling.

### 2. Add the measurement and current limit

**Coding agent:** Keep the measurement command in the repository. It must read the tree and emit:

```text
DISCERN_METRIC metric-name 41
```

Add one table to `discern.toml`. This ceiling example holds the current count of suppressions:

```toml
[standards.suppressions]
direction = "down"
limit = 41
run = "tools/count-suppressions"
inputs = ["src/**", "tests/**"]
```

Declare `inputs` only for every path the metric reads. A narrow list can replay an old measurement after a relevant change. Use `measure = "on-demand"` only when input replay and a per-Standard timeout cannot make the measurement affordable inside the gate.

### 3. Exercise both outcomes

**Coding agent:** Run the named standard through the primary agent tool, `discern_standards`, or its command-line equivalent:

```sh
discern standards suppressions
```

Record the measured value and confirm it passes at the proposed limit. In a temporary local change or hermetic fixture, set the limit beyond the measured value and verify that the same command refuses. Restore the real current limit before committing. This proves the detector catches the failure it claims to guard.

Run `discern prepare`, commit the measurement, config, and current documentation, then run the full gate. The person reviews and lands this as a policy change. Until the table reaches the trunk, it does not establish a shared baseline for other efforts.

## Respond when a Standard fires

### 1. Preserve the trunk limit

**Coding agent:** Read the measured value, limit, direction, and delta from the result. Never delete the standard or weaken its limit in the branch. The Gate compares the branch definition with the trunk and refuses that regression.

If this task introduced avoidable instances, remove those instances within the task's scope and rerun the named standard. Do not offset legitimate growth by degrading unrelated code or documentation.

### 2. Escalate intrinsic growth with measured facts

When the requested work necessarily moves the metric in the wrong direction, stop and report:

> `<standard>` measured `<value>`, a `<delta>` change. `<reason the growth belongs to this work>`. The current limit is `<limit>`.

**Person:** Decide whether to change the work, keep the limit, or review a proposed new limit. A task brief, standing landing grant, or generic acceptance does not approve a weaker standard.

### 3. Finalize an approved proposal

After the person agrees that a proposal is warranted, **coding agent:** finish the implementation and commit its final tree. Then run:

```sh
discern standards propose standard-name --reason "owner-facing reason"
```

The command measures the named standard on the clean `HEAD` and creates or renews the proposal evidence. Follow its next action, produce current Proof, and hand the proposal token back with the measured value and reason.

At acceptance, **person:** approve that exact value-and-reason tuple. **Coding agent:** pass the served token with current conversational consent:

```sh
discern accept --confirmed --approve-standard <token>
```

Acceptance refuses if the token set does not match the current proposal set. An edit or changed measurement creates a different decision and requires renewed evidence.

## Pin an earned improvement

When an ordinary change improves a standard, the result may offer to retain the gain. On the clean commit with current gate evidence, **coding agent:** run:

```sh
discern standards --pin standard-name
```

Pin tightens the limit in the allowed direction, commits that config change, and reuses compatible evidence when available. A configured `margin` leaves the declared headroom. Review the result before acceptance; the tighter limit becomes the baseline only after it lands.

When a ceiling reaches zero, replace the transition metric with an always-on check that fails on the first new instance, then retire the standard as part of that owner-reviewed change.

## Completion

A new standard is complete when its passing and failing paths have both been observed, its limit equals the current trunk baseline, the full gate passes, and the owner has landed the policy. A response to a breach is complete when the metric is back within the held limit or the exact proposal has current Proof and explicit owner approval.

Read [Standards and retained gains](../20-understand/standards.md) for the model, [Config reference](../30-reference/config-reference.md#standardsname) for every key, and [Fix a red gate](fix-a-red-gate.md) when a measurement fails operationally.
