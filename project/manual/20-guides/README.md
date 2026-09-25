---
id: guide-index
title: "Guides"
description: "Find the guide for what you want to get done, from landing a change to keeping what your project learns."
order: 0
publish: true
kind: guide
aliases:
  - "guide-index"
  - "Find the discern task you need"
  - "task index"
  - "find a task"
  - "what do I do"
  - "workflow tasks"
  - "The quality gate"
  - "quality gate"
  - "worktrees"
  - "isolated worktrees"
  - "parallel work"
  - "agent instructions"
  - "AGENTS.md"
  - "agent skills"
  - "playbooks"
  - "SKILL.md"
---

# Guides

Each guide starts from something you want to get done and follows it to a result you can recognize: what to ask your agent, what your agent does with the request, and how you'll know it worked or why it stopped. The example requests show what your agent needs to hear, which is your intent in your own words, so you don't need to learn discern's commands to direct it.

If discern is new to your project, start with [Install and set up discern](../00-start/installation-and-setup.md).

## Make and review changes

- [Finish and land a change](finish-and-land-a-change.md): review a finished change, and decide whether it joins your project.
- [Land an urgent repair](land-an-urgent-repair.md): land a fix now, and run its tests and other required commands straight afterwards.
- [Fix a red gate](fix-a-red-gate.md): find out which test or other required command failed, and have your agent fix the cause.
- [Recover an interrupted task](recover-an-interrupted-task.md): pick up after a session ends or a command stops partway.

## Give your agents more work

- [Delegate substantial work](delegate-work.md): turn a big goal into tasks with clear results and owners.
- [Coordinate parallel tasks](coordinate-parallel-tasks.md): keep several tasks moving at once, each in its own copy of the project.
- [Wait for another task](wait-for-another-task.md): let one agent pick up another's work without you passing messages.

## Keep what the project learns

- [Write project instructions](write-project-instructions.md): give every future session a rule to follow.
- [Maintain the project map](maintain-project-map.md): keep your project's guide to itself useful as it grows.
- [Create and manage skills](create-and-manage-skills.md): use discern's playbooks, and write your own for work that repeats.
- [Set and raise standards](set-and-raise-standards.md): turn a measured gain into a limit that later changes must meet.
- [Place and answer checkpoints](place-and-answer-checkpoints.md): have your agent answer a review question when a certain change happens.
- [Improve how your agents work](improve-the-practice.md): use your project's own history to choose what to improve next.

## Look after your setup

- [Connect a coding agent](connect-a-coding-agent.md): add another coding tool, and check that it can use discern.
- [Run the gate in CI](run-the-gate-in-ci.md): run your project's required tests and tools on your continuous integration server.
- [Maintain or remove discern](maintain-or-remove-discern.md): check, upgrade, or remove discern, and keep the work you wrote.

## When a result doesn't match the guide

A guide describes the usual path, and each result discern returns names the next step for your project as it stands at that moment. So when a result doesn't match a guide, go by the result: ask your agent to explain what it says happened and to follow its recovery steps.

[Understand](../10-understand/README.md) explains the ideas behind the guides, [Reference](../30-reference/README.md) has the exact commands and settings, and [Troubleshooting](../40-troubleshooting/README.md) starts from the symptoms you can see.
