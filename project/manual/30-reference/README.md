---
id: reference-index
title: "Reference"
description: "Find the exact answer about any discern command, setting, supported coding tool, file, or result."
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

Come here when you need the exact answer: the values a flag accepts, a setting's default, whether discern rebuilds a file before you edit it, or what a field in a result means. These pages keep every default, limit, and exception, so the guides can stay on the task and link here for the detail.

You don't have to look anything up yourself: your agent reads these same pages through `discern docs`, so you can ask it for the answer in your own words. If you know what you want done but not which command does it, start with the [guides](../20-guides/README.md).

- [Glossary](glossary.md): find a plain definition of a discern term.

## Commands and settings

| Look up                                                                   | Reference                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| A command, an option, an exit code, or a key in the documentation reader. | [CLI reference](cli-reference.md)                 |
| A setting in `discern.toml`, the values it takes, or its default.         | [Config reference](config-reference.md)           |
| An environment variable that discern reads, or passes to your commands.   | [Environment variables](environment-variables.md) |

## Installation and project files

| Look up                                                                               | Reference                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The computers and coding tools discern supports, and what each tool needs to connect. | [Platforms and providers](platforms-and-providers.md) |
| Which files you can edit, which ones discern rebuilds, and what uninstalling keeps.   | [Files and ownership](files-and-ownership.md)         |
| The license for discern itself, and for the material it writes into your project.     | [Licenses](licenses.md)                               |

## Results and records

| Look up                                                                                                             | Reference                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| What `discern status` reports for each task, and the port, names, and environment values each worktree gets.        | [Worktrees and status](worktrees-and-status.md)                 |
| How discern stores Proof, in a worktree and on a landed commit, and the states a checkpoint question moves through. | [Proof and checkpoint formats](proof-and-checkpoint-formats.md) |
| discern's local activity record: what each entry holds, what reads it, and how to archive or reset it.              | [Logbook](logbook.md)                                           |
| The Model Context Protocol (MCP) tools your agent calls, the results they return, exit codes, and schemas.          | [MCP and results](mcp-and-results.md)                           |
| What a new release can change, which parts are still evolving, and how a schema you pinned keeps working.           | [Compatibility](compatibility.md)                               |

[Understand](../10-understand/README.md) explains why discern works the way it does. When a command fails or refuses, [Troubleshooting](../40-troubleshooting/README.md) starts from what you can see and leads you to the next step.
