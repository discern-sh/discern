# ADR 0031: One typed provider registry for every agent-specific integration

**Status**: accepted; relates to [ADR 0030](_superseded/0030-quiet-json-output.md) (which adds the MCP-server steering this wires up)

## Context

discern is **agent-agnostic**: it knows several coding agents (`claude_code`, `codex`, `gemini`, …) and means to serve any of them equally. But each agent integrates with a project through its _own_ mechanisms — a different instruction-file name, a different place and shape for hooks, a different way to register an MCP server. There is **no universal setup** to lean on.

Today that per-agent knowledge is scattered and partial:

- the **guidance → file** mapping lives in a private `AGENT_OUTPUT` table in `engine/guidelines.ts` (`claude_code → CLAUDE.md`, `codex → AGENTS.md`, …);
- the **worktree-lifecycle hooks** and **settings** are hardcoded to `.claude/settings.json` in the seed template and in `setup`'s hook-stripping;
- the materialized **skills** dir is hardcoded `.claude/skills/`;
- and **MCP registration** (ADR 0030 wants `setup` to wire `discern mcp`) had no home at all.

Adding or completing a provider means finding and editing each of these independently — easy to do partially, with no compiler help. As we wire MCP per agent, that sprawl would only grow.

## Decision

Introduce **one typed `Provider` registry — `src/lib/providers.ts` — as the single source of truth for everything agent-specific.** A `Provider` record carries, for one agent:

- `guidanceFile` — the compiled instruction file (`path` + git-`tracked` flag);
- `mcp?` — how to register discern's MCP server for this agent: the config file it owns plus an idempotent `register(root, server)` that writes it;
- `hooks?` — the worktree-automation surface: the settings file it owns and the hook-event vocabulary it uses.

The registry is a **`Record<AgentName, Provider>`**, so the type checker forces a complete entry for every known agent — a new agent name cannot compile without its provider. The discern MCP server itself is one constant (`DISCERN_MCP_SERVER` = `discern mcp`). Each consumer now reads the registry instead of its own table:

- `guidelines.ts` compiles to `provider.guidanceFile.path`;
- the refresh core (`compileGuidelines`) wires each configured provider's `mcp.register` (`.mcp.json` + the approval in settings), so `setup`, `upgrade`, `refresh`, and worktree-setup all (re-)establish it idempotently; `setup` drives hook-stripping from `provider.hooks`;
- future provider-specific behaviour (e.g. a per-agent skills dir) extends the same record rather than adding a new scattered conditional. (The per-agent skills dir was added in [ADR 0042](_superseded/0042-per-agent-skills-materialization.md).)

**Claude Code is implemented end-to-end**: guidance `CLAUDE.md`; MCP via a stdio `discern mcp` server in `.mcp.json`, pre-approved with `enabledMcpjsonServers` in `.claude/settings.json`; and hooks in that same settings file. Codex and Gemini carry their guidance-file mappings (unchanged behaviour) with their `mcp`/`hooks` integrations left as **typed `TODO`s** — because no universal setup exists, each must be authored against that agent's real mechanism, which we will do separately. An unconfigured integration is simply skipped, never guessed.

## Consequences

- **Adding or completing a provider is one record.** The compiler enforces completeness across the registry; provider-specific behaviour can no longer drift between guidelines, init, and the worktree lifecycle.
- **MCP wiring is agent-agnostic by construction, and self-healing.** The refresh core iterates the configured providers and calls each one's `register` (no Claude-specific branch), so `setup` establishes it while `refresh`/`upgrade` backfill an install that lacks it. Teaching another agent is filling its `mcp`.
- **The worktree-hook surface is typed**, so a future Codex hook integration reuses the same `HooksIntegration` shape rather than inventing a parallel path.
- **A small migration of call sites.** `guidelines.ts` drops its `AGENT_OUTPUT` table for the registry; `setup`'s `stripWorktreeHooksFromPlan` keys off `provider.hooks` instead of literals. No behaviour change for guidance output.

## Alternatives considered

- **Per-provider `if (agent === "claude_code")` branches at each site.** Rejected: that is exactly the scatter this consolidates — every new integration multiplies the places a provider can be half-added.
- **A single universal MCP/hook config all agents share.** Rejected: there is no such standard. `.mcp.json` is Claude Code's; other agents differ. Pretending a universal shape exists would model the domain wrongly.
- **Keep the guidance table where it is and add a separate MCP table.** Rejected: two parallel per-agent tables is the same drift risk twice; one record per agent is the single source of truth.
