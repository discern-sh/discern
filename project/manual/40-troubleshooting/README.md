---
id: troubleshooting-index
title: "Troubleshooting"
description: "Find what went wrong, protect unfinished work, and follow the next recovery step."
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

If a check fails or an operation stops, you can give your agent the result and ask it to investigate. discern's results describe the current state and the next action; these pages help you understand the recovery and recognize when a decision needs you.

> Work through this result and explain what needs attention. Continue the repair you can make within this task, and bring me any decision that would change what we agreed to build or check.

## Find the symptom

| What you're seeing                                             | Where to go                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Setup stopped, or a coding tool cannot connect.                | [Setup and integrations](setup-and-integrations.md)                        |
| A build, test, or other project check failed.                  | [Fix a red gate](../10-guides/fix-a-red-gate.md)                           |
| The gate refuses to run, or it passes without usable Proof.    | [Gate and Proof](gate-and-proof.md)                                        |
| A standard or checkpoint needs attention.                      | [Gate and Proof](gate-and-proof.md)                                        |
| A task's workspace, resources, or cleanup look wrong.          | [Worktrees and resources](worktrees-and-resources.md)                      |
| A session ended before the task finished.                      | [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) |
| Tools disappeared, a long wait ended, or a page will not open. | [MCP, terminal, and docs](mcp-terminal-and-docs.md)                        |
| discern crashed, or you found local files you don't recognize. | [Crashes and local state](crashes-and-local-state.md)                      |
| You want to upgrade or remove discern.                         | [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md)   |

## Help your agent find the cause

Keep the original result available. It can contain the failing command, the location of captured output, and a way to reproduce the problem. That evidence gives your agent a starting point without repeating the entire operation.

If the session has lost track of the task, ask the agent to inspect `discern status` in the task's existing workspace. Status is read-only and reports what is true now. For an installation problem, `discern doctor` checks the configuration, commands, and agent connections without changing them.

The agent should explain what the evidence establishes and what remains uncertain. A successful recovery is something you can recognize: the tool connects, the operation completes, or the repaired change returns with fresh [Proof](../20-understand/proof.md).

## When the next step needs you

A repair may reveal a choice about the project. For example, a feature may exceed a size limit you want to preserve, or an agent may find that a review question cannot be satisfied by the current change. Ask it to show the evidence, the available options, and its recommendation before you decide.

Removing a check or weakening a limit changes what future work must satisfy. It needs a decision about the practice, rather than being treated as an ordinary way to clear a failure. Cleanup also deserves care when it would discard work; use the operation's preview and recovery instructions to understand what will remain.

If the documented recovery still fails, keep the result and [report the problem](crashes-and-local-state.md#discern-crashed). It is useful evidence for finding the cause.
