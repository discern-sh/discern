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
---

# Improve how your agents work

Find the change to your project's setup that would help your agents most, based on what happened in past tasks. You fix real friction, such as slow checks or a refusal that keeps coming back, instead of guessing. Less of your time goes to unblocking agents, and more of their effort goes into the work you asked for.

discern keeps a local record of its own use, called the **logbook**, and reads it to suggest where to look. Its reports only advise. They don't change your settings or approve anything.

## Before you start

Use this guide when the project is set up and you have time to improve how it works. For something failing right now, start with [Troubleshooting](../40-troubleshooting/README.md).

The logbook lives inside your repository's `.git` folder, on your machine. It records timings, outcomes, and names, with no code or command output. A new project has little history yet, and so does one that has turned recording off.

Your agent can read these reports from your main checkout. It only needs a worktree, a separate copy of the project for one task, once it starts making changes.

## Ask where to improve

This guide follows one example: finishing small changes has started to take longer. Ask your agent:

> Review how this project is working with discern. Focus on why finishing small changes has started taking longer. Find one improvement the evidence supports, explain why it's worth doing, and say how we'd tell whether it helped.

The agent starts with `discern improvement`. It scores the project's setup on a set of health checks, covering instructions, checks, documentation, and more. It lists open questions for you and the agent to judge separately, outside the score. It then names one next action.

Ask what the finding means in practice. "The instructions need attention" should become what's missing, which tasks it affects, and what fixing it would change. A low score alone isn't a reason to add more rules.

## Look at what happened

For a problem that repeats, the agent reads the history with `discern patterns`. It shows where the gate's time goes, which refusals keep coming back, and how a standard's measurement has moved. The **gate** is the full set of checks your project requires.

Every finding comes with its counts and the runs they came from. When a report says **insufficient evidence**, there aren't enough comparable runs to know the cause. You can leave things as they are, or ask for a small investigation. There's no need to invent an improvement.

Say the tests take most of the gate's time. That alone doesn't make them wasteful, because they may be doing necessary work. The agent looks for time that could be avoided, such as a check that runs again when nothing it reads has changed. Then it reads the commands involved before recommending anything.

`discern patterns --stats` adds totals such as cycle times and standards trends. Where it splits counts by coding tool, it never ranks them. [Learn from your project's history](../20-understand/evidence-and-improvement.md) explains how to read the findings, and the [logbook reference](../30-reference/logbook.md) covers what gets recorded.

## Follow the finding into the work

The logbook points to a problem. It doesn't hold the code or output that explains it. So the agent follows the finding into the configuration, instructions, source code, or the check's own output.

discern also notices files that usually change together, from your Git history. By default, when `discern prepare` or `discern done` passes, it names any usual partner the change left out, such as the test for an edited file. To look at one file's partners, the agent runs `discern coupling` with that file's path. History shows where to look. The task decides what needs to change.

## Choose one improvement

Ask for a proposal you can judge:

> Show me the proposed change, the evidence behind it, and what we'll compare afterwards. Explain any tradeoff before changing a standing rule or check.

Pick the home that matches the problem:

| What the evidence shows                                  | A change that fits                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| New sessions miss an important rule                      | Update the [project instructions](write-project-instructions.md).     |
| A method for a kind of task needs clearer steps          | Improve a [skill](create-and-manage-skills.md).                       |
| The map describes the wrong behavior                     | Correct the [map page](maintain-project-map.md) from the code.        |
| A measured gain is worth keeping                         | Set or tighten a [standard](set-and-raise-standards.md).              |
| A review question is missing or fires in the wrong place | Add or tune a [checkpoint](place-and-answer-checkpoints.md).          |
| A check is missing, misleading, or wasting time          | Fix the check's command or configuration, and confirm what it checks. |

You can also decide the evidence is too weak, or the change costs too much. A recommendation never loosens a standard, adds a blocking rule, or lands a change on its own. Those stay your decisions.

## Try it and review it

Your agent makes the change in its worktree. Then it checks the behavior that should improve. For a skill, that means a real request. For an instruction, a new session. For a new check, one example that passes and one that fails.

It commits the change, runs the gate, and brings it back with **Proof**, discern's record of which checks passed on exactly which commit. Review whether the change solves the original problem at a fair cost. [Finish and land a change](finish-and-land-a-change.md) covers landing.

After it lands, ask the agent to look at the original concern again. Some improvements show at once, such as a rule that's now in every session. Others need more tasks before the history can show a difference. The logbook keeps old runs, so an old finding may take a while to fade. Some comparisons start fresh after a configuration change.

## When it's done

A review is done when it ends in one of these:

- a recommendation backed by evidence, which you accept or decline;
- a clear reason why the evidence doesn't justify a change yet.

A change you accept is done when it has passed the gate and landed, and the agent has said what improved or which later tasks will show it. Each improvement you keep makes every later task start from a better setup.
