---
title: Tasks by lifecycle
description: Find the manual page for installing, working, checking, handing off, and maintaining discern.
order: 10
aliases:
  - task index
  - find a task
  - what do I do
  - workflow tasks
---

# Find the discern task you need

_Start with the outcome you want, then follow the link to the page that owns it._

This index follows the lifecycle of a change: get discern running, do the work in isolation, check the result, and hand the finished branch back. Each task links to the manual page that carries the full procedure, including commands, preconditions, and recovery paths.

If this is your first visit, the [quickstart](quickstart.md) remains the shortest complete route from installation to a landed change. Use this page when you already know the outcome and want its instructions without learning the manual's subsystem names first.

## Starting work

Begin here when discern is not installed yet, the repository has not completed setup, or a new change needs its own checkout.

| I want to…                   | Go here                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Install the discern binary   | [Install the binary](quickstart.md#1-install-the-binary), then follow the printed `Next:` instruction.                                    |
| Add discern to a project     | [Ask your agent to run setup](quickstart.md#2-ask-your-agent-to-set-the-project-up) and review the scaffold on its setup branch.          |
| Troubleshoot an installation | [Start with `discern doctor`](faq.md#start-with-discern-doctor), then match the reported symptom to its fix.                              |
| Work in an isolated worktree | [Start an isolated checkout](../30-worktrees/lifecycle.md#start-an-isolated-checkout) from the main checkout and enter the returned path. |

## Doing work

Keep the change current and put durable project knowledge in the surface that future agent sessions load.

| I want to…                    | Go here                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update my branch from trunk   | [Bring the trunk into the branch](../30-worktrees/lifecycle.md#bring-the-trunk-into-the-branch), review the incoming overlap, and rerun the gate.    |
| Add project guidance          | [Write project guidance](../40-agent-guidance/write-project-guidance.md) in the configured source, then run `discern refresh`.                       |
| Record a significant decision | Ask your agent to use [`discern-write-adr`](../45-skills/bundled-skills.md#the-bundled-catalog), which applies the project's decision-record format. |
| Author a reusable Skill       | [Author a project Skill](../45-skills/author-a-skill.md), give it a trigger-rich description, and materialize it with `discern refresh`.             |

## Checking work

Use the fast loop while editing. Run the full gate on the intended final commit.

| I want to…                       | Go here                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the gate                     | [Use `discern done`](../20-quality-gate/) on a clean final commit and read the returned result.                                                    |
| Fix a failed check               | [Start with the first diagnostic](../20-quality-gate/when-the-gate-fails.md), run its `reproduce_cmd`, and return to `discern done` after the fix. |
| Understand or tighten a standard | [Read Standards](../20-quality-gate/standards.md), choose a metric that survives growth, and capture a gain with `discern standards --pin`.        |

## Handing off work

A green gate begins review. The owner still decides whether the branch lands.

| I want to…                | Go here                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand work back for review | [Report the branch and its receipt](../30-worktrees/hand-work-back.md), wait for the owner's decision, then accept only with their authorization. |
