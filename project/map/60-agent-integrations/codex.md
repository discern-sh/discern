---
title: Codex
description: How discern wires guidance, skills, MCP, hooks, worktree setup, and Git rules for Codex.
order: 20
aliases:
  - Codex
  - OpenAI Codex
  - codex cli
---

# Codex integration

discern's Codex integration is project-local and registry-driven. It writes or co-manages the files below when Codex is enabled in `[project].agents`:

| File                                   | Role                                      | Ownership             |
| -------------------------------------- | ----------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical agent file                      | Generated, committed  |
| `.agents/skills/`                      | Materialized Agent Skills                 | Generated, gitignored |
| `.codex/config.toml`                   | Project Codex config and MCP server entry | Shared, tracked       |
| `.codex/hooks.json`                    | Session-start hook                        | Shared, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup/cleanup          | Shared, tracked       |
| `.codex/rules/discern.rules`           | Narrow Git rules for discern worktrees    | Shared, tracked       |

## Guidance and skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical agent file. Claude Code and Gemini point back to that file rather than duplicating it. The file is generated from discern's built-in guidance plus the project's `[guidance].sources`. Edit the sources, then run `discern refresh`.

Codex also reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled skills there and symlinks authored project skills from `[skills].dir`.

## `.codex/config.toml`

`discern refresh` co-manages `.codex/config.toml` with a comment-preserving TOML editor. It preserves other servers, other top-level settings, comments, and existing writable roots. The resulting discern-owned shape is:

```toml
project_doc_max_bytes = 65536

[sandbox_workspace_write]
writable_roots = ["../../<repo>.worktrees"]

[mcp_servers.discern]
command = "discern"
args = ["mcp", "--long-tool-calls"]
startup_timeout_sec = 30
tool_timeout_sec = 3600
```

`project_doc_max_bytes` is set only when the project has not chosen its own value. It gives discern-generated instructions more headroom than Codex's default instruction-file limit.

`sandbox_workspace_write.writable_roots` is merged with any existing list. The added entry points at the directory where discern creates linked worktrees, so a Codex session that starts in the main checkout can edit and run commands in a new sibling worktree with fewer sandbox prompts. For the default `[worktree].root = ""`, the entry is relative to `.codex/` and looks like `../../<repo>.worktrees`. If `[worktree].root` is relative, discern emits the corresponding path relative to `.codex/`. If `[worktree].root` is absolute, discern keeps it absolute.

When `discern refresh` runs from inside an existing linked worktree, discern asks Git for the main checkout and computes the writable root from that main checkout instead of from the transient worktree directory. This keeps a worktree-local refresh from rewriting the tracked config to `../../<worktree-id>.worktrees`.

discern does not set an MCP `cwd`; Codex starts the project-scoped server from the project root by default, and overriding that can detach the server from the project's `discern.toml`. The startup timeout gives slower local starts a little room. Codex's [per-tool timeout](https://developers.openai.com/codex/config-reference) defaults to 60 seconds, so discern raises it to one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds; a longer watch continues from the returned 15-character resume handle.

discern does not set `sandbox_mode`, `approval_policy`, `approvals_reviewer`, model settings, network access, `required = true`, MCP tool lists, or tool approval modes. Those are user or project security choices, and several would make the CLI fallback or future discern tools more brittle.

## `.codex/hooks.json`

The discern-owned Codex hook seed is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree ensure"
          }
        ]
      }
    ]
  }
}
```

`discern refresh` re-seeds this hook idempotently, preserving unrelated settings and hook groups in the same file. It keeps a Codex session re-ready when opened or resumed inside a discern worktree. Codex still gates committed hooks behind its hook trust flow, so the command does not run until the user trusts the hook hash.

## `.codex/environments/environment.toml`

The Codex app has its own worktree environment file. discern co-manages only the worktree lifecycle scripts and preserves the app's other keys:

```toml
version = 1
name = "Discern"

[setup]
script = "discern worktree ensure"

[cleanup]
script = "discern worktree teardown"
```

`version` and `name` are written only when absent, so an app-created file keeps the app's values. Missing or still-default discern scripts are re-emitted on refresh because the Codex app can regenerate this file; user-customized script values are preserved.

This file is for Codex-app-managed worktrees. discern's own sibling worktrees still come from `discern start` / `discern_start` and the worktree lifecycle verbs.

## `.codex/rules/discern.rules`

Codex project rules can grant narrow, project-local exec-policy decisions after the project is trusted. discern writes its own rules file rather than mutating user-owned files such as `.codex/rules/default.rules`.

The generated rules file allows only these prefixes:

```toml
prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow staging from trusted discern linked worktrees; Git writes linked-worktree indexes and locks under the main checkout .git/worktrees directory.",
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow committing from trusted discern linked worktrees; Git writes linked-worktree metadata under the main checkout .git/worktrees directory.",
)
```

This smooths the expected linked-worktree workflow after `discern_start`: normal file writes are covered by `.codex/config.toml`'s `writable_roots`, while staging and committing can write Git metadata under the main checkout's `.git/worktrees` directory. The rules do not allow broad `git`, `git push`, shell wrappers, destructive commands, network access, or full sandbox bypass.

## Runtime behavior and gotchas

Project `.codex/` config is inert until Codex trusts the directory. That trust is outside the repository; discern can write the files, but it cannot self-trust a project for the user. Start a fresh session or restart Codex when needed so it loads newly written project config and rules.

`discern_start` can re-aim the long-lived discern MCP server at the new worktree, but it cannot move Codex's shell workspace. The writable-root entry in `.codex/config.toml` reduces the resulting sandbox friction for normal file edits and commands; `.codex/rules/discern.rules` covers the expected `git add`/`git commit` prefixes that write linked-worktree Git metadata under the main checkout.

Because Codex's shell stays put, it will drive the worktree explicitly by prefixing every shell command with `cd <path> &&`, and passing `path` to every discern tool. Edits and the gate then share the worktree root instead of splitting between it and the trunk.

If a Codex session starts inside a worktree and that worktree is later removed, Codex can block the next user message with "Current working directory missing". This Codex runtime limitation remains after `discern_accept` successfully tears down the worktree and re-aims the long-lived MCP server at the main checkout: the Codex chat process can still remember the deleted directory it originally opened. There is no in-chat recovery once Codex blocks the conversation; start a new Codex session from the main checkout instead.

The default writable-root path includes the main checkout directory name. If a developer clones the same repository under a different folder name, run `discern refresh`; it updates `.codex/config.toml` to the local path convention. That update is expected; it keeps the grant narrow instead of widening it to the parent directory.

## See also

- Why discern writes this narrow Codex project config and avoids broader sandbox control ([ADR 0082](../_adr/0082-codex-project-config-writable-root.md)).
