---
id: guide-connect-a-coding-agent
title: "Connect a coding agent"
description: "Connect one supported coding agent using the shared setup path and the provider-specific facts it needs."
order: 120
publish: true
kind: guide
aliases:
  - "guide-connect-a-coding-agent"
  - "agent integrations"
  - "coding agents"
  - "providers"
redirect_from:
  - "/docs/agent-integrations"
---

# Connect a coding agent

Connect one supported coding agent using the shared setup path and the provider-specific facts it needs.

# Agent integrations

_An agent integration is the provider-specific files, trust decisions, and runtime behavior that connect a coding agent to discern._

discern keeps coding-agent identity in one shared catalog: [`src/shared/agent_catalogue.ts`](https://github.com/jackwh/discern/blob/main/src/shared/agent_catalogue.ts). Entries with a native provider name form the supported set below. The provider registry in [`src/lib/providers.ts`](https://github.com/jackwh/discern/blob/main/src/lib/providers.ts) covers every native integration. It names the instruction file, Skills directory, Model Context Protocol (MCP) config target, hooks, trust gate, activation check and recovery, installation evidence, setup advice, interactive command-line interface (CLI) actions, brand assets, and any app-managed worktree lifecycle file.

The MCP call-duration policy covers the same native set in [`src/shared/mcp_timeout_policy.ts`](https://github.com/jackwh/discern/blob/main/src/shared/mcp_timeout_policy.ts). Type-checking and registry tests require each new native provider to declare a timeout profile. Signal-only catalog entries can appear as advisory Logbook evidence, but they never become setup choices.

`discern setup`, `discern refresh`, and `discern upgrade` use the provider registry to restore integration artifacts. The [Desk](delegate-work.md) uses its CLI declarations to open a configured, PATH-available agent in the selected worktree.

An agent consuming a discern result can treat top-level `ok` as the truth of that verb's completion contract. It does not need to inspect incidental lists or parse prose to discover a required failure. A successful degradation appears only in typed `advisories`, with evidence and a next action; a false result can still contain completed effects and the exact safe recovery. Terminal, JSON, Markdown, and MCP preserve that same verdict ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

Each native provider also declares a compact mark and horizontal logo lockup with first-party provenance. The parity guard checks the directory in both directions, so missing and unregistered scalable vector graphics (SVG) files fail. Each vector file contains its own assets, so the site does not depend on a vendor asset host.

Each provider page lists the files discern writes or co-manages, what stays with the user, and the provider-specific gotchas.

`setup done` derives each fresh-session check, local recovery, and CLI fallback from those records; parity tests enroll new providers. Generated files do not prove activation ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

discern writes workflow integration into vendor surfaces but cannot grant or retain vendor authority. The vendor controls sandbox, permissions, and approval flows; the user remains responsible for project security ([ADR 0193](https://discern.sh/docs/decisions/0193-discern-does-not-enforce-the-vendor-security-boundary)). Each provider's trust record separates explanation from typed paths, configuration keys and values, flags, and environment variables. Setup reactivation, `doctor` terminal output, JSON, MCP, and the generated integration reference project those records; no renderer recovers a machine fact from prose ([ADR 0346](https://discern.sh/docs/decisions/0346-machine-facts-are-typed-advisories)).

For the shared instructions behind these files, read [Agent instructions](README.md). For the isolated checkout lifecycle the hooks prepare, read [Worktrees](README.md). The table below is the reading order used in the manual's navigation.

The identity catalog supplies the supported set, and the provider registry requires a record for every native integration ([ADR 0166](https://discern.sh/docs/decisions/0166-agent-identity-is-advisory-logbook-evidence), [ADR 0031](https://discern.sh/docs/decisions/0031-typed-provider-integration)).

| Read next                                                           | What's in it                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [MCP call duration](../40-troubleshooting/mcp-terminal-and-docs.md) | Verified long-call bounds and resumable waits across providers.  |
| [Claude Code](../30-reference/platforms-and-providers.md)           | `CLAUDE.md`, Claude Skills, MCP, hooks, and permission defaults. |
| [Codex](../30-reference/platforms-and-providers.md)                 | `AGENTS.md`, MCP, hooks, app worktrees, and narrow Git rules.    |
| [Gemini](../30-reference/platforms-and-providers.md)                | `GEMINI.md`, shared Skills, MCP, hooks, and workspace trust.     |
| [Cursor](../30-reference/platforms-and-providers.md)                | `AGENTS.md`, MCP, hooks, IDE setup, and worktree choices.        |
| [GitHub Copilot](../30-reference/platforms-and-providers.md)        | `AGENTS.md`, shared Skills, MCP, hooks, and folder trust.        |
