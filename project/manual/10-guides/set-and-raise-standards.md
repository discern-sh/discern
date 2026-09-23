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

Lock in a measured gain, such as a smaller download, and no later change can give it back without your say. Your agent sets up the measurement, and discern checks it on every change. You decide what's worth holding, and only you can approve a looser limit.

A **standard** is a quality limit your project holds. A **ceiling** is a maximum, such as download size. A **floor** is a minimum, such as test coverage. [Standards](../20-understand/standards.md) explains how limits tighten over time.

## Ask for a standard

This guide follows one example: how much someone downloads to open your app. You've made it smaller, and you want it to stay that way as agents add features. You don't need to know how to measure it. Ask your agent:

> Use discern-set-the-standard to propose a limit for the app's initial download size. Explain what it would measure, today's value, and how it would handle normal growth. I want to review the proposal before it becomes project policy.

The agent follows the bundled `discern-set-the-standard` skill. If your concern can't be measured as a repeatable number, it may suggest a [checkpoint](place-and-answer-checkpoints.md) instead.

## Choose a number worth holding

Ask the agent to explain its proposal in these terms:

- **Meaning:** what does a rise or fall tell you about the app?
- **Repeatability:** does the same code always give the same number?
- **Cost:** is it quick enough to measure on every change?
- **Growth:** will a useful new feature push the number up even when nothing got worse?

For download size, agree which files count and in what unit. For something that grows with the project, a rate often works better than a raw count, such as warnings per 1,000 lines. For an old pattern you want gone, a plain count works, and the skill can take it down to zero.

Start with a limit the project meets today. A limit you hope to reach would block ordinary work until you get there.

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

If the script fails or prints no number, the gate fails. The **gate** is the full set of checks your project requires before a change counts as finished.

Declare `inputs` from the start, and list every file the measurement reads. A missing file could let discern reuse an out-of-date number. discern also needs `inputs` to propose a new limit later, and a task branch can't add them afterwards. If another check already measures the number, the agent can point the standard at that check with `producer` instead of `run`, so it's measured once. The [configuration reference](../30-reference/config-reference.md#standardsname) lists every setting.

## Try it, then land it

The agent commits the new standard, then measures it:

```sh
discern standards download_size
```

You should see the measured value and the limit it holds. Ask the agent to show a breach too, in a throwaway copy, so you know the check catches one. Then it runs the gate and brings the change back for you to land, as in [Finish and land a change](finish-and-land-a-change.md).

Once it lands, every later change has to meet the limit.

## Lock in an improvement

When a change makes the number better, ask to keep the gain:

> Pin the download-size improvement, keeping our configured margin. Show me the measured value and the new ceiling, then finish the change through the gate.

Once everything in the task is committed, the agent runs:

```sh
discern standards --pin download_size
```

If the ceiling is 1,200 kB and the app now measures 900 kB, pinning sets the ceiling to 1,000 kB: the measurement plus the 100 kB margin. discern commits that change on its own. Pinning only ever tightens a limit. If the gain is smaller than the margin, there's nothing to pin. Pinning won't run while any standard is failing.

The pin is a new commit, so the agent runs `discern done` again. That gives it fresh **Proof**, discern's record of which checks passed on exactly which commit. Once the pin lands, every later task has to meet the tighter limit, including tasks by agents that never saw the improvement.

For an old pattern you're counting down to zero, keep the standard until the count reaches zero. Then ask the agent to replace it with a permanent check that blocks any new use.

## Respond when a standard fires

After that pin, the ceiling is 1,000 kB. Then a new search feature brings the download to 1,040 kB. The gate fails and names the standard, the measured value, the limit, and a command that reproduces the measurement.

### Find the cause

The agent's first job is to bring the number back under the limit within the task. discern never moves a limit by itself. Ask:

> Explain what caused the increase. Look for reasonable fixes within this task. If the increase is part of the feature we want, show me the tradeoff instead of cutting unrelated useful work.

If the measuring script is broken, the agent fixes the script first. It leaves the limit alone while it investigates. Editing the limit by hand, deleting the standard, or changing what gets measured all fail the gate on a task branch.

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

This measures the standard and sets the limit to the measured value, 1,040 kB, in a commit of its own. There's no margin, so the next increase will trip it again. The agent runs `discern done`, and the Proof shows the old limit, the new one, the measurement, and the reason.

When the agent asks to land the change, `discern accept` stops and gives it an approval token for this exact proposal. If you approve, the agent lands with:

```sh
discern accept --confirmed --approve-standard <token>
```

The token covers one standard, one value, and one reason. If any of them changes, you're asked again. Permission to land the feature doesn't approve the new limit, and no grant you set up in advance does either.

## When it's done

- The standard measures something you agreed matters.
- Its script works, and the agent showed it catching a breach.
- The limit is one the project meets today.
- The change landed, so every later task has to meet it.

A pinned gain or an approved new limit is done when its own commit has fresh Proof and has landed. [Fix a red gate](fix-a-red-gate.md) helps when a measurement can't run.
