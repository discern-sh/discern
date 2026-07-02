# Claude Code integration

discern's Claude Code integration is project-local and registry-driven. It
writes or co-manages the files below when Claude Code is enabled in
`[guidance].agents`:

| File                    | Role                                             | Ownership             |
| ----------------------- | ------------------------------------------------ | --------------------- |
| `CLAUDE.md`             | Pointer to the canonical compiled guidance file  | Generated, gitignored |
| `.claude/skills/`       | Materialized Claude Code Skills                  | Generated, gitignored |
| `.mcp.json`             | Project MCP server entry                         | Co-managed, tracked   |
| `.claude/settings.json` | Hooks, MCP pre-approval, and permission defaults | Seeded, tracked       |

Claude Code may also create `.claude/settings.local.json` for machine-local
permission grants and overrides. discern does not seed or track that file; the
shipped `.gitignore` keeps it ignored so local approvals do not create permanent
porcelain noise.

## Guidance and skills

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so discern writes `CLAUDE.md` as
an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains the canonical compiled guidance file. The file is generated
from discern's built-in guidance plus the project's `[guidance].sources`; edit
the sources and run `discern refresh`, never edit `CLAUDE.md` by hand.

Claude Code does not read the cross-tool `.agents/skills/` directory. discern
therefore materializes the effective skill set into `.claude/skills/` for Claude
Code, while other agents can share `.agents/skills/`.

## `.mcp.json`

`discern refresh` co-manages `.mcp.json` and preserves other servers and
top-level keys. The discern-owned entry is:

```json
{
  "mcpServers": {
    "discern": {
      "type": "stdio",
      "command": "discern",
      "args": ["mcp"]
    }
  }
}
```

The same `.mcp.json` file can also be used by GitHub Copilot. Claude Code and
Copilot share one writer for this entry, so the `discern` server is
byte-identical whichever provider wires it first.

## `.claude/settings.json`

The seeded Claude Code settings include the worktree hooks and a conservative
permission default:

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
            "command": "discern worktree:ensure",
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
            "command": "discern worktree:create"
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree:remove"
          }
        ]
      }
    ]
  },
  "enabledMcpjsonServers": ["discern"]
}
```

`discern refresh` deep-merges this file. Hook groups append with de-duplication,
permission arrays are merged, and existing unrelated settings are preserved.
`enabledMcpjsonServers` pre-approves the project `.mcp.json` server by name, so
Claude Code does not need a separate folder-trust step for discern's MCP server.

## Runtime behavior and gotchas

Claude Code is the only supported agent with a worktree create/remove hook
contract. `WorktreeCreate` runs `discern worktree:create`, `WorktreeRemove` runs
`discern worktree:remove`, and `SessionStart` runs `discern worktree:ensure`.

Claude Code can also re-root a running session with `EnterWorktree`. That moves
Claude Code's shell and instruction-file context, but a stdio MCP process still
has the process cwd it started with. When the worktree is created through
`discern_start`, the live discern MCP server re-aims its own logical working
root to the new worktree; a native cwd move alone does not move a generic MCP
process.

Claude Code shell cwd persists across tool calls, so a `cd` in one shell call
can affect later calls. Agents should still prefer opening or launching a
session in the intended worktree when a task is meant to stay isolated.

discern does not emit Claude Code sandbox settings. If Claude Code's native
sandbox is enabled by the user, it is the only native agent sandbox among the
modelled agents that understands linked-worktree Git metadata automatically.

## See also

- [ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md) - why the
  worktree-hook payloads are parsed in the binary.
- [ADR 0043](../_adr/0043-registry-derived-agent-parity.md) - why the provider
  registry is the single source for agent files, skills, settings, and ignores.
- [ADR 0074](../_adr/0074-co-owned-mcp-json.md) - why Claude Code and GitHub
  Copilot co-own `.mcp.json`.
