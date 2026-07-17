# Agent integrations

_Provider-specific files, trust gates, and daily-use gotchas for each coding agent discern knows how to wire._

discern keeps provider-specific behaviour in one typed registry: [`src/lib/providers.ts`](../../../src/lib/providers.ts). That registry names each agent's instruction file, skills directory, MCP config target, hook surface, trust gate, and any app-managed worktree lifecycle file. `discern setup`, `discern refresh`, and `discern upgrade` use the registry to re-establish the integration artifacts idempotently.

This section is the human-readable companion to that registry. Each provider page names the exact files discern writes or co-manages, why those settings exist, what discern deliberately does not set, and what surprises users and agents should expect from that provider.

| Provider       | Page                                   | Status  |
| -------------- | -------------------------------------- | ------- |
| Claude Code    | [claude-code.md](claude-code.md)       | Current |
| Codex          | [codex.md](codex.md)                   | Current |
| Gemini         | [gemini.md](gemini.md)                 | Current |
| Cursor         | [cursor.md](cursor.md)                 | Current |
| GitHub Copilot | [github-copilot.md](github-copilot.md) | Current |

## See also

- [Agent guidance](../40-agent-guidance/) - the author-once pipeline that produces `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and materialized skills.
- [Worktrees](../30-worktrees/) - the linked-worktree workflow these integrations help agents inhabit.
- The provider registry decision ([ADR 0031](../_adr/0031-typed-provider-integration.md)).
