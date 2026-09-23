---
id: explanation-evidence-and-improvement
title: "Learn from your project's history"
description: "Find what slows your project's work down, with counts behind every finding, before you change how you work."
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

discern keeps a local record of how work goes in your project. Your agent can read it to find what slows the work down, with counts behind every finding, before you change how the project works.

So you fix the friction that keeps coming back, with the numbers to show it. Each fix makes later tasks smoother, and less of your agent's effort goes into getting past the same problem again.

## Start with a question you recognize

Say small changes to your recipe app seem to wait a long time for their checks. You can ask:

> Look at our local history for the checks. Is this unusual, or is something costing us time again and again?

Your agent runs `discern patterns`, the **pattern report**. It reads the **logbook**, discern's local record of what each command did and how long it took, and turns it into **findings**.

Say the report shows that tests take most of the time. That's an observation. The tests may be essential and already fast. Changing them needs evidence of time you could avoid, such as the same slow work repeated for no reason.

So your agent looks next at the test commands and their output. The report helps it choose where to look. It can't tell from a timing alone whether a test should exist.

## What a finding tells you

A finding says what the report saw, the evidence for it, and a next step. Every count comes with the total it came from, because failures in 3 of 4 tries mean something different from failures in 3 of 400.

The report labels which values it measured and which it estimated. If a run stopped early, for example, the report can estimate how long the full run would have taken. It says so, and shows the runs the estimate came from.

Each **detector**, one check the report runs over the logbook, needs enough evidence before it reports anything. **Insufficient evidence** means the logbook can't tell yet. It doesn't mean there's no problem. A new project has little to report, and that's a useful answer too.

Findings are advice. Reading them changes no settings, fails no checks, and gives no one permission to change anything. You and your agent decide what to do.

## What the detectors watch

The detectors are grouped by the question they answer:

- **Are your gains holding?** Each [standard](standards.md)'s measured values over time, beside its limit.
- **Do the checks fit the work?** Which checks take most of the time, and how long runs wait for a free test slot. The same code passing one time and failing the next. [Checkpoints](checkpoints.md) that never fire, fire on almost everything, or often land with an unmet answer you approved.
- **Where does work get stuck?** Repeated failed runs or refusals, and whether the agent followed the suggested next step. Edits made straight on the trunk, your project's shared branch.
- **How do tasks move toward landing?** Failed runs before the first pass, time from start to landing, landings made of one giant commit, and updates that keep getting harder.

`discern patterns --stats` shows what went well from the same record: changes landed, runs of passing checks, how long tasks took, and how your standards have moved.

## Related findings become one investigation

Several findings can point at the same question. Say the recipe app's full checks keep failing on one branch, and running `discern prepare` first would have caught those failures. Together, those findings suggest the agent's feedback loop is too slow.

When the evidence fits together, the report shows the findings as one **investigation**. It names what to check next and what would prove that idea wrong. The original findings stay in the report. If evidence is missing or conflicts, the report doesn't link them.

That gives your agent one specific question to test, and a way to challenge its first explanation.

## Where comparisons stop

A comparison only helps when you know what changed between the runs. discern compares runs that share a setup: the same configuration, discern release, and coding agent version. After a tooling change, it starts a new series.

Even well-matched runs leave things out. The logbook doesn't hold code, prompts, or command output. It can't tell you what the agent was building, or why a test failed. Your agent needs the project itself to find the cause.

Say the same code passes once and fails once. That's a reason to look at unstable checks or at the conditions they ran under. It doesn't say which one caused it, and it doesn't make either result safe to ignore.

### When a gain is ready to lock in

Say the recipe app's download got smaller, and you want to lock in the gain by tightening its [standard](standards.md). The gate, your project's full set of checks, already says whether a tighter limit is possible. The report adds whether the gain has held across several recent runs.

If the readings went back and forth, the report suggests looking into the variation instead of tightening the limit yet. Either way, you decide. [Set and raise standards](../10-guides/set-and-raise-standards.md) explains how to lock in a gain.

### Comparing coding agents without ranking them

When the logbook shows which coding agent drove enough runs, the report compares those groups, called **cohorts**. Each group's counts appear beside its total. Runs it can't match to an agent stay visible as a separate share.

A difference is a place to look. Say one agent keeps hitting a refusal that the others never see. It's worth checking the instruction file discern writes for that agent, such as `CLAUDE.md`. The difference doesn't show that agent is worse. Different agents may have had different work, and the logbook doesn't record what the tasks were.

When signals about an agent conflict, discern leaves those runs unattributed. The report never grades agents or people, and knowing which agent ran a command never changes how discern treats its work.

## From a finding to one change

Use the findings to pick one improvement: make an instruction clearer, adjust a check, or aim a checkpoint better. `discern improvement` is another starting point. It checks your setup against the practices discern recommends and suggests one next step. `discern patterns` adds the history of how the setup has worked in practice.

[Improve how your agents work](../10-guides/improve-the-practice.md) takes one improvement from investigation to review. Later runs show whether it worked, and the earlier history stays in the record for comparison.

[What stays on your machine](local-control.md) explains where the logbook lives and what it leaves out. [The logbook reference](../30-reference/logbook.md) lists every field and statistic, and how to turn recording off, seal, or delete the history.
