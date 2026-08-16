---
title: Claude Code
description: How discern configures instructions, Skills, MCP, hooks, permissions, and worktrees for Claude Code.
order: 10
aliases:
  - Claude Code
  - claude
  - Anthropic Claude
---

# Claude Code integration

_The Claude Code integration supplies shared instructions and Skills, a Model Context Protocol (MCP) server entry, hooks, and project-local permission defaults._

When Claude Code is enabled in `[project].agents`, discern writes or co-manages these project-local files:

| File                    | Role                                             | Ownership             |
| ----------------------- | ------------------------------------------------ | --------------------- |
| `CLAUDE.md`             | Pointer to the canonical agent file              | Generated, committed  |
| `.claude/skills/`       | Materialized Claude Code Skills                  | Generated, gitignored |
| `.mcp.json`             | Project Model Context Protocol (MCP) server      | Shared, tracked       |
| `.claude/settings.json` | Hooks, MCP pre-approval, and permission defaults | Shared, tracked       |

Claude Code may create `.claude/settings.local.json` for machine-local permissions. discern neither seeds nor tracks it. The shipped `.gitignore` keeps it local.

## Instructions and Skills

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so discern writes `CLAUDE.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains canonical. discern compiles its built-in instructions and `[instructions].sources` there. Edit the sources, then run `discern refresh`.

Claude Code does not read the cross-tool `.agents/skills/` directory. discern therefore materializes the effective Skill set into `.claude/skills/` for Claude Code, while other agents can share `.agents/skills/`.

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

[Claude Code's MCP Tool Search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) is on by default. Sessions begin with tool names and server instructions, then selected schemas arrive after search. This client policy does not change the full definitions returned by MCP `tools/list`.

discern keeps its instructions below Claude Code's 2KB limit and leads with the lifecycle. Start with `discern_status`; its result names the next MCP tool.

The one-hour client timeout reserves 55 minutes for `discern_await` and five for delivery and cancellation. When the watched condition holds, the call returns immediately. A longer watch continues from a 15-character resume handle. This is discern's Claude-and-Copilot budget. Claude Code's [`MCP_TOOL_TIMEOUT`](https://code.claude.com/docs/en/env-vars) defaults to about 28 hours.

## `.claude/settings.json`

The Claude Code settings seed includes the worktree hooks and denies `Read(./.env)` by default:

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

Among the supported providers, Claude Code exposes the worktree lifecycle hook contract. `WorktreeCreate` and `WorktreeRemove` run `discern worktree hook`; `SessionStart` runs `discern worktree ensure`.

`EnterWorktree` re-roots Claude Code's shell and instruction context, but a stdio MCP process keeps its launch cwd. `discern_start` re-aims discern's live MCP root to its new worktree; a native cwd move does not move a generic server.

Claude Code's shell cwd persists across calls, so one `cd` affects later calls. Open or launch the session in the intended worktree when the task must stay isolated.

discern does not emit Claude Code sandbox settings. In discern's recorded provider evidence, Claude Code's native sandbox is the only modeled native agent sandbox that handles linked-worktree Git metadata automatically.

## See also

- Why the worktree-hook payloads are parsed in the binary ([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)).
- Why the provider registry is the single source for agent files, Skills, settings, and ignores ([ADR 0043](../_adr/0043-registry-derived-agent-parity.md)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](../_adr/0074-co-owned-mcp-json.md)).
