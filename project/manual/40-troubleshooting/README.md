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

When a check fails or a command stops, give the result to your agent. Ask it to find the cause. discern's results say what's true now and what to do next. These pages help you follow the recovery, and see when a decision needs you.

> Work through this result and explain what needs attention. Fix what you can in this task. Bring me any decision that would change what we agreed to build or check.

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

Keep the original result. It can name the failing command, where to find the full output, and how to reproduce the problem. That gives your agent a place to start without running everything again.

If a session loses track of a long check, your agent can read its result back with `discern progress` instead of starting over. If a session loses track of a task, ask your agent to run `discern status` in the task's worktree, its existing copy of the project. Status only reads, and it reports what's true now. For an install problem, ask for `discern doctor`. It checks your settings, commands, and agent connections, and changes nothing.

Your agent should explain what the evidence shows and what's still uncertain. You'll know the recovery worked when the tool connects, the command finishes, or the repaired change comes back with fresh [Proof](../10-understand/proof.md).

## When the next step needs you

A repair can turn up a choice about your project. A feature might push past a size limit you want to keep. Or your agent might find that the change can't meet one of your project's review questions. Ask it to show you the evidence, the options, and its recommendation before you decide.

Removing a check or loosening a limit changes what all later work must meet. That's your decision to make. Take care, too, with cleanup that would throw work away. Use the preview and recovery steps in the result to see what will remain.

If the recovery a page describes still fails, keep the result and [report the problem](crashes-and-local-state.md#discern-crashed). The result is useful evidence for finding the cause.
