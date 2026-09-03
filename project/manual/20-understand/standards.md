---
id: explanation-standards
title: "Standards"
description: "Understand Standards as one-way retained gains, including why a passing number is not an arbitrary quality score."
order: 50
publish: true
kind: explanation
aliases:
  - "Standards"
  - "explanation-standards"
  - "the practice"
  - "tenets"
---

# Standards

A project earns an improvement: test coverage climbs, the bundle shrinks, the last lint suppressions come out. Months later the gain has eroded. Nobody decided to give it back; it slipped away one reasonable-looking change at a time. Asking agents to "keep quality high" doesn't prevent this, because an adjective can't be enforced. A number can.

A Standard is a quality measure that can only improve. Each entry under `[standards]` in `discern.toml` names a measurement, which direction is better, and the current limit. Every run of the project's final quality check (the Gate) measures it and compares the limit against the trunk's: a floor may only rise, a ceiling may only fall, and a change that would make the number worse fails.

A project holding the line on lint suppressions might keep:

```toml
[standards.lint_suppressions]
  direction = "down"
  limit = 12
  run = "./tools/count-suppressions"
```

The `run` command can be anything that prints `DISCERN_METRIC lint_suppressions <number>`: a measuring tool in any language can feed a Standard, with no plugin to build.

## What a limit records

The number never grades the project against an outside scale. A limit of 12 doesn't mean 12 is good; it means some past change reached 12, and the project has decided not to fall behind its own achievement. That's why a passing Standard tells you something specific: the project is at least as good, on this measure, as it has ever proven itself to be.

The comparison runs against the limit committed on the trunk, the project's shared branch. A branch can't edit the limit it is being judged by: a loosened or deleted limit fails the Gate the same way a worsened measurement does. The rule a change must satisfy was agreed before the change existed.

## Capturing a gain

When a change improves a measure, the improvement can become the new baseline. `discern standards --pin` tightens each improved limit to the measured value and commits that limit change on its own, so the history shows what moved and why. A configured `margin` can leave a little headroom between the measurement and the new limit, for measures that drift on unrelated changes.

Pinning is mechanical so the record stays trustworthy: a recorded limit moves because a measurement moved. Suppose the cleanup above removes 3 suppressions. The measure reads 9, the pin sets the limit to 9, and every later branch inherits that ceiling. A branch that reintroduces a suppression measures 10 and fails; the ground the cleanup earned stays earned.

## When the work itself crosses a limit

Sometimes a change grows the number for a defensible reason: a real feature adds bundle size, or a migration must temporarily add code. The agent must never loosen the limit to pass. Moving a limit is your decision.

With your agreement, the agent proposes the new limit from the committed change, and the [Proof](proof.md#approve-a-standard-limit-proposal) carries the proposal to acceptance: the Standard, its current and proposed limits, the measured value, and the reason. Landing waits until you approve that exact proposal in the conversation; recorded grants never cover it. If you decline, the agent restores the trunk's limit and the Gate runs under ordinary enforcement — which usually means the change must shed what it added.

## Standards that survive daily use

Several parts of the design keep a Standard sustainable rather than a tax on every change:

- **Rates.** `per` divides the measurement by a size, so a healthy, growing project isn't punished for growth. A ceiling on suppressions per thousand lines stays meaningful as the codebase doubles.
- **Replay.** `inputs` names the files a measurement reads. When nothing under them changed, the Gate reuses the recorded value instead of measuring again, and the no-loosening check still runs.
- **On-demand measurement.** A measurement too slow for every run moves to `discern standards`, which measures on request. The check that no limit was loosened has no off switch.

Over time, the project's own record shows each Standard's trajectory, and [Patterns](evidence-and-improvement.md#standard-trajectory-decisions) can recommend a pin when the headroom looks durable rather than momentary.

## What a number can't hold

Not every quality dimension reduces to a measurement, and a poorly chosen metric can hold the wrong thing steady. Standards guard the measures the project chose to define; design judgment, review, and [checkpoints](checkpoints.md) carry the questions that can't be counted. Together they make up the practice's answer to "did this change make the project worse?": the countable part is enforced, and the rest is asked at the moment it matters.

[Set and raise Standards](../10-guides/set-and-raise-standards.md) is the working procedure: choosing a metric worth defending, responding when a Standard fires, and the falling-ceiling route for driving a legacy pattern to zero. The [config reference](../30-reference/config-reference.md) lists every field.
