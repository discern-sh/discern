---
id: troubleshooting-index
title: "Troubleshooting"
description: "Find the page for what went wrong, keep unfinished work safe, and take the next step to recover."
order: 0
publish: true
kind: troubleshooting
aliases:
  - "troubleshooting-index"
  - "FAQ and troubleshooting"
  - "faq"
  - "setup problems"
  - "doctor"
  - "something went wrong"
  - "error recovery"
---

# Troubleshooting

When a test fails or a command stops, hand the result to your agent. discern's results say what's true now and what to do next, so your agent can work out the cause and carry out the recovery itself. These pages help you follow along and recognize the moments that need your decision.

> "Work through this result and explain what needs attention. Fix what you can in this task, and bring me any decision that would change what we agreed to build or check."

## Find the symptom

| What you're seeing                                                    | Where to go                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Setup stopped, or a coding tool can't connect to discern.             | [Setup and integrations](setup-and-integrations.md)                        |
| A build, a test, or another project check failed.                     | [Fix a red gate](../20-guides/fix-a-red-gate.md)                           |
| The gate won't run, or it passes but gives no Proof you can use.      | [Gate and Proof](gate-and-proof.md)                                        |
| A standard or a checkpoint needs attention.                           | [Gate and Proof](gate-and-proof.md)                                        |
| A task's workspace, its resources, or its cleanup look wrong.         | [Worktrees and resources](worktrees-and-resources.md)                      |
| A session ended before the task finished.                             | [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md) |
| discern's tools disappeared, a long wait ended, or a page won't open. | [MCP, terminal, and docs](mcp-terminal-and-docs.md)                        |
| discern crashed, or you found local files you don't recognize.        | [Crashes and local state](crashes-and-local-state.md)                      |
| You want to upgrade or remove discern.                                | [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md)   |

## Help your agent find the cause

Keep the original result: it names the failing command, where to find the full output, and how to reproduce the problem, so your agent can start there instead of running everything again.

If a session loses track of a long run, your agent reads its result back with `discern progress` instead of starting over. If a new session loses track of a task, your agent runs `discern status` in the task's worktree, its existing copy of the project. Status only reads, and it reports what's true now. For an install problem, your agent runs `discern doctor`, which checks your settings, commands, and agent connections and changes nothing.

Your agent should explain what the evidence shows and what's still uncertain. You'll know the recovery worked when the tool connects, the command finishes, or the repaired change comes back with fresh [Proof](../10-understand/proof.md), discern's record of which commands passed on its exact commit.

## When the next step needs you

A repair can turn up a choice about your project: a feature might push past a size limit you want to keep, or your agent might find that the change can't meet one of your project's review questions. Ask it to show you the evidence, the options, and its recommendation before you decide.

Removing a check or loosening a limit changes what all later work must meet, so that decision is yours. Take care, too, with cleanup that would throw work away: the preview and recovery steps in the result show what will remain.

If the recovery a page describes still fails, keep the result and [report the problem](crashes-and-local-state.md#report-it), because it's the evidence for finding the cause.
