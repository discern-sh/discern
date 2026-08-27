---
id: reference-index
title: "Reference"
description: "Reach the exact public contract by command, configuration, state, file, provider, or term."
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

Reach the exact public contract by command, configuration, state, file, provider, or term.

## In this section

- [CLI reference](cli-reference.md): Look up every live command, subcommand, argument, flag, alias, and help owner.
- [Config reference](config-reference.md): Look up every public discern.toml table, key, type, default, placeholder, and named-table rule.
- [MCP and results](mcp-and-results.md): Look up MCP tools/resources, DiscernResult, JSON/Markdown delivery, schemas, versions, exits, and continuation/duration policy.
- [Proof and checkpoint formats](proof-and-checkpoint-formats.md): Look up Proof-note fields, checkpoint states, declarations, variance fields, and the `when` protocol.
- [Environment variables](environment-variables.md): Look up every public input/exported environment variable, source, scope, and consumer.
- [Files and ownership](files-and-ownership.md): Look up authored/shared/generated/runtime files, write ownership, setup/uninstall boundaries, temporary retention, and registered paths.
- [Platforms and providers](platforms-and-providers.md): Look up supported platforms, prerequisites, provider-specific files/hooks, reload needs, identity limits, and secure-random boundary.
- [Worktrees and status](worktrees-and-status.md): Look up worktree identity, environment/resources, status fields, session findings, and shell-opening contracts.
- [Logbook](logbook.md): Look up local Logbook fields, storage, epochs, rotation, archive/reset lifecycle, and practice-stat definitions.
- [Licenses](licenses.md): Look up the license and provenance contract for discern-emitted project payloads.
- [Glossary](glossary.md): Look up every canonical product term and its exact definition.

## Reference

_Reference pages provide the exact command-line, configuration, Model Context Protocol (MCP), file, and runtime contracts._

Use this section when you need the current contract rather than a guided workflow. It answers which commands and flags exist, which keys `discern.toml` accepts, what an MCP call returns, which files discern writes, and which platforms and tools can run it.

The command, configuration, and environment-variable pages come from the same registries the binary uses. A changed verb, flag, section, configuration key, or environment contract updates its reference through `deno task codegen`. Committed-output tests report any generated page that differs from its registry. Search aliases come from those registries too, so command paths, dotted configuration keys, and environment-variable names remain searchable as their sets grow.

The authored pages cover contracts that need explanation. MCP tools share the same prepared `DiscernResult` as CLI quiet modes: `structuredContent` uses the `--json` projection, while text `content` uses the `--markdown` presenter. Files and ownership separates project-owned, Shared, Generated, tracked, and ignored artifacts. Licenses for project payloads explains the Apache-2.0 boundary for discern-authored material. Platforms and prerequisites records the release targets, required executables, identity selectors, and command-template tokens verified against the installer and runtime checks.

For setup and first-use steps, start in [Getting started](../00-start/README.md). For behavior and failure recovery, use [The quality Gate](../10-guides/README.md) or [Worktrees](../10-guides/README.md). Reference remains organized for lookup.

| Reference                                                                       | Use it to                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [CLI reference](cli-reference.md)                                               | Find every visible command, subcommand, positional argument, and flag.                   |
| [`discern.toml` reference](config-reference.md)                                 | Find every section, key, type, default, and repeatable named table.                      |
| [Result formats & delivery](mcp-and-results.md)                                 | Choose terminal, Markdown, JSON, or MCP delivery for one prepared result.                |
| [MCP tools & results](mcp-and-results.md#compatibility-by-schema-version)       | Integrate with tools, resources, result envelopes, schemas, and exit codes.              |
| [Proof note format](proof-and-checkpoint-formats.md)                            | Consume the durable Proof record attached to each landed commit.                         |
| [Files & ownership](files-and-ownership.md)                                     | See what discern writes, who may edit or overwrite it, Git treatment, and removal rules. |
| [Licenses for project payloads](licenses.md)                                    | See where Apache-2.0 begins and ends for discern-authored material.                      |
| [The Logbook](logbook.md)                                                       | See what discern records about its own runs, and read, delete, or disable it.            |
| [Crash reports](../40-troubleshooting/crashes-and-local-state.md)               | Find the saved report, exit code, and envelope a bug in discern leaves behind.           |
| [Environment variables](environment-variables.md)                               | Find every public `DISCERN_*` input and export, grouped by purpose.                      |
| [Platforms & prerequisites](platforms-and-providers.md)                         | Check release targets, required tools, identity selectors, and tokens.                   |
| [MCP call duration](../40-troubleshooting/mcp-terminal-and-docs.md)             | Compare verified tool-call bounds and resumable waits across coding agents.              |
| [Temp files & retention](../40-troubleshooting/crashes-and-local-state.md)      | Know what discern writes to your temp directory, for how long, and how it leaves.        |
| [Logbook lifecycle](logbook.md)                                                 | Preview, confirm, archive, reset, recover, and read sealed Logbook history.              |
| [Checkpoint state & declarations](proof-and-checkpoint-formats.md)              | Look up open-question states, declaration and variance flags, and the read surfaces.     |
| [Checkpoint `when` protocol](proof-and-checkpoint-formats.md)                   | Consume the versioned command input, match output, and temporary-file lifecycle.         |
| [Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)     | Separate setup consent, write access, recovery, and provider activation.                 |
| [Worktree setup-step recovery](../40-troubleshooting/setup-and-integrations.md) | Resolve an interrupted one-shot setup command without automatic replay.                  |
