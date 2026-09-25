---
id: explanation-evidence-and-improvement
title: "Learn from your project's history"
description: "Find what keeps slowing your project's work down, with counts behind every finding, before you change how you work."
order: 80
publish: true
kind: explanation
aliases:
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
  - "Standard variance"
---

# Learn from your project's history

When work on your project keeps slowing down, you can find out why from its history instead of guessing: your agent reads discern's local record of each command and brings back findings, with the counts behind them, before you change how the project works.

So you fix the friction that keeps coming back, with the numbers to show it. Each fix makes later tasks smoother, and less of your agent's effort goes into getting past the same problem again.

## Start with a question you recognize

Say small changes to your recipe app seem to wait a long time for their tests. You can ask:

> "Small changes seem to take ages to get through the tests. Is that unusual, or is something costing us time again and again?"

Your agent runs `discern patterns`, the **pattern report**. It reads the **logbook**, discern's local record of what each command did and how long it took, and turns it into **findings**.

## What a finding tells you

A finding says what the report saw, the evidence for it, and a next step. In the recipe app, one reads:

> One job used most gate time with avoidable-cost evidence.
>
> Observed: `test` averages 312s per `done` — 81% of all recorded gate time across 14 of 14 considered runs. 4 of 14 comparable gates repeated one complete validation state.

The first number is an observation. The test suite takes most of the time in the **gate**, the full run of your project's required commands, but the tests may be essential and already fast, and a timing alone can't say whether a test should exist. The second sentence is what makes it a finding: four times, the test suite ran again on code that hadn't changed. That's time you could avoid, so the finding's next step points your agent at a cache or a narrower scope that keeps the same coverage.

Every count comes with the total it came from, because failures in 3 of 4 tries mean something different from failures in 3 of 400. The report also labels which values it measured and which it estimated. If a run stopped early, for example, the report can estimate how long the full run would have taken, and it says so and shows the runs the estimate came from.

Each **detector**, one check the report runs over the logbook, needs enough evidence before it reports anything, so a new project has little to report, and that's a useful answer too. **Insufficient evidence** means the logbook can't tell yet. It doesn't mean there's no problem.

Findings are advice. Reading them changes no settings, fails no checks, and gives no one permission to change anything: you and your agent decide what to do.

## What the detectors watch

The report groups its detectors by the question they answer:

- **Are your gains holding?** Each [standard](standards.md)'s measured values over time, beside its limit.
- **Does the gate fit the work?** Which jobs take most of the time, and how long runs wait for a free test slot. The same code passing one time and failing the next. [Checkpoints](checkpoints.md) that never fire, fire on almost everything, or often land with an unmet answer you approved.
- **Where does work get stuck?** Repeated failed runs or refusals, and whether the agent followed the suggested next step. Edits made straight on the trunk, your project's shared branch.
- **How do tasks move toward landing?** Failed runs before the first pass, time from start to landing, landings made of one giant commit, and updates that keep getting harder.

`discern patterns --stats` shows what went well from the same record: changes landed, runs of passing gates, how long tasks took, and how your standards have moved.

## Related findings become one investigation

Why did the tests keep running on unchanged code? Say the report also finds that the test job passed three times and failed twice on that same code, and that your agent asked for a fresh gate run four times. Together, those findings point at one question: is a test unstable?

When the evidence fits together like this, the report shows the findings as one **investigation**. It names what to check next, here reproducing the test run under the same conditions and changing one thing at a time, and what would weaken the idea, such as the tests staying stable when reproduced. The original findings stay in the report, and if evidence is missing or conflicts, the report doesn't link them.

That gives your agent one specific question to test, and a way to challenge its first explanation.

## Where comparisons stop

A comparison only helps when you know what changed between the runs, so discern compares runs that share a setup: the same configuration, discern release, and coding agent version. After a tooling change, it starts a new series.

Even well-matched runs leave things out. The logbook doesn't hold code, prompts, or command output, so it can't tell you what your agent was building, or why a test failed: your agent needs the project itself to find the cause. A test run that passed and failed on the same code is a reason to look at an unstable test or at the conditions it ran under. It doesn't say which one caused it, and it doesn't make either result safe to ignore.

### When a gain is ready to lock in

Say the recipe app's download got smaller, and you want to lock in the gain by tightening its [standard](standards.md). The gate already says whether a tighter limit is possible, and the report adds whether the gain has held across several recent runs. If the readings went back and forth, the report suggests looking into the variation instead of tightening the limit yet. Either way, you decide. [Set and raise standards](../20-guides/set-and-raise-standards.md) explains how to lock in a gain.

### Comparing coding agents without ranking them

When the logbook shows which coding agent drove enough runs, the report compares those groups, called **cohorts**, with each group's counts beside its total. Runs it can't match to an agent stay visible as a separate share.

A difference is a place to look. Say one agent keeps hitting a refusal that the others never see: it's worth checking the instruction file discern writes for that agent, such as `CLAUDE.md`. The difference doesn't show that agent is worse, because different agents may have had different work, and the logbook doesn't record what the tasks were.

When signals about an agent conflict, discern leaves those runs unattributed. The report never grades agents or people, and knowing which agent ran a command never changes how discern treats its work.

## From a finding to one change

Use the findings to pick one improvement, such as a clearer instruction, a fixed or adjusted test, or a better-aimed checkpoint. In the recipe app, that's the unstable test: your agent reproduces it, finds what makes it fail, and fixes it. Later runs show whether that worked, and the earlier history stays in the record for comparison.

`discern improvement` is another starting point. It checks your setup against the practices discern recommends and suggests one next step, while `discern patterns` adds the history of how the setup has worked in practice.

[Improve how your agents work](../20-guides/improve-the-practice.md) takes one improvement from investigation to review. [What stays on your machine](local-control.md) explains where the logbook lives and what it leaves out. [The logbook reference](../30-reference/logbook.md) lists every field and statistic, and how to turn recording off, seal, or delete the history.
