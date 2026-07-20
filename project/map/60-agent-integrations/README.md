---
description: How discern wires guidance, skills, MCP, hooks, trust, and worktrees for each supported coding agent.
aliases:
  - agent integrations
  - coding agents
  - providers
---

# Agent integrations

_Provider-specific files, trust gates, and daily gotchas for each coding agent discern knows how to wire._

discern keeps coding-agent identity in one shared catalogue: [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts). Entries with a native provider name form the supported set below. The total provider registry in [`src/lib/providers.ts`](../../../src/lib/providers.ts) then describes every native integration. It names the instruction file, skills directory, Model Context Protocol (MCP) config target, hooks, trust gate, interactive CLI actions, and any app-managed worktree lifecycle file. Signal-only catalogue entries can appear as advisory logbook evidence but never become setup choices. `discern setup`, `discern refresh`, and `discern upgrade` use the provider registry to re-establish integration artifacts. [The desk](../30-worktrees/the-desk.md) uses its CLI declarations to open a configured, PATH-available agent in the selected worktree.

This section is the human-readable companion to that registry. Each provider page names the exact files discern writes or co-manages, why those settings exist, what discern leaves to the user, and what surprises users and agents should expect from that provider.

For the shared instructions behind these files, read [Agent guidance](../40-agent-guidance/). For the isolated checkout lifecycle the hooks prepare, read [Worktrees](../30-worktrees/). The table below is the reading order used in the manual's navigation.

The identity catalogue supplies the supported set, and the total provider registry makes every native integration complete ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md), [ADR 0031](../_adr/0031-typed-provider-integration.md)).

| Read next                           | What's in it                                                     |
| ----------------------------------- | ---------------------------------------------------------------- |
| [Claude Code](claude-code.md)       | `CLAUDE.md`, Claude Skills, MCP, hooks, and permission defaults. |
| [Codex](codex.md)                   | `AGENTS.md`, MCP, hooks, app worktrees, and narrow Git rules.    |
| [Gemini](gemini.md)                 | `GEMINI.md`, shared Skills, MCP, hooks, and workspace trust.     |
| [Cursor](cursor.md)                 | `AGENTS.md`, shared Skills, MCP, hooks, and IDE-only setup.      |
| [GitHub Copilot](github-copilot.md) | `AGENTS.md`, shared Skills, MCP, hooks, and folder trust.        |
