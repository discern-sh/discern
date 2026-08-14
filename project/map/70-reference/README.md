---
title: Reference
description: Exact command, configuration, MCP, file-ownership, platform, environment, and identity contracts for discern.
order: 70
publish: true
aliases:
  - reference
  - command reference
  - configuration reference
  - MCP reference
  - prerequisites
  - supported platforms
---

# Reference

_Reference pages provide the exact command-line, configuration, Model Context Protocol (MCP), file, and runtime contracts._

Use this section when you need the current contract rather than a guided workflow. It answers which commands and flags exist, which keys `discern.toml` accepts, what an MCP call returns, which files discern writes, and which platforms and tools can run it.

The command, configuration, and environment-variable pages come from the same registries the binary uses. A changed verb, flag, section, configuration key, or environment contract updates its reference through `deno task codegen`. Committed-output tests report any generated page that differs from its registry. Search aliases come from those registries too, so command paths, dotted configuration keys, and environment-variable names remain searchable as their sets grow.

The authored pages cover contracts that need explanation. MCP tools share the same prepared `DiscernResult` as CLI quiet modes: `structuredContent` uses the `--json` projection, while text `content` uses the `--markdown` presenter. Files and ownership separates project-owned, Shared, Generated, tracked, and ignored artifacts. Licenses for project payloads explains the Apache-2.0 boundary for discern-authored material. Platforms and prerequisites records the release targets, required executables, identity selectors, and command-template tokens verified against the installer and runtime checks.

For setup and first-use steps, start in [Getting started](../10-getting-started/). For behavior and failure recovery, use [The quality Gate](../20-quality-gate/) or [Worktrees](../30-worktrees/). Reference remains organized for lookup.

| Reference                                                                 | Use it to                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [CLI reference](cli-reference.md)                                         | Find every visible command, subcommand, positional argument, and flag.                   |
| [`discern.toml` reference](config-reference.md)                           | Find every section, key, type, default, and repeatable named table.                      |
| [Agent result surfaces](result-surfaces.md)                               | Choose human, Markdown, JSON, or MCP delivery for one prepared result.                   |
| [MCP tools & results](mcp-and-results.md#compatibility-by-schema-version) | Integrate with tools, resources, result envelopes, schemas, and exit codes.              |
| [Proof note format](proof-note-format.md)                                 | Consume the durable Proof record attached to each landed commit.                         |
| [Files & ownership](artifact-ownership.md)                                | See what discern writes, who may edit or overwrite it, Git treatment, and removal rules. |
| [Licenses for project payloads](project-payload-license.md)               | See where Apache-2.0 begins and ends for discern-authored material.                      |
| [The Logbook](the-logbook.md)                                             | See what discern records about its own runs, and read, delete, or disable it.            |
| [Crash reports](crash-reports.md)                                         | Find the saved report, exit code, and envelope a bug in discern leaves behind.           |
| [Environment variables](environment-variables.md)                         | Find every public `DISCERN_*` input and export, grouped by purpose.                      |
| [Platforms & prerequisites](platforms-and-prereqs.md)                     | Check release targets, required tools, identity selectors, and tokens.                   |
| [MCP call duration](mcp-call-duration.md)                                 | Compare verified tool-call bounds and resumable waits across coding agents.              |
| [Temp files & retention](temp-files-and-retention.md)                     | Know what discern writes to your temp directory, for how long, and how it leaves.        |
| [Logbook lifecycle](logbook-lifecycle.md)                                 | Preview, confirm, archive, reset, recover, and read sealed Logbook history.              |
