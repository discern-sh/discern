---
title: Gemini
description: How discern configures instructions, shared Skills, MCP, hooks, and workspace trust for Gemini.
order: 30
aliases:
  - Gemini
  - Gemini CLI
  - Google Gemini
---

# Gemini integration

_The Gemini integration supplies shared instructions and Skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

discern's Gemini integration is project-local and registry-driven. It writes or co-manages the files below when Gemini is enabled in `[project].agents`:

| File                    | Role                                                       | Ownership             |
| ----------------------- | ---------------------------------------------------------- | --------------------- |
| `GEMINI.md`             | Pointer to the canonical agent file                        | Generated, committed  |
| `.agents/skills/`       | Materialized Agent Skills                                  | Generated, gitignored |
| `.gemini/settings.json` | Model Context Protocol (MCP) server and session-start hook | Shared, tracked       |

Gemini is not in `DEFAULT_AGENTS`; add `"gemini"` to `[project].agents` to emit these artifacts.

## Instructions and Skills

Gemini reads `GEMINI.md` by default, not `AGENTS.md`, so discern writes `GEMINI.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains the canonical agent file. discern generates it from built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Gemini reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled Skills there and creates symbolic links to authored project Skills from `[skills].dir`. Codex, Cursor, and GitHub Copilot use the same directory.

## `.gemini/settings.json`

`discern refresh` deep-merges `.gemini/settings.json`. The registry-rendered hook seed is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree ensure",
            "timeout": 600000
          }
        ]
      }
    ]
  }
}
```

Gemini enables hooks by default, so discern writes no `hooksConfig` override. The matcher covers both a new session and a resumed one. MCP registration separately adds `mcpServers.discern` with `"command": "discern"`, `"args": ["mcp", "--long-tool-calls"]`, and `"timeout": 3600000`, preserving the hook and every user-owned setting. Gemini infers stdio from `command`, so the server has no `type` field.

Gemini's [MCP server configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md#mcpservers) accepts a request timeout in milliseconds and otherwise defaults to 10 minutes. discern raises it to one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds. A longer watch continues from the returned 15-character resume handle.

discern does not set Gemini sandbox options, model settings, custom commands, `.env` loading, approval defaults, or worktree flags. Those remain user or project choices.

## Runtime behavior and gotchas

Project `.gemini/settings.json` is ignored in Gemini's safe mode until Gemini trusts the folder. That trust grant is outside the repository. Gemini still reads `GEMINI.md` as instructions before trust, but the committed MCP server and hooks do not load until the folder is trusted or the user chooses a bypass such as `--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true`.

Gemini has no mid-session project-root move. `/directory add` can widen the workspace, and the native `--worktree` flag is a launch-time choice, but a running session cannot move its root into a discern worktree. Use `discern start` / `discern_start` to create the worktree, then launch a Gemini session there when commands must run from that root.

The wired hook is a `SessionStart` setup hook only. Gemini does not expose Claude Code's `WorktreeCreate` or `WorktreeRemove` contract, and its `SessionEnd` hook is advisory. discern therefore runs worktree creation and teardown through its CLI and MCP verbs. It does not use `SessionEnd` as teardown authority.

Run `discern refresh` after changing the configured agent set or upgrading the project. This keeps the committed settings aligned with the provider registry.

## See also

- Why `GEMINI.md` is a pointer to `AGENTS.md` ([ADR 0043](../_adr/0043-registry-derived-agent-parity.md)).
- Why MCP coverage is explicit in the provider registry ([ADR 0072](../_adr/0072-typed-mcp-status-forcing-function.md)).
