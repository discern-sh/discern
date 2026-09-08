---
id: guide-set-and-raise-standards
title: "Set and raise standards"
description: "Choose a useful measure, retain an improvement, and make informed decisions when a limit is reached."
order: 100
publish: true
kind: guide
aliases:
  - "guide-set-and-raise-standards"
  - "quality metrics"
  - "metric floors"
  - "metric ceilings"
---

# Set and raise standards

Use a standard when an improvement matters enough that future changes should preserve a measured limit. Your agent handles the measurement and configuration. You decide what is worth holding and whether a later tradeoff justifies changing it.

For example, you can track the amount someone downloads to open your app. Keeping that size in view helps prevent a useful saving from disappearing as agents add features.

## Starting state

The project should already be set up with discern. Bring the quality you care about; you do not need to know its measuring tool or the files involved.

> Use discern-set-the-standard to propose a limit for the app's initial download size. Explain exactly what it would measure, the current value, and how it would handle normal growth. I want to review the proposal before it becomes project policy.

The skill guides your agent through choosing, wiring, and checking the measure. If the concern cannot be judged by a repeatable number, the agent may recommend a [checkpoint](place-and-answer-checkpoints.md) or another kind of check instead.

## Add a standard

### 1. Choose a defensible number

Ask the agent to explain the proposal in terms you can assess:

- **Meaning:** What would an increase or decrease tell us about the app?
- **Repeatability:** Will the same project state give the same result?
- **Cost:** Can the project afford to measure it during completion?
- **Growth:** Will useful new features change the number even when nothing has got worse?

For download size, define which files and units count. For a growing quantity, consider a rate or deliberate headroom. For something the project intends to remove, such as remaining uses of an obsolete implementation, a raw count can be appropriate.

Start with a limit the project currently meets. A hoped-for improvement belongs in a task plan; setting that future value as today's limit would block ordinary work before the improvement exists.

### 2. Add the measurement and current limit

After you agree the proposal, your agent writes the measuring command and adds the standard to `discern.toml`. It records what the number means so future agents can understand the reason for it.

An illustrative project that currently measures 1,200 kB might use:

```toml
[standards.download_size]
direction = "down"
limit = 1200
margin = 100
run = "tools/measure-download-size"
```

Here, `down` makes the limit a maximum. `up` would make it a minimum. The 100 kB margin leaves headroom when a later improvement is pinned; the current limit is still 1,200 kB.

`tools/measure-download-size` is a project-specific script the agent would provide, not a command shipped by discern. It builds or reads the agreed files and emits the measurement:

```text
DISCERN_METRIC download_size 1200
```

The producer must complete successfully and supply a valid measurement. A missing number, a failed command, or a value outside the limit needs attention.

If the project already produces this measurement during another check, the agent can reuse that producer. It should declare all relevant inputs, toolchain facts, and environment conditions so old evidence is reused only when applicable. The [configuration reference](../30-reference/config-reference.md#standardsname) holds those fields.

### 3. Exercise both outcomes

Ask the agent to demonstrate that the standard accepts the current app and catches a representative breach. A test in a disposable fixture can show the failure without leaving the project in that state.

The agent measures a named standard with `discern_standards`, or:

```sh
discern standards download_size
```

You should receive the measured value, held limit, and evidence that the failing case is detected. The agent then runs `discern_prepare`, commits the intended change, and runs `discern_done`. Review and land the policy through [Finish and land a change](finish-and-land-a-change.md).

## Respond when a standard fires

### 1. Understand the increase

A breach deserves investigation before a policy decision. Ask:

> Explain the measured change and what caused it. Look for reasonable fixes within this task. If the increase is part of the feature we want, show me that tradeoff rather than cutting unrelated useful work.

For example, after a previous improvement lowered the ceiling to 1,000 kB, a new feature might measure 1,040 kB. The agent should explain the extra 40 kB and what it buys. Repair a broken measuring command before reconsidering the size limit.

The agent keeps the held limit while it investigates. Removing the standard, shrinking what gets measured, or raising the limit by hand would change the rule instead of resolving the result.

### 2. Decide whether the tradeoff is worthwhile

If a reasonable implementation can fit the existing limit, have the agent make that change. If the extra size is justified, ask for a formal proposal. You can also defer the feature or choose a smaller version.

Your decision should be about the outcome. For example: is the new search useful enough to justify the additional download, and is there a simpler alternative with the same benefit?

Permission to land the feature does not also approve weakening its standard. That separate decision keeps the measurement's cost visible.

### 3. Finalize an approved proposal

Once you agree a proposal is warranted, the agent finishes the implementation and commits its final tree. It then runs:

```sh
discern standards propose download_size --reason "The agreed search feature increases the initial download"
```

The command measures the named standard, creates the proposal's configuration commit, and records its value and reason. The agent follows the result's next action and produces current [Proof](../20-understand/proof.md).

Review the exact old limit, proposed limit, measurement, and reason together. If you approve that proposal, the agent uses its returned token at acceptance:

```sh
discern accept --confirmed --approve-standard <token>
```

The token must match the current proposal. Further edits may require renewed measurement and proposal evidence; the agent follows the reported recovery rather than carrying forward an old approval for a different value.

## Pin an earned improvement

When a change improves an existing measure, ask to retain the gain:

> Pin the download-size improvement, keeping our configured margin. Show me the measured value and the new ceiling, then finish the resulting change through the gate.

On a clean committed tree, the agent runs:

```sh
discern standards --pin download_size
```

If the old ceiling is 1,200 kB, the new measurement is 900 kB, and the margin is 100 kB, pinning sets the ceiling to 1,000 kB. It commits that limit change separately. Pinning cannot loosen a limit, and an improvement smaller than the margin may leave nothing to pin.

discern reuses compatible measurement evidence when available. Pinning itself does not establish completion for the new commit: follow the result and renew the full gate evidence before landing.

For a count you intend to reduce to zero, ask the agent to plan a permanent check for the first new instance. Keep the standard until any replacement policy has been explicitly reviewed; deleting a held standard on an ordinary branch fails the gate.

## Completion

A useful standard has an understandable purpose, a working detector, and a limit the project can meet. Once its policy lands, later work must satisfy it. When an improvement is pinned or a limit proposal is approved, the final completion evidence should describe that exact change.

[Standards](../20-understand/standards.md) explains retained gains with a worked example. [Fix a red gate](fix-a-red-gate.md) helps when the measurement cannot run, and the [configuration reference](../30-reference/config-reference.md#standardsname) lists every setting.
