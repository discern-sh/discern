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

Lock in a measured gain, such as a smaller download, and no later change can give it back without your say. Your agent sets up the measurement and discern takes it on every change, so the gain holds while agents keep adding features. You decide what's worth holding, and only you can approve a looser limit.

A **standard** is a quality limit your project holds. A **ceiling** is a maximum, such as download size, and a **floor** is a minimum, such as test coverage. [Standards](../10-understand/standards.md) explains how limits tighten over time.

## Ask for a standard

Say you've just made your app's first download smaller, and you want it to stay that way as agents add features. You don't need to know how to measure it. Ask your agent:

> "We made the app's first download smaller. Can you make sure it stays that way? Before you add anything, show me what you'd measure, today's number, and how normal growth would affect it."

Your agent uses the bundled `discern-set-the-standard` skill. If your concern can't be measured as a repeatable number, it may suggest a [checkpoint](place-and-answer-checkpoints.md) instead.

## Choose a number worth holding

Ask the agent to explain its proposal in these terms:

- **Meaning:** what does a rise or fall tell you about the app?
- **Repeatability:** does the same code always give the same number?
- **Cost:** is it quick enough to measure on every change?
- **Growth:** will a useful new feature push the number up even when nothing got worse?

For download size, agree which files count and in what unit. For something that grows with the project, a rate often works better than a raw count, such as warnings per 1,000 lines. For an old pattern you want gone, a plain count works, and the agent can take it down to zero.

Start with a limit the project meets today, because a limit you only hope to reach would block ordinary work until you get there.

## What your agent sets up

Once you agree, the agent writes a small script that measures the number and adds the standard to `discern.toml`, your project's discern configuration. If the download measures 1,200 kilobytes (kB) today, it might add:

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
| `limit`     | The number every change must meet: 1,200 kB for now.                                        |
| `margin`    | The headroom discern leaves when you later lock in a gain. It doesn't loosen today's limit. |
| `run`       | The measuring script, which lives in your project.                                          |
| `inputs`    | The files the measurement reads. discern reuses the last result when none of them changed.  |

The script prints its result as one line:

```text
DISCERN_METRIC download_size 1200
```

The **gate**, your project's own commands, such as its linter and tests, which every change must pass before it counts as finished, takes this measurement too. It fails if the script fails or prints no number.

Declare `inputs` from the start, and list every file the measurement reads, because a missing file could let discern reuse an out-of-date number. discern also needs `inputs` to propose a new limit later, and a task branch can't add them afterwards. If another command already measures the number, the agent can point the standard at it with `producer` instead of `run`, so it's measured once. The [configuration reference](../30-reference/config-reference.md#standardsname) lists every setting.

## Try it, then land it

The agent commits the new standard, then measures it:

```sh
discern standards download_size
```

The result shows the measured value, the limit, and whether it held:

```text
`download_size`: measured 1200, limit 1200, held.
```

Ask the agent to show a breach too, in a throwaway copy, so you know the standard catches one. Then it runs the gate and brings the change back for you to land, as in [Finish and land a change](finish-and-land-a-change.md). Once it lands, every later change has to meet the limit.

## Pin the standard to lock in a gain

Say your agent later removes unused images, and the download drops to 900 kB. Ask to keep the gain:

> "The download is down to 900 kB. Lock that in with the margin we agreed, and show me the new limit before you finish."

Once everything in the task is committed, the agent runs:

```sh
discern standards --pin download_size
```

Pinning sets the ceiling to the measurement plus the margin, 1,000 kB, and discern commits that change on its own. Pinning only ever tightens a limit: if the gain is smaller than the margin, there's nothing to pin, and pinning won't run while any standard is failing.

The pin is a new commit, so the agent runs `discern done` again for fresh **Proof**, discern's record of which commands passed on exactly which commit. Once the pin lands, every later task has to meet the tighter limit, including tasks by agents that never saw the improvement.

For an old pattern you're counting down to zero, keep the standard until the count reaches zero, then ask the agent to replace it with a permanent check that blocks any new use.

## Respond when a standard fires

Now a new search feature brings the download to 1,040 kB, over the 1,000 kB ceiling. The gate fails and names the standard, the measured value, the limit, and a command that reproduces the measurement. Its message to your agent starts:

```text
standard 'download_size': download_size 1040 exceeds the ceiling 1000. Bring it down within the scope of your task; never raise the ceiling.
```

### Find the cause

The agent's first job is to bring the number back under the limit within the task, and discern never moves a limit by itself. Ask:

> "Explain what caused the increase, and look for reasonable fixes within this task. If the increase is part of the feature we want, show me the tradeoff instead of cutting unrelated useful work."

If the measuring script is broken, the agent fixes the script first. It leaves the limit alone while it investigates, because editing the limit by hand, deleting the standard, or changing what gets measured all fail the gate on a task branch.

### Decide whether it's worth it

If the feature can fit under the limit, have the agent make it fit. Otherwise, you choose:

- ship a smaller version of the feature;
- put the feature off;
- approve a new limit for this change.

Weigh the outcome: is search useful enough to justify the extra 40 kB for everyone who opens the app?

### Approve a new limit

Once you agree to a new limit, the agent finishes the feature and commits it. Then it runs:

```sh
discern standards propose download_size --reason "The agreed search feature increases the initial download"
```

This measures the standard and sets the limit to the measured value, 1,040 kB, in a commit of its own. There's no margin, so the next increase will trip it again. The agent runs `discern done`, and the full Proof shows the old limit, the new one, the measurement, and the reason, while the Proof line shows the decision still waiting for you:

> **Proof:** Gate passed for `agent/search-5d2e81` at `8c41f7a02be9` · 5 files changed (+212 −9) vs `main` · Standards held · Standard proposal awaiting exact owner approval: `download_size` 1000 → 1040 · View the full Proof: `discern status --verbose`

When the agent asks to land the change, `discern accept` stops and gives it an approval token for this exact proposal. If you approve, the agent lands with:

```sh
discern accept --confirmed --approve-standard <token>
```

The token covers one standard, one value, and one reason, so if any of them changes, you're asked again. Permission to land the feature doesn't approve the new limit, and no grant you set up in advance does either. An [urgent repair](land-an-urgent-repair.md) follows the same rule: its plan shows the new limit, and you approve it with the same kind of token.

## When it's done

- The standard measures something you agreed matters.
- Its script works, and the agent showed it catching a breach.
- The limit is one the project meets today.
- The change landed, so every later task has to meet it.

A pinned gain or an approved new limit is done when its own commit has fresh Proof and has landed. [Fix a red gate](fix-a-red-gate.md) helps when a measurement can't run.
