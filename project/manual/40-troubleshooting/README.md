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

When a test fails or a command stops, hand the result to your agent. discern's results say what's true now and what to do next, so your agent can find the cause and recover by itself. These pages show which decisions stay yours.

> "Explain this result, fix what you can, and bring me any decision that changes what we agreed to build or check."

## Find the symptom

| What you see                                                                   | Where to go                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Setup stopped, or a coding tool can't reach discern.                           | [Setup and integrations](setup-and-integrations.md)                        |
| A build, test, or other project check failed.                                  | [Fix a red gate](../20-guides/fix-a-red-gate.md)                           |
| The gate won't run, or passes without Proof you can use.                       | [Gate and Proof](gate-and-proof.md)                                        |
| A standard or checkpoint needs attention.                                      | [Gate and Proof](gate-and-proof.md)                                        |
| A task's workspace, resources, or cleanup look wrong.                          | [Worktrees and resources](worktrees-and-resources.md)                      |
| A session ended before the task finished.                                      | [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md) |
| discern's tools disappeared, a call or wait ended early, or a page won't open. | [MCP, terminal, and docs](mcp-terminal-and-docs.md)                        |
| discern crashed, or you found local files you don't recognize.                 | [Crashes and local state](crashes-and-local-state.md)                      |
| You want to upgrade or remove discern.                                         | [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md)   |

## Help your agent find the cause

Keep the original result. It names the failing command, where the full output is, and how to reproduce the problem, so your agent starts there instead of rerunning everything. For an install problem, your agent runs `discern doctor`, which checks the installation and changes nothing.

Recovery is done when the tool connects, the command finishes, or the repaired change has fresh [Proof](../10-understand/proof.md), discern's record of which commands passed on its exact commit.

## When the next step needs you

Loosening a limit or removing a check changes what later work must meet, so it's your decision. So is landing despite an unmet review question, and so is cleanup that throws work away. Ask your agent for the evidence, the options, and its recommendation.

If a page's recovery still fails, keep the result as evidence and [report the problem](crashes-and-local-state.md#report-it).
