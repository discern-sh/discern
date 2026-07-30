---
description: How discern wires guidance, skills, MCP, hooks, trust, and worktrees for each supported coding agent.
aliases:
  - agent integrations
  - coding agents
  - providers
---

# Agent integrations

_Provider-specific files, trust gates, and daily gotchas for each coding agent discern knows how to wire._

discern keeps coding-agent identity in one shared catalogue: [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts). Entries with a native provider name form the supported set below. The total provider registry in [`src/lib/providers.ts`](../../../src/lib/providers.ts) then describes every native integration. It names the instruction file, skills directory, Model Context Protocol (MCP) config target, hooks, and trust gate. It also holds installation evidence, human setup advice, interactive CLI actions, brand assets, and any app-managed worktree lifecycle file. Signal-only catalogue entries can appear as advisory logbook evidence but never become setup choices. `discern setup`, `discern refresh`, and `discern upgrade` use the provider registry to re-establish integration artifacts. [The desk](../30-worktrees/the-desk.md) uses its CLI declarations to open a configured, PATH-available agent in the selected worktree.

Each native provider also declares a compact mark and horizontal logo lockup with first-party provenance. The parity guard checks the directory in both directions, so missing and unregistered SVGs fail. Every file is a self-contained vector. The site needs no vendor asset host.

Each provider page lists the files discern writes or co-manages, what stays with the user, and the provider-specific gotchas.

Every write discern makes into a vendor surface smooths discern's own workflow — it never enforces security there. Sandbox rules, permissions, and approval flows stay with the vendor, and responsibility for a project's actual security stays with the user ([ADR 0193](../_adr/0193-discern-does-not-enforce-the-vendor-security-boundary.md)).

For the shared instructions behind these files, read [Agent guidance](../40-agent-guidance/). For the isolated checkout lifecycle the hooks prepare, read [Worktrees](../30-worktrees/). The table below is the reading order used in the manual's navigation.

The identity catalogue supplies the supported set, and the total provider registry makes every native integration complete ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md), [ADR 0031](../_adr/0031-typed-provider-integration.md)).

| Read next                           | What's in it                                                     |
| ----------------------------------- | ---------------------------------------------------------------- |
| [Claude Code](claude-code.md)       | `CLAUDE.md`, Claude Skills, MCP, hooks, and permission defaults. |
| [Codex](codex.md)                   | `AGENTS.md`, MCP, hooks, app worktrees, and narrow Git rules.    |
| [Gemini](gemini.md)                 | `GEMINI.md`, shared Skills, MCP, hooks, and workspace trust.     |
| [Cursor](cursor.md)                 | `AGENTS.md`, shared Skills, MCP, hooks, and IDE-only setup.      |
| [GitHub Copilot](github-copilot.md) | `AGENTS.md`, shared Skills, MCP, hooks, and folder trust.        |
