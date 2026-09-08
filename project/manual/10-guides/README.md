---
id: guide-index
title: "Guides"
description: "Ask for work, review results, and keep your project improving."
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

Start with something you want to accomplish. Each guide gives you a useful request for your agent, explains what happens next, and helps you recognize the result. You can use your own words; the examples show how to make your intent clear.

If discern is new to the project, begin with [installation and setup](../00-start/first-success.md).

## Make and review changes

- [Finish and land a change](finish-and-land-a-change.md): take a request through implementation and checks, review the outcome, and decide whether to add it to the shared project.
- [Fix a red gate](fix-a-red-gate.md): understand a failed check and let your agent work through the cause.
- [Recover an interrupted task](recover-an-interrupted-task.md): continue work after a session ends or an operation stops partway through.

## Give your agents more work

- [Delegate substantial work](delegate-work.md): turn a larger goal into tasks with clear results and responsibilities.
- [Coordinate parallel tasks](coordinate-parallel-tasks.md): keep several tasks moving in separate workspaces.
- [Wait for another task](wait-for-another-task.md): let one agent receive another's work without making you carry progress messages between them.

## Keep what the project learns

- [Write project instructions](write-project-instructions.md): make a rule available to future sessions and supported coding tools.
- [Create and manage skills](create-and-manage-skills.md): use the bundled playbooks and capture procedures worth repeating.
- [Set and raise standards](set-and-raise-standards.md): preserve a measured improvement as a limit future changes must meet.
- [Place and answer checkpoints](place-and-answer-checkpoints.md): have an agent consider a review question when a relevant change occurs.
- [Improve the practice](improve-the-practice.md): use the project's recorded experience to choose what to improve next.

## Look after the setup

- [Connect a coding agent](connect-a-coding-agent.md): add another supported coding tool and confirm that it can use discern.
- [Run the gate in CI](run-the-gate-in-ci.md): run the project's checks in continuous integration, where shared changes are checked remotely.
- [Maintain or remove discern](maintain-or-remove-discern.md): diagnose the installation, upgrade it, or remove its wiring while keeping your authored work.

## When you need more context

The guides explain the flow; a command's returned result identifies the next action for the project as it stands now. If something differs from the example, ask your agent to explain that result and follow its recovery instructions.

[Understand](../20-understand/README.md) explains the concepts behind the work. [Reference](../30-reference/README.md) supplies exact command and setting details. [Troubleshooting](../40-troubleshooting/README.md) starts from symptoms you can recognize.
