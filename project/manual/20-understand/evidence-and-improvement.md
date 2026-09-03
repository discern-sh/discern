---
id: explanation-evidence-and-improvement
title: "Evidence and improvement"
description: "Understand what local patterns and validation findings can support, and where comparison stops short of causation or ranking."
order: 90
publish: true
kind: explanation
aliases:
  - "explanation-evidence-and-improvement"
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

# Evidence and improvement

Some project problems only ever arrive as anecdotes. The tests feel flaky. The Gate seems slower than it used to be. One agent keeps re-running checks without progress. Anecdotes are hard to act on: they carry no counts, no baseline, and no way to tell a real pattern from a memorable Tuesday.

With the practice running, the project accumulates its own evidence about how work moves. The [Logbook](local-control.md) records one metadata line per run, and `discern patterns` reads that record with a set of named detectors, reporting recurring conditions as plain counts with the evidence behind them and a recommended next step. The report is advisory: it informs and never blocks. The Gate and Standards remain the only enforcement, so reading the evidence can't change a verdict.

## What a finding is

Every finding has a plain-language summary of the condition and, beneath it, the observed evidence: the object and conditions it covers, the count beside its denominator, a label wherever a value is an estimate rather than a measurement, and any limitation that matters. A finding states what was observed; it doesn't assert a cause the record can't support.

Detectors also know when to stay quiet. Each declares an evidence threshold, and below it the report says there is insufficient evidence rather than extrapolating. A short Logbook produces a short report, and an empty one is a normal, named state.

## What the detectors watch

Each detector reads the event stream for one kind of recurring evidence. The families give a sense of the coverage:

- **Trajectory:** each Standard's measured value over time, beside the history of its limit.
- **Gate fit:** where Gate time goes and whether the setup still fits the work — a job dominating the run, queueing for shared test-run slots, verdicts that diverge on matched conditions, and checkpoint hygiene: a question that never fires, fires on nearly every change, or lands mostly under variances.
- **Workflow behavior:** streaks of red runs, repeated refusals of one kind, edits made directly on the trunk, and whether the advice discern gave was followed.
- **The task funnel:** red runs before the first green, time from start to acceptance, and update friction trending up.

`discern patterns --stats` reads the same record for what went well: accepted changes, green streaks, cycle times, Standards trends, and per-checkpoint economics, presented as plain counts you can share.

## Findings can join into investigations

When compatible findings point toward one workflow problem, the report joins them into a bounded investigation: what the combined evidence may mean, the preferred diagnostic action, and what would disprove that reading. The original findings stay visible underneath, and missing or conflicting evidence prevents the relationship from forming at all. An investigation proposes what to check next. It doesn't claim the cause, rank anything, or change the project.

## Where comparison stops

The report's usefulness depends on what it refuses to conclude:

- **Observation before recommendation.** A percentage is a statistic, and a statistic alone doesn't produce advice. A job dominating Gate time yields an optimization suggestion only when local history also records avoidable cost, such as a check running outside its scope or repeated runs on an unchanged state. A necessary test can dominate the Gate and remain unremarked.
- **Estimates say so.** A value that can only be estimated, like the time a cancelled run would have taken, carries the label and the sample behind it.
- **Only comparable runs form a trend.** Trends compare runs sharing one setup: the same configuration epoch, discern release, and dominant client version. A tooling change starts a new series rather than masquerading as a workflow change.

### Standard trajectory decisions

The Gate itself records whether a Standard is mechanically eligible to pin and at what value; the report reads that authority rather than re-deriving it. A pin recommendation additionally needs the gain held across recent comparable readings with no reversal. When eligibility coincides with recent reversals or failures, the report offers an investigation instead of pin advice: check whether the headroom is durable before capturing it. Pinning remains your action, through [Standards](standards.md).

### Cohorts without rankings

Where enough attributed evidence exists, a finding can split by driver cohort, meaning which coding agent drove the runs, with each population's counts beside its denominator and the unattributed remainder always stated. The report never ranks agents. Task mixes differ by cohort, so the same numbers can describe different work; cohorts may be compared, and agents are not graded. What a split buys you is direction: if one provider's sessions keep hitting a refusal its peers never see, the next thing to check is that provider's compiled instruction file, and a gap every cohort hits is a shared fix.

Identity itself is treated as evidence, with the same restraint. Signals can mark a run as agent-driven, corroboration strengthens a reading, and disagreement voids it. No detected identity changes behavior on its own.

## From evidence to one bounded change

Findings earn their keep when they become decisions. [Improve the practice](../10-guides/improve-the-practice.md) is that loop: read the report, choose one bounded change (an instruction line, a configuration value, a reworded [checkpoint](checkpoints.md) question, a new Standard), and let later evidence show whether it helped. `discern improvement` ranks the most valuable next action across the setup when you want a starting point.

[The Logbook](../30-reference/logbook.md) reference lists every recorded field, the stats definitions, and the archive and reset lifecycle. What the record contains and why it stays local is covered in [Local control](local-control.md).
