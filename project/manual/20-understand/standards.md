---
id: explanation-standards
title: "Standards"
description: "Keep a measured improvement from quietly disappearing as the project changes."
order: 60
publish: true
kind: explanation
aliases:
  - "Standards"
  - "explanation-standards"
  - "the practice"
  - "tenets"
---

# Standards

You reduce how much someone needs to download to open your app. It is a worthwhile improvement, especially for people on a slow connection. Then new features arrive, the download grows, and a few months later the saving has disappeared. Nobody chose to give it up.

A **standard** makes a measured limit part of the project's working rules. Your agent can keep building features, but a change that crosses the limit needs attention before ordinary completion can pass. You get to decide whether a useful addition is worth changing the limit.

## What a limit records

Suppose the app's initial download measures 1,200 kilobytes, or kB. The project sets 1,200 as its maximum. That number is a **ceiling**: lower is better. A measure such as test coverage uses a **floor**, where higher is better.

The limit records a decision about this project. It does not mean every app should fit in 1,200 kB, or that this app is good in every other respect. It means the project has reached this size and wants future work to preserve it.

The project's configured checks, called the **gate**, require the measurement to meet its limit. They also check that a branch has not weakened or deleted an existing standard to make its work pass. The measurement's meaning is protected too; changing what gets counted is not a way around the limit.

## Capturing a gain

Now imagine an agent removes unused material from the initial download. It measures 900 kB. You can ask:

> Keep this improvement for future changes. Pin the download-size standard, leaving the headroom we agreed, and show me the new limit.

**Pinning** records a tighter limit from a measured improvement. The command is `discern standards --pin`, which changes the selected limits and makes a separate commit. A configured **margin** leaves some room for ordinary variation when the limit tightens.

Here is an illustrative sequence with a 100 kB margin:

| Change                 | Measured size | Held ceiling | What happens                                            |
| ---------------------- | ------------- | ------------ | ------------------------------------------------------- |
| Establish the standard | 1,200 kB      | 1,200 kB     | The current app meets the limit.                        |
| Remove unused material | 900 kB        | 1,200 kB     | The app passes with an improvement available to retain. |
| Pin that improvement   | 900 kB        | 1,000 kB     | The new ceiling includes 100 kB of headroom.            |
| Add a small feature    | 960 kB        | 1,000 kB     | The feature fits within the held limit.                 |
| Add a larger feature   | 1,040 kB      | 1,000 kB     | The standard needs attention.                           |

The margin affects the new limit when pinning. It is not extra allowance added to every verdict: 1,040 still exceeds the 1,000 ceiling.

Pinning supplies a policy change and measurement evidence. The new commit still needs the normal completion and landing process. Once the tighter limit lands, later tasks inherit it, including tasks run by an agent that never saw the original improvement.

## When the work itself crosses a limit

The larger feature might be worth its extra download. Perhaps it adds a useful way to find saved items. The standard brings the cost into the decision while you can still choose what to do.

First, the agent investigates whether the increase is avoidable. If a needed part of the feature causes it, the agent should show the value, the limit, the reason, and the alternatives. Cutting unrelated useful content to make a number pass would miss the point.

You can keep the limit and change the feature, or ask for a measured proposal to revise the limit. That proposal goes through a separate approval: ordinary permission to land does not approve a weaker standard. [Set and raise standards](../10-guides/set-and-raise-standards.md#respond-when-a-standard-fires) walks through the decision.

## Standards that survive daily use

Choose the quantity that expresses what you care about. A total download size can matter directly to someone opening the app. A count of test-covered lines becomes more useful as a percentage when the project grows. A count of uses of an obsolete feature may be worth reducing all the way to zero.

The measurement should give a repeatable result for the same project state. A timing that changes with network traffic or other work on the machine can create interruptions unrelated to the change. Your agent can recommend a stable measure and explain what it leaves out.

Every configured standard remains required for completion in its required environments. Expensive measurements can share production with existing checks, and discern can reuse applicable recorded evidence when the full declared inputs and conditions still match. Running `discern standards` separately can measure a value while you work; it does not replace the full gate.

## What a number can't hold

A smaller download does not prove that the app is easier to use. High test coverage does not prove that its tests ask the right questions. A standard preserves the measure you chose, so choosing and reviewing that measure remain important.

[Checkpoints](checkpoints.md) handle questions that need an agent's judgment, and your review decides whether the result serves the people using the software. Together, these practices give future work more of the context behind what you value.

Use [Set and raise standards](../10-guides/set-and-raise-standards.md) to add a useful measure or retain a gain. The [configuration reference](../30-reference/config-reference.md#standardsname) contains the exact fields and measurement protocol.
