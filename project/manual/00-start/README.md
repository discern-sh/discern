---
id: start-index
title: "Start"
description: "Choose between evaluation, first success, and understanding the installed result."
order: 0
publish: true
kind: tutorial
aliases:
  - "start-index"
  - "Getting started"
  - "setup"
redirect_from:
  - "/docs/getting-started"
---

# Start

Choose between evaluation, first success, and understanding the installed result.

## In this section

- [Evaluate discern](evaluate-discern.md): Decide whether discern's practice, local boundary, and authority model fit the project before installation.
- [First success](first-success.md): Move one representative project from installation through setup, an isolated change, Gate evidence, review, and authorized landing.
- [After setup](after-setup.md): Recognize what setup authored, shares, generates, and keeps outside the repository.

## Getting started

_Install discern, set up your repository, and take one real change through the project's final quality check (the Gate)._

You need a Git repository, a supported coding agent, and macOS, Linux, or WSL2. discern is a self-contained binary. The project does not need Deno or Node to run discern.

Start with the [quickstart](first-success.md). It is the shortest path from installation to a reviewed change on your trunk. [Setup decisions](first-success.md) explains why the model choice matters and which later choices remain yours. The [walkthrough](first-success.md) then explains the branch, Gate, Proof, and review boundaries you encounter while an agent works.

When you already know the outcome you need, open [Tasks by lifecycle](../10-guides/README.md). It routes installation, worktree, Gate, instructions, Skill, Standard, and handoff tasks to the page that owns each procedure.

Setup leaves ordinary files on a branch for you to inspect. [What setup added](after-setup.md) explains that diff and names what you edit, what discern shares with you, and what it regenerates. If a command or agent integration fails, go to the [FAQ](../40-troubleshooting/README.md), which starts with the diagnostic command.

When you return for a later release, follow [Upgrade discern](../10-guides/maintain-or-remove-discern.md). Updating the binary and updating the project are separate actions, and the guide keeps them in the right order.

| Read next                                                       | What it helps you do                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Tasks by lifecycle](../10-guides/README.md)                    | Jump from an intended outcome to the page that owns its procedure.                      |
| [Quickstart](first-success.md)                                  | Install, complete setup, and land your first gated change.                              |
| [Setup decisions](first-success.md)                             | Choose the setup model and recognize the decisions that need your judgment.             |
| [Walkthrough](first-success.md)                                 | Follow the same flow with each handoff and verification explained.                      |
| [What setup added](after-setup.md)                              | Read the setup diff and know which files to edit.                                       |
| [FAQ and troubleshooting](../40-troubleshooting/README.md)      | Diagnose setup, command, Model Context Protocol (MCP), platform, and worktree problems. |
| [Upgrade discern](../10-guides/maintain-or-remove-discern.md)   | Update the binary, migrate the project, and verify the result.                          |
| [Files & ownership](../30-reference/files-and-ownership.md)     | Look up the complete write surface and removal behavior.                                |
| [`discern.toml` reference](../30-reference/config-reference.md) | Look up every configuration key, type, and default.                                     |
