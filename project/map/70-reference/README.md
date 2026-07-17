---
title: Reference
description: Exact command, config, MCP, file-ownership, platform, environment, and identity contracts for discern.
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

_Exact lookup material for discern's command line, configuration, MCP surface, files, and runtime requirements._

Use this section when you need the current contract rather than a guided workflow. It answers which commands and flags exist, which keys `discern.toml` accepts, what an MCP call returns, which files discern writes, and which platforms and tools can run it.

The command and configuration pages are generated from the same registries the binary uses. A changed verb, flag, section, key, type, or default therefore changes the reference through `deno task codegen`; committed-output tests fail if regeneration is missed. Search aliases come from those registries too, so command paths and dotted config keys remain searchable as the command set and config grow.

The authored pages cover the contracts that need explanation. MCP tools share the same `DiscernResult` payload as CLI `--json`, wrapped in the protocol's text and structured channels. Files & ownership separates authored, co-managed, generated, tracked, and ignored artifacts. Platforms & prerequisites records the release targets, required executables, environment variables, identity selectors, and command-template tokens verified against the installer and runtime checks.

For setup and first-use steps, start in [Getting started](../10-getting-started/). For behavior and failure recovery, use [The quality gate](../20-quality-gate/) or [Worktrees](../30-worktrees/); this tier stays organized for lookup.

| Reference                                             | Use it to                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [CLI reference](cli-reference.md)                     | Find every visible command, subcommand, positional argument, and flag.             |
| [`discern.toml` reference](config-reference.md)       | Find every section, key, type, default, and repeatable named table.                |
| [MCP tools & results](mcp-and-results.md)             | Integrate with tools, resources, result envelopes, schemas, and exit codes.        |
| [Files & ownership](artifact-ownership.md)            | See what discern writes, who owns it, how git treats it, and removal rules.        |
| [Platforms & prerequisites](platforms-and-prereqs.md) | Check release targets, required tools, env values, identity selectors, and tokens. |
