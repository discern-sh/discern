---
id: reference-index
title: "Reference"
description: "Look up the exact details of discern's commands, settings, supported tools, files, and results."
order: 0
publish: true
kind: reference
aliases:
  - "reference-index"
  - "command reference"
  - "configuration reference"
  - "MCP reference"
  - "supported platforms"
---

# Reference

Use these pages when you need an exact answer about a command, a setting, a file, or a result. They hold the complete details, so the guides can stay focused on getting work done.

If you know what you want to do but not which command does it, start with the [guides](../20-guides/README.md).

- [Glossary](glossary.md): find a plain definition of a discern term.

## Commands and settings

| Look up                                                                | Reference                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| A command, an option, an exit code, or a key in the terminal reader.   | [CLI reference](cli-reference.md)                 |
| A setting in `discern.toml`, the values it takes, or its default.      | [Config reference](config-reference.md)           |
| An environment variable that discern reads or passes to your commands. | [Environment variables](environment-variables.md) |

## Installation and project files

| Look up                                                                          | Reference                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Supported systems and coding tools, and what each tool needs to connect.         | [Platforms and providers](platforms-and-providers.md) |
| Which files you can edit, which files discern generates, and what removal keeps. | [Files and ownership](files-and-ownership.md)         |
| The license for discern, and for the material it writes into your project.       | [Licenses](licenses.md)                               |

## Results and records

| Look up                                                                                                               | Reference                                                       |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A task's identity, workspace settings, resources, or status fields.                                                   | [Worktrees and status](worktrees-and-status.md)                 |
| The fields and states in Proof records and checkpoint answers.                                                        | [Proof and checkpoint formats](proof-and-checkpoint-formats.md) |
| discern's local activity record: where it's kept, what each entry holds, and how to archive or reset it.              | [Logbook](logbook.md)                                           |
| The Model Context Protocol (MCP) tools discern gives your agent, their structured results, and the published schemas. | [MCP and results](mcp-and-results.md)                           |
| What a new release may change, which parts are still evolving, and how pinned schemas keep working.                   | [Compatibility](compatibility.md)                               |

The [explanations](../10-understand/README.md) help you make sense of these details. When a result failed or refused to go ahead, [Troubleshooting](../40-troubleshooting/README.md) helps you find the next step.
