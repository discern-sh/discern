# Codex integration

discern's Codex integration is project-local and registry-driven. It writes or
co-manages the files below when Codex is enabled in `[guidance].agents`:

| File                                   | Role                                      | Ownership             |
| -------------------------------------- | ----------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical compiled guidance file          | Generated, gitignored |
| `.agents/skills/`                      | Materialized Agent Skills                 | Generated, gitignored |
| `.codex/config.toml`                   | Project Codex config and MCP server entry | Co-managed, tracked   |
| `.codex/hooks.json`                    | Session-start hook                        | Seeded, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup/cleanup          | Co-managed, tracked   |

## Guidance and skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical compiled
agent file. Claude Code and Gemini point back to that file rather than
duplicating it. The file is generated from discern's built-in guidance plus the
project's `[guidance].sources`; edit the sources and run `discern refresh`,
never edit `AGENTS.md` by hand.

Codex also reads the cross-tool Agent Skills directory `.agents/skills/`.
discern materializes bundled skills there and symlinks authored project skills
from `[skills].dir`.

## `.codex/config.toml`

`discern refresh` co-manages `.codex/config.toml` with a comment-preserving TOML
editor. It preserves other servers, other top-level settings, comments, and
existing writable roots. The resulting discern-owned shape is:

```toml
project_doc_max_bytes = 65536

[sandbox_workspace_write]
writable_roots = ["../../<repo>.worktrees"]

[mcp_servers.discern]
command = "discern"
args = ["mcp"]
cwd = ".."
startup_timeout_sec = 30
tool_timeout_sec = 3600
```

`project_doc_max_bytes` is set only when the project has not chosen its own
value. It gives discern-generated instructions more headroom than Codex's
default instruction-file limit.

`sandbox_workspace_write.writable_roots` is merged with any existing list. The
added entry points at the directory where discern creates linked worktrees, so a
Codex session that starts in the main checkout can edit and run commands in a
new sibling worktree with fewer sandbox prompts. For the default
`[worktree].root = ""`, the entry is relative to `.codex/` and looks like
`../../<repo>.worktrees`. If `[worktree].root` is relative, discern emits the
corresponding path relative to `.codex/`. If `[worktree].root` is absolute,
discern keeps it absolute.

When `discern refresh` runs from inside an existing linked worktree, discern
asks Git for the main checkout and computes the writable root from that main
checkout instead of from the transient worktree directory. This keeps a
worktree-local refresh from rewriting the tracked config to
`../../<worktree-id>.worktrees`.

`mcp_servers.discern.cwd = ".."` starts `discern mcp` at the repository root
because Codex resolves relative project-config paths from `.codex/`. The startup
timeout gives slower local starts a little room, and the tool timeout is long
enough for `discern_finish`, `discern_test`, and ratchets.

discern does not set `sandbox_mode`, `approval_policy`, `approvals_reviewer`,
model settings, network access, `required = true`, MCP tool lists, or tool
approval modes. Those are user or project security choices, and several would
make the CLI fallback or future discern tools more brittle.

## `.codex/hooks.json`

The seeded Codex hook is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree:ensure"
          }
        ]
      }
    ]
  }
}
```

The hook is idempotent. It keeps a Codex session re-ready when opened or resumed
inside a discern worktree. Codex still gates committed hooks behind its hook
trust flow, so the command does not run until the user trusts the hook hash.

## `.codex/environments/environment.toml`

The Codex app has its own worktree environment file. discern co-manages only the
worktree lifecycle scripts and preserves the app's other keys:

```toml
version = 1
name = "Discern"

[setup]
script = "discern worktree:ensure"

[cleanup]
script = "discern worktree:teardown"
```

`version` and `name` are written only when absent, so an app-created file keeps
the app's values. `[setup]` and `[cleanup]` are re-emitted on every refresh
because the Codex app can regenerate this file.

This file is for Codex-app-managed worktrees. discern's own sibling worktrees
still come from `discern start` / `discern_start` and the worktree lifecycle
verbs.

## Runtime behavior and gotchas

Project `.codex/` config is inert until Codex trusts the directory. That trust
is outside the repository; discern can write the files, but it cannot self-trust
a project for the user.

`discern_start` can re-aim the long-lived discern MCP server at the new
worktree, but it cannot move Codex's shell workspace. The writable-root entry in
`.codex/config.toml` reduces the resulting sandbox friction for normal file
edits and commands.

The writable-root entry does not make linked-worktree Git metadata writable.
Codex protects `.git` paths inside writable roots, including a linked worktree's
`.git` pointer and the resolved shared Git directory. Git operations such as
committing from the linked worktree can still need approval or a session whose
workspace is already the worktree.

The default writable-root path includes the main checkout directory name. If a
developer clones the same repository under a different folder name, run
`discern refresh`; it updates `.codex/config.toml` to the local path convention.
That update is expected; it keeps the grant narrow instead of widening it to the
whole parent directory.

## See also

- [ADR 0082](../_adr/0082-codex-project-config-writable-root.md) - why discern
  writes this narrow Codex project config and avoids broader sandbox control.
