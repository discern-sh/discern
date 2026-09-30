---
id: guide-improve-the-practice
title: "Improve how your agents work"
description: "Find the change that would help your agents most, based on what happened in past tasks, then try it and see whether it helped."
order: 120
publish: true
kind: guide
aliases:
  - "guide-improve-the-practice"
  - "Improve the practice"
  - "The continuous-improvement coach"
  - "improvement coach"
  - "practice health"
  - "audit"
  - "Coupling"
  - "cochange"
  - "change partners"
  - "Learn from your project's history"
  - "explanation-evidence-and-improvement"
  - "Evidence and improvement"
  - "Practice patterns"
  - "patterns"
  - "detectors"
  - "logbook reader"
  - "agent cohorts"
  - "instruction parity"
  - "Validation findings"
  - "same-tree-flake"
  - "execution-context-divergence"
  - "validation evidence basis"
  - "Patterns decision evidence"
  - "decision-grade patterns"
  - "fail-fast tradeoff"
  - "Standard pin recommendation"
  - "Pattern investigations"
  - "finding synthesis"
  - "investigation paths"
  - "validation instability"
redirect_from:
  - "/docs/understand/evidence-and-improvement"
---

# Improve how your agents work

Find the change that would help your agents most, based on what happened in past tasks. You fix real friction, such as a slow test run or a refusal that keeps coming back, instead of guessing, so you spend less time unblocking agents and they spend more on the work you asked for.

discern reads the **logbook**, its local record of what its commands did, and reports **findings** with the counts behind them. Findings only advise: they never block your work, change a setting, or approve a change.

## Before you start

For something failing right now, start with [Troubleshooting](../40-troubleshooting/README.md) instead.

Findings need history, so a new project's reports have little to say yet. The logbook stays in your repository's `.git` folder. [What stays on your machine](../10-understand/local-control.md) covers what it records and how to turn it off.

## Ask where to improve

Say small changes to your recipe app have started taking longer to finish:

> "Finishing small changes takes longer than it used to. Find out why, and suggest one improvement the evidence supports. Explain why it's worth doing and how we'd tell whether it helped."

The agent starts with `discern improvement`, which scores your setup's tests, instructions, map, and more, lists questions for you and the agent to judge, and names one next action. A low score alone isn't a reason to add rules, so ask what a fix would change in practice.

## Look at what happened

For a problem that repeats, the agent reads the history with `discern patterns`, the **pattern report**. It shows where the time goes in the **gate**, your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. For your slower changes, it might say:

```text
- One job used most gate time with avoidable-cost evidence.
- Observed: `test` averages 312s per `done` — 81% of all recorded gate time across 14 of 14 considered runs. 4 of 14 comparable gates repeated one complete validation state.
```

## Read a finding

The 81% is an observation. Your tests, the `test` **job**, take most of the gate's time, but they may be essential and already fast. The last sentence makes it a finding: 4 times, the tests ran again on code that hadn't changed. That's time you could save, so the agent looks there first.

Every count comes with the total it came from, because failures in 3 of 4 tries mean something different from failures in 3 of 400. The report also labels each value as measured or estimated, such as how long a run that stopped early would have taken.

Each **detector**, one check in the report, needs enough evidence before it reports anything. **Insufficient evidence** means the logbook can't tell yet. It doesn't mean there's no problem, and it doesn't call for an invented improvement: leave things as they are, or ask for a small investigation.

## What the detectors watch

The report groups its detectors by question:

- **Are your gains holding?** Each [standard](../10-understand/standards.md)'s measurements over time, and whether a gain has held steadily enough to lock in.
- **Does the gate fit the work?** Jobs that take most of the time, waits for a free test slot, code that passes once and fails the next time, and [checkpoints](../10-understand/checkpoints.md) that never fire, fire on almost everything, or keep needing your approval to land.
- **Where does work get stuck?** Repeated failures or refusals, suggested next steps the agent didn't follow, and edits made straight on your shared branch.
- **How do tasks move toward landing?** The funnel detector counts failed runs before the first pass, time from start to landing, single giant-commit landings, and updates that keep getting harder.

`discern patterns --stats` shows what went well, such as changes landed, passing streaks, and cycle times.

## Related findings become one investigation

Why did the tests keep running on unchanged code? Say the report also finds the tests passed three times and failed twice on that same code, and your agent asked for a fresh gate run four times. The report joins findings like these into one **investigation** with one question: is a test unstable? It names what to check next and what would weaken the idea, such as the tests staying stable when reproduced under the same conditions. The original findings stay visible, and findings with missing or conflicting evidence stay separate.

Some investigations need only one finding. When a standard could be tightened but its recent readings went back and forth, the report opens a `Standard variance` investigation. It suggests looking into the variation before you lock in the gain.

## Where comparisons stop

A comparison helps only when you know what changed between the runs, so discern compares runs that share a setup: the same configuration, discern release, and coding agent version. After a tooling change, it starts a new series.

The logbook holds no code, prompts, or command output, so it can't say why a test failed. Tests that passed and failed on the same code point at the tests or the conditions they ran under, without saying which. Neither result is safe to ignore.

When enough runs show which coding agent drove them, the report compares those groups, called **cohorts**, each count beside its total. If one agent keeps hitting a refusal the others never see, check the instruction file discern writes for it, such as `CLAUDE.md`. That doesn't show the agent is worse, since the agents may have had different work. The report never grades or ranks agents or people.

## Follow the finding into the work

Because the logbook can't explain a failure, the agent follows the finding into the project itself: its configuration, instructions, code, and the commands' own output. For the unstable test, it reproduces the test run and changes one thing at a time until it finds what makes the test fail.

Git history helps too, because it shows which files usually change together. By default, when `discern prepare` or `discern done` passes, discern names any usual partner the change left out, such as an edited file's test. `discern coupling` with a file's path lists that file's usual partners. History shows where to look, and the task decides what needs to change.

## Choose one improvement

Ask for a proposal you can judge:

> "Show me the proposed change, the evidence behind it, and what we'll compare afterwards. Explain any tradeoff before changing a standing rule or check."

Put the fix where the problem lives: a rule new sessions miss goes in the [project instructions](write-project-instructions.md), a method in a [skill](create-and-manage-skills.md), a wrong explanation in the [map](maintain-project-map.md), a gain worth keeping in a [standard](set-and-raise-standards.md), and a missing review question in a [checkpoint](place-and-answer-checkpoints.md).

For the unstable test, the fix goes in the test itself, and the agent shows it still covers the same code. You can also decide the evidence is too weak, or the change costs too much.

## Try it and review it

Your agent makes the change in a **worktree**, a separate copy of the project on its own branch. Then it checks the fix with repeated test runs under the conditions that made the test fail.

It commits, runs the gate, and brings the change back with **Proof**, discern's record of which of your project's commands passed on one exact commit. Review whether it solves the problem at a fair cost, then land it as [Finish and land a change](finish-and-land-a-change.md) describes.

After it lands, ask the agent to revisit the original concern. Later runs should show the tests no longer repeating on unchanged code. The logbook keeps the earlier runs, so the old finding takes a while to fade.

## When it's done

A review is done when it ends in an evidence-backed recommendation that you accept or decline, or in a clear reason the evidence doesn't justify a change yet.

A change you accept is done when it has passed the gate and landed, and the agent has said what improved or which later tasks will show it. Each improvement you keep makes every later task start from a better setup.
