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

Find the change to your project's setup that would help your agents most, based on what happened in past tasks. You fix real friction, such as a slow test run or a refusal that keeps coming back, instead of guessing, so less of your time goes to unblocking agents and more of their effort goes into the work you asked for.

discern keeps a local record of its own use, called the **logbook**, and reads it to suggest where to look. Its reports only advise: they don't change your settings or approve anything.

## Before you start

Use this guide when the project is set up and you have time to improve how it works. For something failing right now, start with [Troubleshooting](../40-troubleshooting/README.md).

The logbook lives inside your repository's `.git` folder, on your machine. It records timings, outcomes, and names, with no code or command output. A new project has little history yet, and so does one that has turned recording off.

Your agent can read these reports from your main checkout. It needs a **worktree**, a separate copy of the project for one task, only once it starts making changes.

## Ask where to improve

Say finishing small changes has started to take longer, and you want to know why before you change anything. Ask your agent:

> "Finishing small changes takes longer than it used to. Find out why, and suggest one improvement the evidence supports. Explain why it's worth doing and how we'd tell whether it helped."

The agent starts with `discern improvement`, which scores the project's setup on a set of health checks covering instructions, tests and linters, documentation, and more. It also lists questions for you and the agent to judge separately, outside the score, and names one next action.

Ask what a finding means in practice. "The instructions need attention" should become what's missing, which tasks it affects, and what fixing it would change, because a low score alone isn't a reason to add more rules.

## Look at what happened

For a problem that repeats, the agent reads the history with `discern patterns`, the pattern report. It shows where the time goes when your agent runs the **gate**, your project's own commands, such as its linter and tests, which a change must pass before it counts as finished. It also shows which refusals keep coming back, and how a standard's measurement has moved. Every finding comes with its counts and the runs they came from. For your slower changes, the report might say:

```text
- One job used most gate time with avoidable-cost evidence.
- Observed: `test` averages 184s per `done` — 71% of all recorded gate time across 12 of 15 considered runs. 5 of 12 comparable gates repeated one complete validation state.
```

The tests take most of the gate's time, but that alone doesn't make them wasteful, because they may be doing necessary work. The second sentence is the lead: on 5 of those runs, the tests ran again on code that hadn't changed. So the agent looks at time like that, which could be avoided, and reads the commands involved before recommending anything.

When a report says **insufficient evidence**, there aren't enough comparable runs to know the cause. You can leave things as they are or ask for a small investigation, with no need to invent an improvement.

`discern patterns --stats` adds totals such as cycle times and standards trends. Where it splits counts by coding tool, it never ranks them. [Learn from your project's history](../10-understand/evidence-and-improvement.md) explains how to read the findings, and the [logbook reference](../30-reference/logbook.md) covers what gets recorded.

## Follow the finding into the work

The logbook points to a problem, but it doesn't hold the code or output that explains it, so the agent follows the finding into the configuration, instructions, source code, or the command's own output.

discern also notices files that usually change together, from your Git history. By default, when `discern prepare` or `discern done` passes, it names any usual partner the change left out, such as the test for an edited file. To look at one file's partners, the agent runs `discern coupling` with that file's path. History shows where to look, and the task decides what needs to change.

## Choose one improvement

Ask for a proposal you can judge:

> "Show me the proposed change, the evidence behind it, and what we'll compare afterwards. Explain any tradeoff before changing a standing rule or check."

Pick the home that matches the problem:

| What the evidence shows                                              | A change that fits                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| New sessions miss an important rule                                  | Update the [project instructions](write-project-instructions.md).   |
| A method for a kind of task needs clearer steps                      | Improve a [skill](create-and-manage-skills.md).                     |
| The map describes the wrong behavior                                 | Correct the [map page](maintain-project-map.md) from the code.      |
| A measured gain is worth keeping                                     | Set or tighten a [standard](set-and-raise-standards.md).            |
| A review question is missing or fires in the wrong place             | Add or tune a [checkpoint](place-and-answer-checkpoints.md).        |
| A test or other gate command is missing, misleading, or wasting time | Fix its command or configuration, and confirm what it still covers. |

For the repeated test runs, the last row fits: the agent might propose caching the tests' work, or running them only when the files they cover change, and show that they still cover the same code. You can also decide the evidence is too weak, or the change costs too much. A recommendation never loosens a standard, adds a blocking rule, or lands a change on its own, because those stay your decisions.

## Try it and review it

Your agent makes the change in its worktree, then checks the behavior that should improve: for a skill, a real request; for an instruction, a new session; for a new test or lint rule, one example that passes and one that fails.

It commits the change, runs the gate, and brings it back with **Proof**, discern's record of which commands passed on exactly which commit. Review whether the change solves the original problem at a fair cost. [Finish and land a change](finish-and-land-a-change.md) covers landing.

After it lands, ask the agent to look at the original concern again. Some improvements show at once, such as a rule that's now in every session. Others need more tasks before the history can show a difference: the logbook keeps old runs, so an old finding may take a while to fade, and some comparisons start fresh after a configuration change.

## When it's done

A review is done when it ends in one of these:

- a recommendation backed by evidence, which you accept or decline;
- a clear reason why the evidence doesn't justify a change yet.

A change you accept is done when it has passed the gate and landed, and the agent has said what improved or which later tasks will show it. Each improvement you keep makes every later task start from a better setup.
