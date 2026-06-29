# ADR 0074: GitHub Copilot co-owns Claude Code's `.mcp.json`, through one shared stdio writer

**Status**: accepted; extends [ADR 0031](0031-typed-provider-integration.md)
(one typed provider registry), [ADR 0045](0045-mcp-is-core-infrastructure.md)
(the MCP server is core infrastructure, re-wired on every refresh), and the
typed MCP status of [ADR 0072](0072-typed-mcp-status-forcing-function.md)

## Context

Phase C wires Cursor and GitHub Copilot. Both read the canonical `AGENTS.md` and
the cross-tool `.agents/skills/` natively (reuse-canonical, ADR 0070), so the
only genuinely new per-agent work is the MCP registration.

Copilot's MCP target is unusual. Each agent discern had wired so far keeps its
project MCP server in a file of its **own** — Claude `.mcp.json`, Codex
`.codex/config.toml`, Gemini `.gemini/settings.json` — so each `register()`
owned its file outright. The Copilot CLI instead reads the **same**
project-committable `.mcp.json` Claude Code reads (its `.github/mcp.json` is
silently ignored — copilot-cli #1886). So for the first time **two providers
target one committed file.** Two failure modes fall out:

- If each provider wrote `.mcp.json` through its own code, the two code paths
  could drift into non-identical entries, and the order they run in could decide
  which wins — a silent, order-dependent diff in a committed file.
- Copilot must **not** write Claude's `enabledMcpjsonServers` pre-approval key:
  Copilot gates committed config behind a one-time **folder trust**, not that
  Claude-specific settings key. Copying `registerClaudeCodeMcp` wholesale would
  seed a key that means nothing to Copilot.

## Decision

**One shared writer emits the byte-identical `.mcp.json` entry, and both Claude
and Copilot point at the same file through it; Copilot adds no pre-approval
key.**

- `registerStdioMcpJson(root, configFile, server)` is the single function that
  writes `{ type: "stdio", command, args }` into a JSON file's
  `mcpServers.<name>` map — a deep-merge that preserves every other server and
  top-level key, idempotent, reporting `firstInstall` when the server name was
  absent. It is the one place the `.mcp.json`-shaped entry is defined.
- Claude Code, Cursor, and Copilot all register **through it**. Claude and
  Copilot pass the same `MCP_JSON_FILE` (`.mcp.json`); Cursor passes its own
  `.cursor/mcp.json` (same shape, including the explicit `type: "stdio"` Cursor
  requires). So a `.mcp.json` co-owned by Claude and Copilot can only ever carry
  **one byte-identical** `discern` entry: whichever provider wires second finds
  it already correct and writes nothing — **order-independent**, and a re-wire
  of both is a clean no-op.
- **Only Claude adds `enabledMcpjsonServers`.** `registerClaudeCodeMcp` calls
  the shared writer for `.mcp.json`, then pre-approves the server by name in
  `.claude/settings.json` — its own step, layered on top. `registerCopilotMcp`
  is _just_ the shared writer: Copilot's gate is the folder trust named in its
  `trust` hint, so no settings key is written for it.

The explicit *no*s:

- **Gemini stays separate.** `.gemini/settings.json` omits `type` (Gemini infers
  stdio from `command`) and is not a `.mcp.json`-shaped file, so it keeps its
  own `registerGeminiMcp` — the shared writer is for the three that emit the
  identical `{ type, command, args }` shape, not a universal MCP writer.
- **No second `.github/mcp.json`.** The Copilot CLI ignores it; writing it would
  be dead config. Copilot's session hook is a separate, discern-owned
  `.github/hooks/discern.json` (Copilot loads every `.github/hooks/*.json`).

## Consequences

- **Two agents share one committed file, safely.** Because the entry is produced
  by one writer and merged (never clobbered), a repo that configures both Claude
  and Copilot gets a single `mcpServers.discern` entry no matter which provider
  runs first, and every subsequent refresh is a no-op. The `firstInstall`
  restart signal still fires exactly once — for whichever provider adds the
  server.
- **One source for the `.mcp.json` shape.** The stdio entry is defined in
  `registerStdioMcpJson` alone, so Claude's and Copilot's (and Cursor's) entries
  cannot drift apart — the single-source guarantee the co-ownership needs.
- **Adding a future `.mcp.json`-reading agent is a one-line provider entry.** It
  points its `mcp.integration` at `MCP_JSON_FILE` through the shared writer and
  inherits the same idempotent co-ownership.
- **The trust gap stays honest per agent.** Copilot's `trust` hint names the
  folder-trust step (and the `--allow-all-*` headless bypass), so `doctor`
  surfaces why the committed `.mcp.json` is inert until trusted — distinct from
  Claude, which pre-approves and needs no trust prompt.

## Alternatives considered

- **A bespoke `registerCopilotMcp` copied from Claude's.** Rejected: two code
  paths writing the same committed file is exactly the drift the single-source
  policy forbids; a shared writer makes the entries provably identical.
- **Give Copilot its own MCP file (`.github/mcp.json`).** Rejected: the Copilot
  CLI ignores it (copilot-cli #1886), so the server would never load — dead
  config that only looks wired.
- **Have Copilot also write `enabledMcpjsonServers` "to be safe".** Rejected:
  that key is Claude's pre-approval mechanism and is meaningless to Copilot,
  which gates on folder trust; writing it would misrepresent how Copilot honours
  the server and churn a file for no effect.
