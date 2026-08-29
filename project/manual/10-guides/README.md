---
id: guide-index
title: "Guides"
description: "Find the procedure that matches the outcome and current state."
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
redirect_from:
  - "/docs/getting-started/tasks"
  - "/docs/quality-gate"
  - "/docs/worktrees"
  - "/docs/agent-instructions"
  - "/docs/skills"
---

# Guides

Start with what you need to accomplish and the state you have now. Each guide carries one outcome from named prerequisites to observable completion, including the decisions that still belong to the person responsible.

If discern is not installed and set up yet, begin with the [quickstart](../00-start/first-success.md). Use Understand for concepts and tradeoffs, Reference for complete contracts, and Troubleshooting when you already have a symptom.

## Choose the outcome

| Current situation | Outcome and guide |
| --- | --- |
| One worktree change must be prepared, reviewed, authorized, and landed. | [Finish and land a change](finish-and-land-a-change.md) |
| `discern prepare` or `discern done` returned a failure. | [Fix a red Gate](fix-a-red-gate.md) |
| A deterministic quality number must stop regressing, or an existing limit fired. | [Set and raise Standards](set-and-raise-standards.md) |
| A narrow change needs a recurring judgment, or a fired question needs an answer. | [Place and answer Checkpoints](place-and-answer-checkpoints.md) |
| Several worktrees must run, update, share capacity, or compose safely. | [Coordinate parallel tasks](coordinate-parallel-tasks.md) |
| One task must pause for a sibling branch or the trunk. | [Wait for another task](wait-for-another-task.md) |
| A session, acceptance, setup step, or dropped branch needs recovery. | [Recover an interrupted task](recover-an-interrupted-task.md) |
| A substantial objective needs one or more self-contained agent briefs. | [Delegate substantial work](delegate-work.md) |
| Every future coding-agent session must inherit a project rule. | [Write project instructions](write-project-instructions.md) |
| A recurring method should become a reusable agent playbook. | [Create and manage Skills](create-and-manage-skills.md) |
| A supported coding agent must be wired or its local action is missing. | [Connect a coding agent](connect-a-coding-agent.md) |
| The project's declared Gate should run as a required remote check. | [Run the Gate in CI](run-the-gate-in-ci.md) |
| Local evidence should identify the next bounded practice improvement. | [Improve the practice](improve-the-practice.md) |
| The install needs diagnosis, formatting, upgrade, or removal. | [Maintain or remove discern](maintain-or-remove-discern.md) |

## What every guide makes visible

Each procedure names:

- the person, coding agent, or discern as the actor for each consequential step;
- the repository state required before the first action;
- the result or evidence expected at decision points;
- the refusal route and the next safe action;
- the completion condition and one useful destination afterward.

When a discern command returns a next-action hint, follow that result. The guide explains the decision boundary; the live result knows the current branch, commit, config, and recovery state.

## Shared boundaries

- A green Gate is evidence about one clean commit. It does not move the trunk or grant authority.
- Any later edit or commit makes that Proof stale. Run the full Gate again on the new final tree.
- A checkpoint conclusion is the coding agent's declared judgment. Only the person can authorize a variance for a declared-unmet conclusion.
- Standing and one-worktree grants remain bounded by final changed paths. They do not cover checkpoint variances or Standard limit proposals.
- Generated files are outputs. Change their authored source and run the owning refresh or generator.
- Another task's worktree remains occupied even when it is clean.

For the reasoning behind these boundaries, read [The practice and its roles](../20-understand/practice-and-roles.md). For complete command and config contracts, use [Reference](../30-reference/README.md). For a result that already failed or refused, start with [Troubleshooting](../40-troubleshooting/README.md).
