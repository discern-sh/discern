---
description: How discern configures instructions, Skills, MCP, hooks, trust, and worktrees for each supported coding agent.
aliases:
  - agent integrations
  - coding agents
  - providers
---

# Agent integrations

_An agent integration is the provider-specific files, trust decisions, and runtime behavior that connect a coding agent to discern._

discern keeps coding-agent identity in one shared catalog: [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts). Entries with a native provider name form the supported set below. The provider registry in [`src/lib/providers.ts`](../../../src/lib/providers.ts) covers every native integration. It names the instruction file, Skills directory, Model Context Protocol (MCP) config target, hooks, trust gate, activation check and recovery, installation evidence, setup advice, interactive command-line interface (CLI) actions, brand assets, and any app-managed worktree lifecycle file.

The MCP call-duration policy covers the same native set in [`src/shared/mcp_timeout_policy.ts`](../../../src/shared/mcp_timeout_policy.ts). Type-checking and registry tests require each new native provider to declare a timeout profile. Signal-only catalog entries can appear as advisory Logbook evidence, but they never become setup choices.

`discern setup`, `discern refresh`, and `discern upgrade` use the provider registry to restore integration artifacts. The [Desk](../30-worktrees/the-desk.md) uses its CLI declarations to open a configured, PATH-available agent in the selected worktree.

Each native provider also declares a compact mark and horizontal logo lockup with first-party provenance. The parity guard checks the directory in both directions, so missing and unregistered scalable vector graphics (SVG) files fail. Each vector file contains its own assets, so the site does not depend on a vendor asset host.

Each provider page lists the files discern writes or co-manages, what stays with the user, and the provider-specific gotchas.

`setup done` derives each fresh-session check, local recovery, and CLI fallback from those records; parity tests enroll new providers. Generated files do not prove activation ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

discern writes workflow integration into vendor surfaces but cannot grant or retain vendor authority. The vendor controls sandbox, permissions, and approval flows; the user remains responsible for project security ([ADR 0193](../_adr/0193-discern-does-not-enforce-the-vendor-security-boundary.md)). Each provider's trust record separates explanation from typed paths, configuration keys and values, flags, and environment variables. Setup reactivation, `doctor` terminal output, JSON, MCP, and the generated integration reference project those records; no renderer recovers a machine fact from prose ([ADR 0346](../_adr/0346-machine-facts-are-typed-advisories.md)).

For the shared instructions behind these files, read [Agent instructions](../40-agent-instructions/). For the isolated checkout lifecycle the hooks prepare, read [Worktrees](../30-worktrees/). The table below is the reading order used in the manual's navigation.

The identity catalog supplies the supported set, and the provider registry requires a record for every native integration ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md), [ADR 0031](../_adr/0031-typed-provider-integration.md)).

| Read next                                                 | What's in it                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| [MCP call duration](../70-reference/mcp-call-duration.md) | Verified long-call bounds and resumable waits across providers.  |
| [Claude Code](claude-code.md)                             | `CLAUDE.md`, Claude Skills, MCP, hooks, and permission defaults. |
| [Codex](codex.md)                                         | `AGENTS.md`, MCP, hooks, app worktrees, and narrow Git rules.    |
| [Gemini](gemini.md)                                       | `GEMINI.md`, shared Skills, MCP, hooks, and workspace trust.     |
| [Cursor](cursor.md)                                       | `AGENTS.md`, MCP, hooks, IDE setup, and worktree choices.        |
| [GitHub Copilot](github-copilot.md)                       | `AGENTS.md`, shared Skills, MCP, hooks, and folder trust.        |
