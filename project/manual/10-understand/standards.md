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

A **standard** holds a measured limit. Say your recipe app's first download is 1,200 kilobytes (kB), and you make that its limit: a **ceiling**, because lower is better. Test coverage would use a **floor**, because higher is better.

Whenever your agent runs the **gate**, your project's own commands such as its tests, discern checks the download against its limit. The quickest way past a limit would be to loosen it, so the gate fails a change that loosens a limit you haven't approved, deletes a standard, or changes what gets measured. Only you can approve a looser limit.

## Lock in a gain

Now say your agent removes unused images, and the download drops to 900 kB. The [Proof](proof.md) line that ends its report shows the gain: `Standards held (1 improved)`. Ask:

> "The download got smaller. Can you make sure it stays that way? Show me the new limit first."

Your agent **pins** the standard with `discern standards --pin`, which tightens the limit and commits that change on its own. The new limit keeps a **margin** for small ups and downs, so ordinary changes don't trip it. With a 100 kB margin:

| Change                | Download size | Ceiling  | What happens                       |
| --------------------- | ------------- | -------- | ---------------------------------- |
| Set the standard.     | 1,200 kB      | 1,200 kB | Meets the limit.                   |
| Remove unused images. | 900 kB        | 1,200 kB | Passes, with a gain to lock in.    |
| Pin the gain.         | 900 kB        | 1,000 kB | Leaves 100 kB of room.             |
| Add a small feature.  | 960 kB        | 1,000 kB | Fits.                              |
| Add a larger feature. | 1,040 kB      | 1,000 kB | Fails, and the agent investigates. |

The margin applies only when you pin, so 1,040 kB still breaks the 1,000 kB ceiling. Once the pin lands, every later task has to meet the new limit.

## When a feature needs more room

The larger feature might be worth its extra download if it lets people read recipes offline. The standard puts that cost in front of you while you can still choose.

Your agent first tries to avoid the increase, without shrinking something unrelated to make the number pass. If the feature needs the room, you decide: change the feature, or approve a new limit. The Proof shows the proposed limit and why, and landing needs your approval of that exact proposal. Neither a general "go ahead" nor permission you set up in advance covers it. [Set and raise standards](../20-guides/set-and-raise-standards.md#respond-when-a-standard-fires) walks through the decision.

## Pick a number that holds up as the project grows

A standard holds its number and nothing else, so measure what you care about. A smaller download doesn't make the app easier to use, and high coverage doesn't mean the tests ask the right questions. [Checkpoints](checkpoints.md) ask the questions that need judgment.

Then ask how the number moves as the project grows:

- **A count that shouldn't grow**, such as uses of an old pattern you're phasing out. Hold the count, and drive it to zero.
- **A quality that scales with size**, such as test coverage. Hold a rate, like a percentage, so healthy growth doesn't count as getting worse.
- **A total that grows with every feature**, such as download size. Prefer a rate if one says what you mean. Otherwise, set a margin, and expect to approve a higher limit now and then.

The measurement should give the same number for the same code, because one that shifts with network traffic fails changes for unrelated reasons.

To add one, see [Set and raise standards](../20-guides/set-and-raise-standards.md).
