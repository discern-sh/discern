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

The exact command, configuration, environment-variable, glossary, and license contracts are generated from the binary's own registries into the product manual: [CLI reference](https://discern.sh/docs/reference/cli-reference), [`discern.toml` reference](https://discern.sh/docs/reference/config-reference), [environment variables](https://discern.sh/docs/reference/environment-variables), and [licenses](https://discern.sh/docs/reference/licenses). `deno task codegen` rewrites them from the live registries, and committed-output tests report any generated page that differs from its registry.

This tier keeps the accounts that serve agents working on discern. MCP tools share the same prepared `DiscernResult` as CLI quiet modes: `structuredContent` uses the `--json` projection, while text `content` uses the `--markdown` presenter. Files and ownership separates project-owned, Shared, Generated, tracked, and ignored artifacts. Platforms and prerequisites records the release targets, required executables, identity selectors, and command-template tokens verified against the installer and runtime checks.

For setup and first-use steps, start in [Getting started](../10-getting-started/). For behavior and failure recovery, use [The quality Gate](../20-quality-gate/) or [Worktrees](../30-worktrees/). Reference remains organized for lookup.

| Reference                                                                 | Use it to                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Result formats & delivery](result-surfaces.md)                           | Choose terminal, Markdown, JSON, or MCP delivery for one prepared result.                |
| [MCP tools & results](mcp-and-results.md#compatibility-by-schema-version) | Integrate with tools, resources, result envelopes, schemas, and exit codes.              |
| [Proof note format](proof-note-format.md)                                 | Consume the durable Proof record attached to each landed commit.                         |
| [Files & ownership](artifact-ownership.md)                                | See what discern writes, who may edit or overwrite it, Git treatment, and removal rules. |
| [The Logbook](the-logbook.md)                                             | See what discern records about its own runs, and read, delete, or disable it.            |
| [Crash reports](crash-reports.md)                                         | Find the saved report, exit code, and envelope a bug in discern leaves behind.           |
| [Platforms & prerequisites](platforms-and-prereqs.md)                     | Check release targets, required tools, identity selectors, and tokens.                   |
| [MCP call duration](mcp-call-duration.md)                                 | Compare verified tool-call bounds and resumable waits across coding agents.              |
| [Temp files & retention](temp-files-and-retention.md)                     | Know what discern writes to your temp directory, for how long, and how it leaves.        |
| [Logbook lifecycle](logbook-lifecycle.md)                                 | Preview, confirm, archive, reset, recover, and read sealed Logbook history.              |
| [Checkpoint state & declarations](checkpoint-state.md)                    | Look up open-question states, declaration and variance flags, and the read surfaces.     |
| [Checkpoint `when` protocol](checkpoint-when-protocol.md)                 | Consume the versioned command input, match output, and temporary-file lifecycle.         |
| [Setup command boundaries](setup-command-boundaries.md)                   | Separate setup consent, write access, recovery, and provider activation.                 |
| [Worktree setup-step recovery](worktree-setup-step-recovery.md)           | Resolve an interrupted one-shot setup command without automatic replay.                  |
