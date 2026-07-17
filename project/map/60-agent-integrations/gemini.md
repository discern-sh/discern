---
title: Gemini
description: How discern wires guidance, shared skills, MCP, hooks, and workspace trust for Gemini.
order: 30
aliases:
  - Gemini
  - Gemini CLI
  - Google Gemini
---

# Gemini integration

discern's Gemini integration is project-local and registry-driven. It writes or co-manages the files below when Gemini is enabled in `[guidance].agents`:

| File                    | Role                                         | Ownership             |
| ----------------------- | -------------------------------------------- | --------------------- |
| `GEMINI.md`             | Pointer to the canonical compiled agent file | Generated, committed  |
| `.agents/skills/`       | Materialized Agent Skills                    | Generated, gitignored |
| `.gemini/settings.json` | MCP server entry and session-start hook      | Co-managed, tracked   |

Gemini is not in `DEFAULT_AGENTS`; add `"gemini"` to `[guidance].agents` to emit these artifacts.

## Guidance and skills

Gemini reads `GEMINI.md` by default, not `AGENTS.md`, so discern writes `GEMINI.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains the canonical compiled agent file. The file is generated from discern's built-in guidance plus the project's `[guidance].sources`. Edit the sources, then run `discern refresh`.

Gemini reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled skills there and symlinks authored project skills from `[skills].dir`. That directory is shared with Codex, Cursor, and GitHub Copilot.

## `.gemini/settings.json`

`discern refresh` deep-merges `.gemini/settings.json`. It preserves the user's other settings and servers while adding the Gemini-shaped MCP server entry and the session-start hook:

```json
{
  "hooksConfig": {
    "enabled": true
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree ensure"
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "discern": {
      "command": "discern",
      "args": ["mcp"]
    }
  }
}
```

Gemini infers stdio from the presence of `command`, so discern does not write a `type` field for this server. The hook seed includes `hooksConfig.enabled:
true` — the hooks system's canonical toggle, a separate section from the per-event `hooks` arrays (every key under `hooks` must be an event array; Gemini rejects a boolean there). Without the toggle, Gemini keeps the hook block inert.

discern does not set Gemini sandbox options, model settings, custom commands, `.env` loading, approval defaults, or worktree flags. Those remain user or project choices.

## Runtime behavior and gotchas

Project `.gemini/settings.json` is ignored in safe mode until Gemini trusts the folder. That trust grant is outside the repository. `GEMINI.md` is still read as guidance before trust, but the committed MCP server and hooks do not load until the folder is trusted or the user chooses a bypass such as `--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true`.

Gemini has no mid-session project-root move. `/directory add` can widen the workspace, and the native `--worktree` flag is a launch-time choice, but a running session cannot move its root into a discern worktree. Use `discern start` / `discern_start` to create the worktree, then launch a Gemini session in that worktree when the agent's shell needs to live there.

The wired hook is a `SessionStart` setup hook only. Gemini does not expose Claude Code's `WorktreeCreate` or `WorktreeRemove` contract, and its `SessionEnd` hook is advisory. discern therefore owns worktree creation and teardown through its CLI and MCP verbs rather than relying on Gemini to fire teardown.

Gemini's native worktree and sandbox behaviors are changing quickly. Re-run `discern refresh` after changing the configured agent set or upgrading the project so the committed settings stay aligned with the provider registry.

## See also

- Why `GEMINI.md` is a pointer to `AGENTS.md` ([ADR 0043](../_adr/0043-registry-derived-agent-parity.md)).
- Why MCP coverage is explicit in the provider registry ([ADR 0072](../_adr/0072-typed-mcp-status-forcing-function.md)).
