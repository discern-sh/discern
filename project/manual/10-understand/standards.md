---
id: explanation-standards
title: "Standards"
description: "Lock in a measured improvement so every later change has to keep it, and decide for yourself when a limit should move."
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

A standard keeps a measured gain from slipping back. Once your project reaches a number worth keeping, such as a smaller download or higher test coverage, every later change has to meet it.

That's how your project gets better as it grows: each gain you lock in becomes the starting point for the next task, whichever agent picks it up. Without it, new features slowly eat the gain, and months later it's gone without anyone deciding to give it up.

## What a standard holds

A **standard** is a measured limit your project holds. Say your recipe app's first download is 1,200 kilobytes (kB), and you set that as its limit. That makes 1,200 kB a **ceiling**, because lower is better. A measure such as test coverage uses a **floor**, because higher is better.

Every time your agent runs `discern done`, the **gate**, which runs your project's tests and other required commands, takes the measurement and compares it with the limit. The quickest way past a limit would be to loosen it in the same change, so the gate also checks that the change hasn't loosened the limit, deleted the standard, or changed what gets measured. A change can't weaken a standard to make its own work pass: only you can approve a looser limit.

## Lock in a gain

Now say your agent removes unused images, and the download drops to 900 kB. Your agent's report ends with a [Proof](proof.md) line, a one-line summary of what passed, and it counts each standard that measured better than its limit, so it shows the gain: `Standards held (1 improved)`. You can ask:

> "The download got smaller. Can you make sure it stays that way? Show me the new limit before you change it."

Your agent **pins** the standard: `discern standards --pin` tightens the limit to match the measured gain and commits that change on its own. A **margin** leaves a little room for small ups and downs, so ordinary changes don't trip the new limit. Here's how that plays out with a 100 kB margin:

| Change                | Download size | Ceiling  | What happens                                    |
| --------------------- | ------------- | -------- | ----------------------------------------------- |
| Set the standard.     | 1,200 kB      | 1,200 kB | The app meets the limit.                        |
| Remove unused images. | 900 kB        | 1,200 kB | The app passes, with a gain you can lock in.    |
| Pin the gain.         | 900 kB        | 1,000 kB | The new ceiling leaves 100 kB of room.          |
| Add a small feature.  | 960 kB        | 1,000 kB | The feature fits.                               |
| Add a larger feature. | 1,040 kB      | 1,000 kB | The standard fails, and the agent investigates. |

The margin only matters when you pin. It isn't extra room every time the gate runs, so 1,040 kB still breaks a 1,000 kB ceiling.

The pin is a commit like any other, so it goes through the gate and lands the usual way. From then on, every later task has to meet the new limit, including tasks by agents that never saw the gain.

## When a feature needs more room

The larger feature might be worth its extra download, say because it lets people save recipes to read offline. The standard puts that cost in front of you while you can still choose.

First, your agent tries to avoid the increase. If a needed part of the feature causes it, the agent shows you the new size, the limit, the reason, and the other options, without shrinking something unrelated to make the number pass.

Then you decide. You can keep the limit and change the feature. Or you can approve a new limit: your agent proposes it, and the Proof shows the current limit, the proposed one, the measured size, and the reason. Landing needs your approval of that exact proposal, and neither a general "go ahead" nor permission you set up in advance covers it. [Set and raise standards](../20-guides/set-and-raise-standards.md) walks through the decision.

## Pick a number that holds up as the project grows

Choose the measure that says what you care about, because a standard holds that number and nothing else. A smaller download doesn't make the app easier to use, and high test coverage doesn't mean the tests ask the right questions. [Checkpoints](checkpoints.md) ask the questions that need judgment, and your review decides whether the result serves the people using the app.

Then ask how the measure moves as the project grows:

- **A count that shouldn't grow at all**, such as uses of an old pattern you're phasing out. Hold the count, and drive it down to zero.
- **A quality that scales with size**, such as test coverage. Hold a rate, like a percentage, so healthy growth doesn't count as getting worse.
- **A total that grows with every feature**, such as download size. Prefer a rate if one says what you mean. If only the total works, set a margin, and expect to approve a higher limit now and then.

The measurement should give the same result for the same code, because a timing that changes with network traffic would stop changes for reasons that have nothing to do with them. Your agent can suggest a steady measure and tell you what it leaves out.

`discern done` checks every standard for every change, and when nothing a measurement reads has changed, discern reuses the earlier result, so a slow measurement doesn't slow every task. Your agent can run `discern standards` to check a value while it works, but only `discern done` records Proof.

[Set and raise standards](../20-guides/set-and-raise-standards.md) shows how to add a standard or lock in a gain. The [configuration reference](../30-reference/config-reference.md#standardsname) lists the exact fields and how a measurement reports its value.
