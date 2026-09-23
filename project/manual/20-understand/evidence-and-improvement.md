---
id: explanation-evidence-and-improvement
title: "Learn from your project's history"
description: "Use local findings to understand recurring friction, distinguish observations from explanations, and choose a useful next investigation."
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

The checks feel slower this week. A task needed several attempts before it finished. You wonder whether something in the way the project works could improve, but one memorable task is a weak basis for changing the process.

discern keeps a local activity record, the **logbook**, that can help your agent investigate. Its pattern report turns recorded outcomes and timings into findings with counts and suggested next steps. You can use those findings to decide where to look, without treating a hunch as an established cause.

## Start with a question you recognize

Suppose your agent spends a long time waiting for the final checks on a small change. You might ask:

> Look at the local evidence for our checks. Is this run unusual, or is there a repeated source of avoidable time worth investigating?

The pattern report can show where time went across recorded runs. If tests take most of it, that is an observation. The tests may be essential and already efficient. A recommendation to change them needs more evidence about avoidable cost, such as unnecessary repeated work.

Your agent then inspects the relevant commands or diagnostic output. The report helps choose that investigation; it does not know from a duration alone whether a test should exist.

## What a finding is

A finding states the condition observed, the evidence supporting it, and a next step. Counts include the population they came from: three failures among four comparable attempts means something different from three among four hundred.

The report also distinguishes measured values from estimates and identifies limits on the evidence. If an interrupted run's full duration is estimated, that estimate is labeled and comes with the sample used to derive it.

Each detector needs enough qualifying evidence before reporting a pattern. **Insufficient evidence** means the record cannot support the conclusion yet. It does not mean the problem is absent. A new project may have little to report, and that is a useful answer too.

Findings are **advisory**: reading them does not change configuration, fail the gate, or grant permission to make a change.

## What the detectors watch

The report groups its observations around several questions:

- **Are measured improvements lasting?** A standard's trajectory shows its recorded values alongside its limits over time.
- **Do the checks fit the work?** Findings can identify where gate time goes, waits for shared test capacity, and different results under comparable recorded conditions. They can also flag review questions that rarely fire or repeatedly need exceptions.
- **Where does work get stuck?** The record can show repeated failed runs or refusals and whether their suggested next actions were followed.
- **How do tasks move toward landing?** When the necessary events are recorded, the report can follow tasks from start through completion and acceptance, including update and integration, and suggest configuration improvements to remove friction and optimize performance.

Your agent reads this with `discern patterns`. The `--stats` view also shows recorded accomplishments, such as accepted changes, completion streaks, cycle times, and standard trends.

## Findings can join into investigations

Several observations may point toward the same question. Repeated failed runs and evidence of how the agent responded, for example, can support an investigation of the feedback loop.

When the evidence is compatible, discern can present the related findings together with a suggested investigation and what would disprove that interpretation. The original findings remain available. Missing or conflicting evidence prevents the connection from being presented as supported.

This keeps the next task specific. The agent has a question to investigate and a way to challenge its first explanation, rather than an invitation to rewrite the process broadly.

## Where comparison stops

A comparison is useful only when you know what changed between the things being compared. discern groups trends by compatible recorded setup, including configuration, discern release, and client version. A tooling change starts a separate series.

Even matched records leave things unknown. The logbook excludes code, prompts, and command output. It cannot tell you what the agent was trying to implement or why a test failed merely from the run's metadata. Your agent needs the relevant project evidence to investigate the cause.

This matters when a recorded version passes once and fails another time. The difference can justify investigating unstable checks or execution conditions. It does not establish which condition caused it or make either result safe to ignore.

### Standard trajectory decisions

Suppose you reduced the amount someone downloads to open the app. You want to preserve the improvement as a tighter [standard](standards.md), a measured limit held by the gate.

The gate records whether that measured gain is eligible to be captured. The pattern report also considers whether the gain held across recent comparable readings. If those readings reverse or fail, it points toward investigating the variation rather than recommending an immediate pin.

A recommendation combines a gain the gate can recognize with history supporting its durability. You still decide whether to capture it. [Set and raise standards](../10-guides/set-and-raise-standards.md) explains that action.

### Cohorts without rankings

When the record supports identifying which coding tools drove enough runs, the report can compare those groups, called **cohorts**. Each group's counts appear with its population, and runs whose driver could not be identified stay visible as an unattributed remainder.

A difference is a place to investigate. If one provider repeatedly encounters an instruction-related refusal, checking its generated instructions and activation may be useful. That does not establish that the provider is worse: different agents may have been given different work, and the record does not contain those task details.

Conflicting identity signals remain unresolved. Identifying a provider does not change how discern treats its work, and the report does not grade agents or people.

## From evidence to one bounded change

You and your agent can use the findings to choose one improvement: clarify an instruction, adjust a check, or make a review question more relevant. `discern improvement` provides another starting point by examining the configured practice and recommending a next action; `discern patterns` adds the history of how it has been used.

[Improve how your agents work](../10-guides/improve-the-practice.md) takes that choice through investigation, implementation, and review. Later comparable evidence can help you assess whether it worked. The original history remains available rather than disappearing when you change a setting.

[What stays on your machine](local-control.md) explains where the records live and what they exclude. [The logbook reference](../30-reference/logbook.md) holds exact fields, statistics, and the choices for recording, sealing, and removing history.
