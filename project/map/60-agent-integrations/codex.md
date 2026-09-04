---
title: Codex
description: How discern configures instructions, Skills, MCP, hooks, worktree setup, and Git rules for Codex.
order: 20
aliases:
  - Codex
  - OpenAI Codex
  - codex cli
---

# Codex integration

_The Codex integration supplies canonical instructions, shared skills, a Model Context Protocol (MCP) server entry, hooks, app worktree scripts, and narrow Git rules._

discern's Codex integration is project-local and registry-driven. It writes or co-manages the files below when Codex is enabled in `[project].agents`:

| File                                   | Role                                                 | Ownership             |
| -------------------------------------- | ---------------------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical agent file                                 | Generated, committed  |
| `.agents/skills/`                      | Materialized Agent Skills                            | Generated, gitignored |
| `.codex/config.toml`                   | Codex config and Model Context Protocol (MCP) server | Shared, tracked       |
| `.codex/hooks.json`                    | Session-start hook                                   | Shared, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup/cleanup                     | Shared, tracked       |
| `.codex/rules/discern.rules`           | Narrow Git rules for discern worktrees               | Shared, tracked       |

## Instructions and Skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical agent file. Claude Code and Gemini point back to that file rather than duplicating it. discern generates the file from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Codex also reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled skills there and creates symbolic links to authored project skills from `[skills].dir`.

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

`project_doc_max_bytes` is set only when the project has not chosen its own value. The 65,536-byte value raises Codex's default instruction-file limit for discern-generated instructions.

`sandbox_workspace_write.writable_roots` is merged with any existing list. discern adds the configured worktree root: for `[worktree].root = ""` it is relative to `.codex/` and looks like `../../<repo>.worktrees`; another relative value is rewritten relative to `.codex/`; an absolute configured value stays absolute. discern never broadens that grant to `../..`. Because Codex has no machine-local project layer for this setting, differently named clones can produce tracked-value churn; run `discern refresh` in the active clone and review the added root.

When `discern refresh` runs from inside an existing linked worktree, discern asks Git for the main checkout and computes the writable root from that main checkout instead of from the transient worktree directory. This keeps a worktree-local refresh from rewriting the tracked config to `../../<worktree-id>.worktrees`.

discern does not set an MCP `cwd`; Codex starts the project-scoped server from the project root by default, and overriding that can detach the server from the project's `discern.toml`. The startup timeout allows 30 seconds for the local server to start. Codex's [per-tool timeout](https://developers.openai.com/codex/config-reference) defaults to 60 seconds, so discern raises it to one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds. A longer watch continues from the returned 15-character resume handle.

discern does not set `sandbox_mode`, `approval_policy`, `approvals_reviewer`, model settings, network access, `required = true`, MCP tool lists, or tool approval modes. Those are user or project security choices. Restricting tools here could also prevent the CLI fallback or access to future discern tools.

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
            "command": "discern worktree ensure",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

`discern refresh` re-seeds this hook idempotently and preserves unrelated settings and hook groups in the same file. The hook reruns worktree setup when a Codex session opens or resumes inside a discern worktree. Codex gates committed hooks behind its hook trust flow, so the command does not run until the user trusts the hook hash.

## `.codex/environments/environment.toml`

The Codex app has its own worktree environment file. discern co-manages only the worktree lifecycle scripts and preserves the app's other keys:

```toml
version = 1
name = "<project name>"

[setup]
script = "discern worktree ensure"

[cleanup]
script = "discern worktree teardown"
```

`version` and `name` are written only when absent; a new file takes `name` from `[project].name` (with the normal project display-name fallback), while an app-created file keeps its values. Missing or still-default discern scripts are re-emitted on refresh because the Codex app can regenerate this file; user-customized script values are preserved. Uninstall recognizes a discern-created shell by its generated marker rather than a hard-coded environment name.

This file is for Codex-app-managed worktrees. discern's own sibling worktrees still come from `discern start` / `discern_start` and the worktree lifecycle verbs.

## `.codex/rules/discern.rules`

Codex loads this project rules file after the project is trusted. The rules are command-prefix grants with no working-directory boundary. discern writes its own file rather than mutating user-owned files such as `.codex/rules/default.rules`.

The generated rules file allows only these prefixes:

```toml
prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow the git add command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = ["git add -A", "git add src/example.ts"],
    not_match = ["git status", "git push", "git reset --hard"],
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow the git commit command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = ["git commit -m Example", "git commit --amend --no-edit", "git commit --no-verify -m Example"],
    not_match = ["git status", "git push", "git reset --hard"],
)
```

The exact prefixes include trailing arguments such as `git add -A`, `git commit --amend`, and `git commit --no-verify`. They do not grant broad `git`, `git push`, `git reset`, shell wrappers, network access, or sandbox bypass. Their `match` and `not_match` examples are validated when Codex loads the rules.

## Runtime behavior and gotchas

Project `.codex/` config is inert until user-level `~/.codex/config.toml` records `projects."<absolute-project-path>".trust_level = "trusted"`. That absolute-path trust is outside the repository; discern can write project files but cannot self-trust the project. Start a fresh session or restart Codex when needed so it loads newly written config and rules.

`discern_start` can re-aim the long-lived discern MCP server at the new worktree, but it cannot move Codex's shell workspace. The writable-root entry grants the configured worktree directory; the rules separately grant only the `git add` and `git commit` command prefixes, wherever that trusted session invokes them.

Because Codex's shell stays at its original root, drive the worktree explicitly. Prefix every shell command with `cd <path> &&`, and pass `path` to every discern tool. Edits and the gate then use the same worktree root.

If a Codex session starts inside a worktree and that worktree is later removed, Codex can block the next user message with "Current working directory missing". This Codex runtime limitation remains after `discern_accept` successfully tears down the worktree and re-aims the long-lived MCP server at the main checkout: the Codex chat process can still remember the deleted directory it originally opened. There is no in-chat recovery once Codex blocks the conversation; start a new Codex session from the main checkout instead.

The default writable-root path includes the main checkout directory name. If a developer clones the same repository under a different folder name, run `discern refresh`. It updates `.codex/config.toml` to the local path convention and keeps the grant narrower than the parent directory.

## See also

- Why discern writes this narrow Codex project config and avoids broader sandbox control ([ADR 0082](../_adr/0082-codex-project-config-writable-root.md)).
