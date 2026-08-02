---
title: Claude Code
description: How discern wires guidance, skills, MCP, hooks, permissions, and worktrees for Claude Code.
order: 10
aliases:
  - Claude Code
  - claude
  - Anthropic Claude
---

# Claude Code integration

When Claude Code is enabled in `[project].agents`, discern writes or co-manages these project-local files:

| File                    | Role                                             | Ownership             |
| ----------------------- | ------------------------------------------------ | --------------------- |
| `CLAUDE.md`             | Pointer to the canonical agent file              | Generated, committed  |
| `.claude/skills/`       | Materialized Claude Code Skills                  | Generated, gitignored |
| `.mcp.json`             | Project MCP server entry                         | Shared, tracked       |
| `.claude/settings.json` | Hooks, MCP pre-approval, and permission defaults | Shared, tracked       |

Claude Code may create `.claude/settings.local.json` for machine-local permissions. discern neither seeds nor tracks it; the shipped `.gitignore` keeps it local.

## Guidance and skills

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so discern writes `CLAUDE.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains canonical. discern compiles its built-in guidance and `[guidance].sources` there; edit the sources, then run `discern refresh`.

Claude Code does not read the cross-tool `.agents/skills/` directory. discern therefore materializes the effective skill set into `.claude/skills/` for Claude Code, while other agents can share `.agents/skills/`.

## `.mcp.json`

`discern refresh` co-manages `.mcp.json` and preserves other servers and top-level keys. The discern-owned entry is:

```json
{
  "mcpServers": {
    "discern": {
      "type": "stdio",
      "command": "discern",
      "args": ["mcp", "--long-tool-calls"],
      "timeout": 3600000
    }
  }
}
```

The same `.mcp.json` file can also be used by GitHub Copilot. Claude Code and Copilot share one writer for this entry, so the `discern` server is byte-identical whichever provider wires it first.

### Tool discovery

[Claude Code's MCP Tool Search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) is on by default. Sessions begin with tool names and server instructions; selected schemas arrive after search. This is client policy: MCP `tools/list` still returns full definitions and permits vendor `_meta`.

discern keeps its instructions below Claude Code's 2KB limit and leads with the lifecycle. `_meta["anthropic/alwaysLoad"] = true` keeps `discern_status` loaded as the gateway; its result names the next MCP tool.

To load every discern schema at session start, set:

```toml
[mcp]
  always_load = true
```

Run `discern refresh` to add `"alwaysLoad": true` to `.mcp.json`; turning the setting off removes it. This requires Claude Code 2.1.121 or later, loads every schema into context, and can delay startup while the server connects. The default is off.

The one-hour client timeout reserves 55 minutes for `discern_await` and five for delivery and cancellation. True conditions return immediately; longer watches continue from a 15-character resume handle. This is discern's Claude-and-Copilot budget. Claude Code's [`MCP_TOOL_TIMEOUT`](https://code.claude.com/docs/en/env-vars) defaults to about 28 hours.

## `.claude/settings.json`

The Claude Code settings seed includes the worktree hooks and a conservative permission default:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "deny": ["Read(./.env)"]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree ensure",
            "timeout": 600
          }
        ]
      }
    ],
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree hook create"
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree hook remove"
          }
        ]
      }
    ]
  },
  "enabledMcpjsonServers": ["discern"]
}
```

`discern refresh` deep-merges this file. Hook groups append with de-duplication, permission arrays are merged, and existing unrelated settings are preserved. `enabledMcpjsonServers` pre-approves the project `.mcp.json` server by name, so Claude Code does not need a separate folder-trust step for discern's MCP server.

## Runtime behavior and gotchas

Claude Code alone has a worktree lifecycle hook contract: `WorktreeCreate` and `WorktreeRemove` run `discern worktree hook`; `SessionStart` runs `discern worktree ensure`.

`EnterWorktree` re-roots Claude Code's shell and instruction context, but a stdio MCP process keeps its launch cwd. `discern_start` re-aims discern's live MCP root to its new worktree; a native cwd move does not move a generic server.

Claude Code's shell cwd persists across calls, so one `cd` affects later calls. Open or launch the session in the intended worktree when the task must stay isolated.

discern does not emit Claude Code sandbox settings. If Claude Code's native sandbox is enabled by the user, it is the only native agent sandbox among the modeled agents that understands linked-worktree Git metadata automatically.

## See also

- Why the worktree-hook payloads are parsed in the binary ([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)).
- Why the provider registry is the single source for agent files, skills, settings, and ignores ([ADR 0043](../_adr/0043-registry-derived-agent-parity.md)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](../_adr/0074-co-owned-mcp-json.md)).
