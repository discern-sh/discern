---
id: guide-improve-the-practice
title: "Improve how your agents work"
description: "Use the project's local record to choose a useful improvement, test it, and see whether it helps later work."
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
---

# Improve how your agents work

Sometimes the work is moving, but the process keeps getting in the way. Checks take a long time, the same refusal returns, or agents need repeated reminders. You want to improve the way the project works without starting a broad cleanup on a hunch.

discern can inspect the configured practice and its local activity record, then suggest where to investigate. This guide helps you and your agent turn that evidence into one useful change. The reports advise; they do not change your settings or approve work on their own.

## Starting state

Use this guide when the project is set up and you have time to improve its working process. For an immediate failure, start with [Troubleshooting](../40-troubleshooting/README.md).

Your agent can review the shared project's state without creating a new worktree. It needs an effort's worktree when it begins making changes. Historical findings depend on the local logbook, so a new project or one with recording turned off may have little evidence yet.

## 1. Ask where an improvement would help

Give your agent a request:

> Review how this project is working with discern. Find one improvement supported by the available evidence, explain why it is worth doing, and propose how we would tell whether it helped.

Your agent uses discern's improvement tool, or `discern improvement --markdown`, to inspect the current setup. The report combines mechanical checks and review questions across the project's instructions, checks, documentation, and other parts of the practice. Its next action gives the agent a place to start.

Ask for the practical consequence. “The instructions need attention” should become an account of what is missing, which task it affects, and what a change would improve. A score alone is not a reason to add more rules.

If you already have a concern, include it: “Focus on why completing small changes has started taking longer.” The agent can narrow the review to the relevant part of the practice.

## 2. Look for supporting history

When the question concerns repeated behavior, your agent reads the local pattern report with `discern patterns`. It can show where check time goes, which refusals recur, or how a measured quality value has changed.

For example, suppose the tests take most of the gate's time. That fact alone does not make them wasteful. They may be doing necessary work. Your agent should look for a supported source of avoidable time, such as repeated runs under unchanged conditions, and inspect the relevant commands before recommending a change.

The report gives counts, the runs those counts came from, and limits on the comparison. If it says **insufficient evidence**, the cause remains unknown. You can leave the practice as it is or choose a small investigation; there is no need to invent an improvement to complete the review.

[Learn from your project's history](../20-understand/evidence-and-improvement.md) explains how to read these findings. [The logbook reference](../30-reference/logbook.md) covers recording choices and stored fields.

## 3. Inspect the related work

The local record can point to a problem, but it does not contain the code or command output that explains it. Your agent follows the finding into the configuration, instructions, source, or available diagnostic output.

If the question concerns files that may need to change together, the agent can also use `discern coupling`. This reads Git history to identify files that often changed together. Use the suggestions to decide which relationships need inspection.

For example, an implementation file and a test file may often change together. The agent should check whether the current change needs that test updated, and explain a material omission during review. History can help it remember where to look; the actual task determines what needs changing.

## 4. Choose one improvement

The proposal should name the evidence, the expected benefit, and the way to verify it. A useful request is:

> Show me the proposed change, the evidence behind it, and what we will compare afterwards. Explain any tradeoff before changing a standing rule or check.

Choose the home that matches the problem:

| What the investigation supports                                    | A possible change                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Future sessions lack an important rule                             | Update [project instructions](write-project-instructions.md).         |
| A recurring method needs clearer steps or decisions                | Improve a [skill](create-and-manage-skills.md).                       |
| The project guide describes the wrong behavior                     | Correct the relevant map page from the code.                          |
| A measured quality gain is worth keeping                           | Establish or tighten a [standard](set-and-raise-standards.md).        |
| A review question is missing or poorly targeted                    | Add or tune a [checkpoint](place-and-answer-checkpoints.md).          |
| A configured check is missing, misleading, or doing avoidable work | Adjust the owning command or configuration and verify what it checks. |

You may also decide the evidence is too weak or the improvement too costly. A recommendation does not authorize weakening a standard, adding a new blocking rule, or landing a change.

## 5. Try the change and review the result

Your agent implements the chosen improvement in its effort's worktree. It checks the behavior that should improve: a real request for a skill, a fresh session for instructions, or a passing and failing example for a new automated check.

It then prepares and commits the change, runs the full gate, and returns the result with Proof. Review whether the improvement addresses the original problem and whether its cost is reasonable. [Finish and land a change](finish-and-land-a-change.md) covers the landing decision.

After landing, the agent checks the original concern again. Some improvements are visible immediately, such as a previously missing instruction. Others need later work to supply enough comparable runs. Old history remains in the logbook, so a successful change does not necessarily make its original finding disappear at once.

## Completion

A useful review ends with a supported recommendation or a clear explanation of why the evidence does not justify a change. An implemented improvement should have passing checks and an account of what improved, or what later observation is still needed.
