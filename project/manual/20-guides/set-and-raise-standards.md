---
id: guide-set-and-raise-standards
title: "Set and raise standards"
description: "Lock in a measured gain so later changes can't give it back, and decide for yourself when a feature is worth a looser limit."
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

Lock in a measured gain, and no later change can give it back without your say. Your agent sets up the measurement, discern takes it on every change, and only you can approve a looser limit.

A **standard** is a measured limit your project holds: a **ceiling**, such as download size, or a **floor**, such as test coverage.

## Ask for a standard

Say your app's first download got smaller. You don't need to know how to measure it. Ask your agent:

> "We made the app's first download smaller. Can you make sure it stays that way? Before you add anything, show me what you'd measure, today's number, and how normal growth would affect it."

Your agent follows the bundled `discern-set-the-standard` skill. If your concern can't be measured as a repeatable number, it may suggest a [checkpoint](place-and-answer-checkpoints.md) instead.

## Choose a number worth holding

Before you agree, check that a rise or fall would tell you something about the app, and that the same code always gives the same number. For download size, agree which files count. [Standards](../10-understand/standards.md#pick-a-number-that-holds-up-as-the-project-grows) explains how to pick a measure that holds up as the project grows.

Start with a limit the project meets today, because a limit you only hope to reach would block ordinary work until you get there.

## What your agent sets up

The agent writes a measuring script and adds the standard to `discern.toml`, your project's discern configuration. With the download at 1,200 kilobytes (kB) today, it might add:

```toml
# Initial download in kB. Lower is better for people on slow connections.
[standards.download_size]
direction = "down"
limit = 1200
margin = 100
run = "tools/measure-download-size"
inputs = ["src/**", "assets/**"]
```

| Setting     | What it does                                                                                |
| ----------- | ------------------------------------------------------------------------------------------- |
| `direction` | `down` makes the limit a ceiling. `up` would make it a floor.                               |
| `margin`    | The headroom discern leaves when you later lock in a gain. It doesn't loosen today's limit. |
| `inputs`    | Every file the measurement reads. discern reuses the last result while none of them change. |

The measurement is now part of the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. The gate fails if the script fails or prints no number.

Have the agent declare `inputs` from the start. A file left out of `inputs` could let discern reuse an out-of-date number, and proposing a new limit later needs `inputs`, which a task branch can't add. The [configuration reference](../30-reference/config-reference.md#standardsname) lists every setting.

## Try it, then land it

The agent commits the new standard and measures it:

```sh
discern standards download_size
```

```text
`download_size`: measured 1200, limit 1200, held.
```

Ask the agent to show a breach too, in a throwaway copy, so you know the standard catches one. Then it runs the gate and brings the change back for you to land, as in [Finish and land a change](finish-and-land-a-change.md).

## Pin the standard to lock in a gain

Later, your agent removes unused images, and the download drops to 900 kB. Ask:

> "Lock in the smaller download, and show me the new limit before you finish."

The agent runs:

```sh
discern standards --pin download_size
```

Pinning sets the ceiling to the measurement plus the margin, 1,000 kB, and discern commits that change on its own. A pin only tightens, so a gain smaller than the margin leaves nothing to pin.

The pin is a new commit, so the agent runs `discern done` again for fresh **Proof**, discern's record of which commands passed on one exact commit. Once the pin lands, every later task has to meet the tighter limit, including tasks by agents that never saw the improvement.

## Respond when a standard fires

Now a new search feature brings the download to 1,040 kB, over the 1,000 kB ceiling. The gate fails, and its message to your agent starts:

```text
standard 'download_size': download_size 1040 exceeds the ceiling 1000. Bring it down within the scope of your task; never raise the ceiling.
```

### Find the cause

Ask your agent:

> "Explain what caused the increase and look for fixes within this task. If the feature needs the room, show me the tradeoff instead of cutting unrelated work."

If the measuring script is broken, the agent fixes it first. The limit stays put, because the gate fails any task branch that loosens it by hand, deletes the standard, or changes what gets measured.

### Decide whether it's worth it

If the feature can't fit under the limit, you choose: ship a smaller version, put the feature off, or approve a new limit for this change. Is search worth an extra 40 kB for everyone who opens the app?

### Approve a new limit

Once you agree, the agent commits the finished feature and runs:

```sh
discern standards propose download_size --reason "The agreed search feature increases the initial download"
```

This commits the measured value, 1,040 kB, as the new limit. There's no margin, so the next increase will trip it again. The agent runs `discern done`, and the Proof line shows the decision waiting for you:

> **Proof:** Gate passed for `agent/search-5d2e81` at `8c41f7a02be9` · 5 files changed (+212 −9) vs `main` · Standards held · Standard proposal awaiting exact owner approval: `download_size` 1000 → 1040 · View the full Proof: `discern status --verbose`

When the agent asks to land, `discern accept` stops and gives it an approval token for this exact proposal. Once you approve, the agent lands with:

```sh
discern accept --confirmed --approve-standard <token>
```

The token covers one standard, one value, and one reason, so if any of them changes, you're asked again. Permission to land the feature doesn't approve the new limit, and no grant you set up in advance does either.

## When it's done

A new standard is done when it measures something you agreed matters, the agent has shown it catching a breach, and the change has landed. A pinned gain or an approved limit is done once its own commit has landed. [Fix a red gate](fix-a-red-gate.md) helps when a measurement can't run.
