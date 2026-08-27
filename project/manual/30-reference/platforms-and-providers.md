---
id: reference-platforms-and-providers
title: "Platforms and providers"
description: "Look up supported platforms, prerequisites, provider-specific files/hooks, reload needs, identity limits, and secure-random boundary."
order: 80
publish: true
kind: reference
aliases:
  - "prerequisites"
  - "reference-platforms-and-providers"
  - "Secure entropy"
  - "secure random values"
  - "WebCrypto"
  - "random bytes"
  - "Claude Code integration"
  - "Claude Code"
  - "claude"
  - "Anthropic Claude"
  - "Codex integration"
  - "Codex"
  - "OpenAI Codex"
  - "codex cli"
  - "Gemini integration"
  - "Gemini"
  - "Gemini CLI"
  - "Google Gemini"
  - "Cursor integration"
  - "Cursor"
  - "Cursor CLI"
  - "cursor-agent"
  - "Cursor External File Protection"
  - "Cursor Worktree option"
  - "Cursor external edit approvals"
  - "GitHub Copilot integration"
  - "GitHub Copilot"
  - "Copilot"
  - "GitHub Copilot CLI"
  - "Platforms and prerequisites"
  - "platforms"
  - "system requirements"
  - "macOS"
  - "Linux"
  - "Windows"
  - "WSL"
  - "x86_64"
  - "aarch64"
  - "arm64"
  - "identity tokens"
redirect_from:
  - "/docs/orientation/secure-entropy"
  - "/docs/agent-integrations/claude-code"
  - "/docs/agent-integrations/codex"
  - "/docs/agent-integrations/gemini"
  - "/docs/agent-integrations/cursor"
  - "/docs/agent-integrations/github-copilot"
  - "/docs/reference/platforms-and-prereqs"
---

# Platforms and providers

Look up supported platforms, prerequisites, provider-specific files/hooks, reload needs, identity limits, and secure-random boundary.

## Secure entropy

_Production identifiers, nonce values, and key material use WebCrypto through one injectable capability._

### Production source

[`SecureEntropy`](https://github.com/jackwh/discern/blob/main/src/shared/entropy.ts) provides identifier generation and caller-owned byte filling. `SYSTEM_SECURE_ENTROPY` implements those operations with WebCrypto. The contract omits a float-valued random function, so scheduling jitter cannot satisfy a secure-entropy dependency.

Host-facing functions default to the system implementation and pass the selected capability inward. Tests can provide finite deterministic values at the same seams. Production callers still receive WebCrypto unless their trusted boundary supplies another `SecureEntropy` implementation.

### Preserved contracts

Centralizing the source leaves identifier formats, nonce lengths, collision retries, continuation checksums, temporary names, and hash-based message authentication unchanged. The validation key remains 32 bytes. Its directory uses mode `0700`, its file uses mode `0600`, and crash reports use mode `0600`.

### Enforcement

[`SECURE_ENTROPY_PRIMITIVE_BOUNDARIES`](https://github.com/jackwh/discern/blob/main/src/shared/entropy.ts) records each direct WebCrypto operation with its path, function, operation, required security property, and reason. The structural guard binds calls and rows in both directions. An unenrolled call, wrapper, stale row, missing security property, or `Math.random` downgrade fails.

The `secure_entropy_primitive_boundaries` Standard holds this registry at a down-only limit of 2. Secure entropy and scheduling jitter remain separate ([ADR 0348](https://discern.sh/docs/decisions/0348-secure-entropy-is-a-webcrypto-capability)).

## Claude Code integration

_The Claude Code integration supplies shared instructions and Skills, a Model Context Protocol (MCP) server entry, hooks, and project-local permission defaults._

When Claude Code is enabled in `[project].agents`, discern writes or co-manages these project-local files:

| File                    | Role                                             | Ownership             |
| ----------------------- | ------------------------------------------------ | --------------------- |
| `CLAUDE.md`             | Pointer to the canonical agent file              | Generated, committed  |
| `.claude/skills/`       | Materialized Claude Code Skills                  | Generated, gitignored |
| `.mcp.json`             | Project Model Context Protocol (MCP) server      | Shared, tracked       |
| `.claude/settings.json` | Hooks, MCP pre-approval, and permission defaults | Shared, tracked       |

Claude Code may create `.claude/settings.local.json` for machine-local permissions. discern neither seeds nor tracks it. The shipped `.gitignore` keeps it local.

### Instructions and Skills

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so discern writes `CLAUDE.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains canonical. discern compiles its built-in instructions and `[instructions].sources` there. Edit the sources, then run `discern refresh`.

Claude Code does not read the cross-tool `.agents/skills/` directory. discern therefore materializes the effective Skill set into `.claude/skills/` for Claude Code, while other agents can share `.agents/skills/`.

### `.mcp.json`

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

#### Tool discovery

[Claude Code's MCP Tool Search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) is on by default. Sessions begin with tool names and server instructions, then selected schemas arrive after search. This client policy does not change the full definitions returned by MCP `tools/list`.

discern keeps its instructions below Claude Code's 2KB limit and leads with the lifecycle. Start with `discern_status`; its result names the next MCP tool.

The one-hour client timeout reserves 55 minutes for `discern_await` and five for delivery and cancellation. When the watched condition holds, the call returns immediately. A longer watch continues from a 15-character resume handle. This is discern's Claude-and-Copilot budget. Claude Code's [`MCP_TOOL_TIMEOUT`](https://code.claude.com/docs/en/env-vars) defaults to about 28 hours.

### `.claude/settings.json`

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

### Runtime behavior and gotchas

Among the supported providers, Claude Code exposes the worktree lifecycle hook contract. `WorktreeCreate` and `WorktreeRemove` run `discern worktree hook`; `SessionStart` runs `discern worktree ensure`.

`EnterWorktree` re-roots Claude Code's shell and instruction context, but a stdio MCP process keeps its launch cwd. `discern_start` re-aims discern's live MCP root to its new worktree; a native cwd move does not move a generic server.

Claude Code's shell cwd persists across calls, so one `cd` affects later calls. Open or launch the session in the intended worktree when the task must stay isolated.

discern does not emit Claude Code sandbox settings. In discern's recorded provider evidence, Claude Code's native sandbox is the only modeled native agent sandbox that handles linked-worktree Git metadata automatically.

### See also

- Why the worktree-hook payloads are parsed in the binary ([ADR 0040](https://discern.sh/docs/decisions/0040-worktree-hooks-in-the-binary)).
- Why the provider registry is the single source for agent files, Skills, settings, and ignores ([ADR 0043](https://discern.sh/docs/decisions/0043-registry-derived-agent-parity)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## Codex integration

_The Codex integration supplies canonical instructions, shared Skills, a Model Context Protocol (MCP) server entry, hooks, app worktree scripts, and narrow Git rules._

discern's Codex integration is project-local and registry-driven. It writes or co-manages the files below when Codex is enabled in `[project].agents`:

| File                                   | Role                                                 | Ownership             |
| -------------------------------------- | ---------------------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical agent file                                 | Generated, committed  |
| `.agents/skills/`                      | Materialized Agent Skills                            | Generated, gitignored |
| `.codex/config.toml`                   | Codex config and Model Context Protocol (MCP) server | Shared, tracked       |
| `.codex/hooks.json`                    | Session-start hook                                   | Shared, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup/cleanup                     | Shared, tracked       |
| `.codex/rules/discern.rules`           | Narrow Git rules for discern worktrees               | Shared, tracked       |

### Instructions and Skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical agent file. Claude Code and Gemini point back to that file rather than duplicating it. discern generates the file from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Codex also reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled Skills there and creates symbolic links to authored project Skills from `[skills].dir`.

### `.codex/config.toml`

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

`sandbox_workspace_write.writable_roots` is merged with any existing list. The added entry points at the directory where discern creates linked worktrees, so a Codex session that starts in the main checkout can edit and run commands in a new sibling worktree with fewer sandbox prompts. For the default `[worktree].root = ""`, the entry is relative to `.codex/` and looks like `../../<repo>.worktrees`. If `[worktree].root` is relative, discern emits the corresponding path relative to `.codex/`. If `[worktree].root` is absolute, discern keeps it absolute.

When `discern refresh` runs from inside an existing linked worktree, discern asks Git for the main checkout and computes the writable root from that main checkout instead of from the transient worktree directory. This keeps a worktree-local refresh from rewriting the tracked config to `../../<worktree-id>.worktrees`.

discern does not set an MCP `cwd`; Codex starts the project-scoped server from the project root by default, and overriding that can detach the server from the project's `discern.toml`. The startup timeout allows 30 seconds for the local server to start. Codex's [per-tool timeout](https://developers.openai.com/codex/config-reference) defaults to 60 seconds, so discern raises it to one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds. A longer watch continues from the returned 15-character resume handle.

discern does not set `sandbox_mode`, `approval_policy`, `approvals_reviewer`, model settings, network access, `required = true`, MCP tool lists, or tool approval modes. Those are user or project security choices. Restricting tools here could also prevent the CLI fallback or access to future discern tools.

### `.codex/hooks.json`

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

`discern refresh` re-seeds this hook idempotently and preserves unrelated settings and hook groups in the same file. The hook reruns worktree setup when a Codex session opens or resumes inside a discern worktree. Codex gates committed hooks behind its hook trust flow, so the command does not run until the user trusts the hook hash.

### `.codex/environments/environment.toml`

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

### `.codex/rules/discern.rules`

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

This supports the linked-worktree workflow after `discern_start`. The `writable_roots` entry in `.codex/config.toml` covers normal file paths, while the two rules allow staging and committing to write Git metadata under the main checkout's `.git/worktrees` directory. The rules do not allow broad `git`, `git push`, shell wrappers, destructive commands, network access, or full sandbox bypass.

### Runtime behavior and gotchas

Project `.codex/` config is inert until Codex trusts the directory. That trust is outside the repository; discern can write the files, but it cannot self-trust a project for the user. Start a fresh session or restart Codex when needed so it loads newly written project config and rules.

`discern_start` can re-aim the long-lived discern MCP server at the new worktree, but it cannot move Codex's shell workspace. The writable-root entry in `.codex/config.toml` reduces the resulting sandbox friction for normal file edits and commands; `.codex/rules/discern.rules` covers the expected `git add`/`git commit` prefixes that write linked-worktree Git metadata under the main checkout.

Because Codex's shell stays at its original root, drive the worktree explicitly. Prefix every shell command with `cd <path> &&`, and pass `path` to every discern tool. Edits and the Gate then use the same worktree root.

If a Codex session starts inside a worktree and that worktree is later removed, Codex can block the next user message with "Current working directory missing". This Codex runtime limitation remains after `discern_accept` successfully tears down the worktree and re-aims the long-lived MCP server at the main checkout: the Codex chat process can still remember the deleted directory it originally opened. There is no in-chat recovery once Codex blocks the conversation; start a new Codex session from the main checkout instead.

The default writable-root path includes the main checkout directory name. If a developer clones the same repository under a different folder name, run `discern refresh`. It updates `.codex/config.toml` to the local path convention and keeps the grant narrower than the parent directory.

### See also

- Why discern writes this narrow Codex project config and avoids broader sandbox control ([ADR 0082](https://discern.sh/docs/decisions/0082-codex-project-config-writable-root)).

## Gemini integration

_The Gemini integration supplies shared instructions and Skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

discern's Gemini integration is project-local and registry-driven. It writes or co-manages the files below when Gemini is enabled in `[project].agents`:

| File                    | Role                                                       | Ownership             |
| ----------------------- | ---------------------------------------------------------- | --------------------- |
| `GEMINI.md`             | Pointer to the canonical agent file                        | Generated, committed  |
| `.agents/skills/`       | Materialized Agent Skills                                  | Generated, gitignored |
| `.gemini/settings.json` | Model Context Protocol (MCP) server and session-start hook | Shared, tracked       |

Gemini is not in `DEFAULT_AGENTS`; add `"gemini"` to `[project].agents` to emit these artifacts.

### Instructions and Skills

Gemini reads `GEMINI.md` by default, not `AGENTS.md`, so discern writes `GEMINI.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains the canonical agent file. discern generates it from built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Gemini reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled Skills there and creates symbolic links to authored project Skills from `[skills].dir`. Codex, Cursor, and GitHub Copilot use the same directory.

### `.gemini/settings.json`

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
      "args": ["mcp", "--long-tool-calls"],
      "timeout": 3600000
    }
  }
}
```

Gemini infers stdio from the presence of `command`, so discern does not write a `type` field for this server. The hook seed includes `hooksConfig.enabled: true`, the hooks system's canonical toggle. This field sits outside the per-event `hooks` arrays. Gemini requires every key under `hooks` to contain an event array and rejects a boolean there. Without the toggle, Gemini keeps the hook block inert.

Gemini's [MCP server configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md#mcpservers) accepts a request timeout in milliseconds and otherwise defaults to 10 minutes. discern raises it to one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds. A longer watch continues from the returned 15-character resume handle.

discern does not set Gemini sandbox options, model settings, custom commands, `.env` loading, approval defaults, or worktree flags. Those remain user or project choices.

### Runtime behavior and gotchas

Project `.gemini/settings.json` is ignored in Gemini's safe mode until Gemini trusts the folder. That trust grant is outside the repository. Gemini still reads `GEMINI.md` as instructions before trust, but the committed MCP server and hooks do not load until the folder is trusted or the user chooses a bypass such as `--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true`.

Gemini has no mid-session project-root move. `/directory add` can widen the workspace, and the native `--worktree` flag is a launch-time choice, but a running session cannot move its root into a discern worktree. Use `discern start` / `discern_start` to create the worktree, then launch a Gemini session there when commands must run from that root.

The wired hook is a `SessionStart` setup hook only. Gemini does not expose Claude Code's `WorktreeCreate` or `WorktreeRemove` contract, and its `SessionEnd` hook is advisory. discern therefore runs worktree creation and teardown through its CLI and MCP verbs. It does not use `SessionEnd` as teardown authority.

Run `discern refresh` after changing the configured agent set or upgrading the project. This keeps the committed settings aligned with the provider registry.

### See also

- Why `GEMINI.md` is a pointer to `AGENTS.md` ([ADR 0043](https://discern.sh/docs/decisions/0043-registry-derived-agent-parity)).
- Why MCP coverage is explicit in the provider registry ([ADR 0072](https://discern.sh/docs/decisions/0072-typed-mcp-status-forcing-function)).

## Cursor integration

_The Cursor integration supplies canonical instructions, shared Skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

When `[project].agents` includes Cursor, discern uses these project-local files:

| File                 | Role                                       | Ownership                       |
| -------------------- | ------------------------------------------ | ------------------------------- |
| `AGENTS.md`          | Canonical agent file Cursor reads directly | Generated by canonical provider |
| `.agents/skills/`    | Materialized Agent Skills                  | Generated, gitignored           |
| `.cursor/mcp.json`   | Project Model Context Protocol server      | Shared, tracked                 |
| `.cursor/hooks.json` | Session-start hook                         | Shared, tracked                 |

Cursor is not in `DEFAULT_AGENTS`. Setup adds it only when installation evidence is present.

### Using the IDE

Cursor's integrated development environment (IDE) is separate from its terminal agent. `discern setup` detects the [`cursor-agent` terminal agent](https://cursor.com/docs/cli/installation), the editor's `cursor` shell command, or a conventional host-specific application location. Portable AppImages can live anywhere, so nonstandard installs may need explicit configuration.

Add `cursor` under `[project].agents`, then run `discern refresh`:

```toml
[project]
agents = ["cursor"]
```

### Worktrees

#### Local sessions

A Local session stays rooted at its checkout. `discern start` creates a sibling outside that workspace. **External File Protection** can then pause each requested write for human approval. Cursor does not expose that interface pause to the agent process.

To let a Local session write into a sibling discern worktree, turn off External File Protection under **Cursor Settings → Agents → Auto-Run**. This user-wide setting lets Cursor's file tools write outside the open workspace. `discern setup done` reports the current choice but never changes it. Cursor's [agent security guide](https://cursor.com/docs/agent/security) covers the setting. [`.cursor/cli.json` permissions](https://cursor.com/docs/cli/reference/permissions) apply only to the terminal agent.

#### Cursor's Worktree option

To keep External File Protection enabled, select Cursor's native [**Worktree option**](https://cursor.com/docs/configuration/worktrees) when starting the session. Cursor launches the agent inside its checkout. The `sessionStart` hook readies it for discern's normal workflow.

Acceptance removes that checkout. Cursor shows the landing response, then the session ends. Its transcript accepts no follow-up, so start a new session.

#### Project-local discern worktrees

You can instead set `[worktree].root` to keep discern-created worktrees inside the open project:

```toml
[worktree]
root = ".worktrees"
```

Add `/.worktrees/` to the root `.gitignore`. This keeps External File Protection enabled. The sibling default avoids nested checkouts. Run the full Gate and check formatters, linters, indexers, and file watchers for recursive scans. Exclude the directory where needed.

### Instructions and Skills

Cursor reads the root `AGENTS.md` natively, so discern reuses the canonical file instead of emitting a Cursor-specific copy or import pointer. Codex normally emits that file. Claude Code and Gemini import it too.

discern generates `AGENTS.md` from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Cursor also reads `.agents/skills/`. discern materializes bundled Skills there and creates symbolic links to authored project Skills from `[skills].dir`. Codex, Gemini, and GitHub Copilot share it.

### Model Context Protocol configuration

`discern refresh` co-manages `.cursor/mcp.json` for the Model Context Protocol (MCP) and preserves other servers and top-level keys. The discern-owned entry is:

```json
{
  "mcpServers": {
    "discern": {
      "type": "stdio",
      "command": "discern",
      "args": ["mcp", "--strict-tool-calls"]
    }
  }
}
```

Cursor requires `type: "stdio"`. Its entry matches Claude Code and GitHub Copilot's shape but lives in `.cursor/mcp.json`.

#### Logbook identity

Cursor declares `cursor-vscode`. The catalog recognizes that exact name and has no `cursor-*` prefix rule. New name-only calls carry a Cursor `mcp-client` signal.

Readers also classify retained raw metadata, so `discern patterns` attributes old `cursor-vscode` events without rewriting them. Unknown names stay in the identity-gap finding.

Setup detection remains separate: it checks `cursor-agent`, the editor command, and known application paths. MCP identity is advisory and selects no setup, timeout, Gate path, or landing authority.

#### Model Context Protocol call duration

Cursor does not use one MCP timeout across all of its surfaces. In the Cursor Agent CLI (`agent` / `cursor-agent`) and `agent acp`, each `tools/call` currently has an effective 60-second wall-clock limit. Cursor invokes the MCP TypeScript SDK without overriding its 60-second default, so `notifications/progress` do not renew the timer. Cursor exposes no supported per-server setting for changing this limit. [Cursor support confirms the CLI and ACP behavior](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925/5).

The editor's IDE Agent follows a different path. Cursor support reports its timeout as around 60 minutes, but Cursor publishes no precise maximum. The Agents Window and cloud-agent limits remain unverified.

The editor and CLI read the same project `.cursor/mcp.json`. discern does not use advisory MCP client names to choose behavior, so the generated entry selects the shortest verified transport profile. `discern_await` uses 45-second calls, leaving 15 seconds for result delivery. When the condition has not been met, the result carries a 15-character continuation handle and `--resume` command that preserve the original watch. Continue until the condition holds, the user stops the watch, or the task no longer needs the dependency.

### `.cursor/hooks.json`

The discern-owned Cursor hook seed is:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "discern worktree ensure"
      }
    ]
  }
}
```

`discern refresh` re-seeds this hook idempotently and preserves unrelated groups. The hook reruns worktree setup for sessions opened or resumed inside a discern worktree.

discern does not set Cursor sandbox options, static command permission lists, model settings, or approval defaults. Those remain user or project choices.

### Runtime behavior and gotchas

Cursor workspace trust gates committed `.cursor/` config. The MCP server can also require per-tool approval on first use. For headless runs, `--approve-mcps` bypasses the MCP approval prompt, but it does not replace workspace trust.

Skill-loading behavior varies across Cursor CLI versions. When diagnosing a missing Skill in the CLI, verify the installed `cursor-agent` version before treating the materialized directory as stale.

### See also

- Why Cursor emits no provider-specific agent file ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)).
- Why Cursor shares the same stdio MCP JSON writer shape as Claude Code and GitHub Copilot ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## GitHub Copilot integration

_The GitHub Copilot integration supplies canonical instructions, shared Skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

discern's GitHub Copilot integration is project-local and registry-driven. It writes, co-manages, or relies on the files below when GitHub Copilot is enabled in `[project].agents`:

| File                         | Role                                        | Ownership                       |
| ---------------------------- | ------------------------------------------- | ------------------------------- |
| `AGENTS.md`                  | Canonical agent file Copilot reads directly | Generated by canonical provider |
| `.agents/skills/`            | Materialized Agent Skills                   | Generated, gitignored           |
| `.mcp.json`                  | Project Model Context Protocol (MCP) server | Shared, tracked                 |
| `.github/hooks/discern.json` | Session-start hook                          | Shared, tracked                 |

GitHub Copilot is not in `DEFAULT_AGENTS`; add `"copilot"` to `[project].agents` to wire its provider-specific config.

### Using the IDE

An editor-only installation runs inside an integrated development environment (IDE). GitHub Copilot currently declares no IDE installation evidence, so `discern setup` sees it only when the `copilot` terminal CLI is on `PATH`. Add `copilot` explicitly under `[project].agents`, then run `discern refresh`:

```toml
[project]
agents = ["copilot"]
```

If the project already lists other agents, include `copilot` in that same array. Use explicit configuration for an editor-only install.

### Instructions and Skills

The Copilot CLI reads `AGENTS.md` natively as its primary instruction file, so discern models it as reuse-canonical. It does not emit a Copilot-specific Instruction file or write an import pointer. Copilot reads the same canonical `AGENTS.md` emitted by the canonical provider, normally Codex, and imported by Claude Code and Gemini.

discern generates `AGENTS.md` from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Copilot also reads the cross-tool Agent Skills directory `.agents/skills/`. discern materializes bundled Skills there and creates symbolic links to authored project Skills from `[skills].dir`. Codex, Gemini, and Cursor use the same directory.

### `.mcp.json`

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

Copilot and Claude Code co-own this file. Both providers write the same byte-identical `discern` entry through one shared writer. The second provider detects the identical entry and writes nothing.

Copilot's [MCP server configuration](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration) accepts a tool-call timeout in milliseconds but publishes no default or maximum. discern sets one hour. `discern_await` uses up to 55 minutes and returns immediately when its condition holds; a longer watch continues from the returned 15-character resume handle.

discern does not write `.github/mcp.json` for Copilot because the Copilot CLI does not use that file for this project's MCP server. It also does not write Claude Code's `enabledMcpjsonServers` pre-approval key for Copilot. Copilot uses folder trust instead.

### `.github/hooks/discern.json`

The discern-owned Copilot hook seed is:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "discern worktree ensure",
        "timeoutSec": 30
      }
    ]
  }
}
```

`discern refresh` re-seeds this hook idempotently and preserves unrelated Copilot hook files. Copilot loads `.github/hooks/*.json`, so discern keeps its hook in a dedicated file rather than merging into a broader project hook file.

discern does not set Copilot sandbox options, tool approval defaults, model settings, path grants, or network settings. Those remain user or project choices.

### Runtime behavior and gotchas

Committed Copilot config is inert until the folder is trusted. The trust grant is stored outside the repository in `~/.copilot/config.json` `trustedFolders`. For unattended runs, the provider registry names `--allow-all-tools` and `--allow-all-paths` as headless bypasses.

Copilot can move a running session with `/cwd` and can create and enter a native worktree with `/worktree`. It still does not expose a worktree create/remove hook contract for discern to drive. discern owns its own worktree lifecycle through `discern start`, `discern update`, and `discern accept`.

Copilot's `sessionStart` hook can fire per prompt in interactive mode. `discern worktree ensure` is idempotent, so repeated hook calls preserve the resulting state.

Copilot's local sandbox and pre-tool hooks are separate vendor features. discern does not configure them today. The provider integration is limited to instructions, Skills, MCP, and the session-start setup hook.

### See also

- Why Copilot emits no provider-specific agent file ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## Platforms and prerequisites

_The release targets and local tools discern requires, followed by identity selectors and worktree command tokens._

### Supported release targets

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

There is no native Windows release. Run the Linux binary inside Windows Subsystem for Linux (WSL). The installer rejects other operating systems and architectures before downloading an asset. Release CI verifies the WSL path: a release-blocking job runs the full repository gate inside WSL 2 Ubuntu on a hosted Windows runner before every publication ([ADR 0278](https://discern.sh/docs/decisions/0278-wsl-support-is-proven-by-a-hosted-wsl2-gate-lane)).

### Required tools

| Context                    | Requirement                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Download installer         | POSIX `sh`, `uname`, `mktemp`, standard file utilities, `sha256sum` or `shasum`, and `curl` or `wget`. |
| Install destination        | A writable directory. On macOS, the installer tries writable `/usr/local/bin` before `~/.local/bin`.   |
| discern runtime            | `sh` and `git` on `PATH`. Configured Gate and resource commands run through `sh -c`.                   |
| Isolated-worktree workflow | A git repository whose project root is the repository root, with at least 1 commit to branch from.     |
| Project checks             | Every executable named by jobs, standards, setup steps, and resource commands available on `PATH`.     |

The released binary is self-contained. A project does not need Deno or Node to run discern. Setup can create files outside a git repository, but `discern start` remains unavailable until the project is a repository with a first commit.

Run the live prerequisite and install checks from any directory inside the project:

```sh
discern doctor
```

`doctor` checks root discovery, configuration, schema, tools, repository shape, jobs, resources, Instructions, Skills, integrations, and the managed `.gitattributes` block. It asks Git for every canonical tracked generated path's effective merge attribute through the NUL-delimited protocol and, in linked worktrees, verifies the driver is worktree-local. It reports overrides, scope, and origin but never repairs rules or configuration. For each `[generated.<name>]`, it probes `run`'s leading word and warns when `paths` match no tracked file, only untracked or ignored files, or another group's files. It never runs generators. Warnings keep exit 0. Failures name a fix.

### Installer behavior

The installer's `DISCERN_*` inputs are listed in [Environment variables](environment-variables.md#installation). `NO_COLOR` disables styled installer output when set.

The installer makes up to three download attempts for transient failures. It places the binary and its `.sha256` file in a staging directory beside the install destination, so the final rename stays on one filesystem. It verifies the checksum before replacing an existing installation. If the installed command does not resolve on `PATH`, the installer prints a persistent shell-profile fix. It does not print the setup handoff until `discern` is directly usable.

After installation, discern itself makes no network calls. Project commands remain free to use the network because they belong to the project.

### Worktree identity selectors

Run `discern identity` in the main checkout or a linked worktree. With no selector it prints the id.

| Selector            | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `--id`              | Stable checkout id.                                                                |
| `--branch`          | Full worktree branch name or configured trunk branch.                              |
| `--port`            | Deterministic development port, `17290 + cksum(id) % 2000`.                        |
| `--seed`            | Deterministic test-order seed, the POSIX `cksum` of the full branch name.          |
| `--site`            | Domain Name System (DNS) compatible project slug plus id, fitted to 63 characters. |
| `--db`              | Database-compatible project slug plus id, using underscores.                       |
| `--worktree`        | Generic project-slug-plus-id handle.                                               |
| `--resource <name>` | Stable project-slug-plus-id-plus-name handle for one declared resource.            |
| `--resources`       | Every declared resource printed as `name=handle`.                                  |

For example:

```sh
discern identity --resource database
```

Linked identity checks the [id override](environment-variables.md#worktree-identity), env files, then Git metadata; main identity uses the configured trunk. A path argument inspects either checkout kind.

### Worktree env files

`[worktree].env_files` defaults to `.env` followed by `.env.local`; the last file defining a key wins. `[worktree].inherit_env` names values copied from the main checkout. The lifecycle writes the public values listed under [Worktree environment](environment-variables.md#worktree-environment) when their conditions apply. Resource commands receive the same handles in their process environment even when no env file exists. `discern identity --resource <name>` reports the resource handle directly.

### Worktree command tokens

discern replaces these literal tokens before running a resource command or a `[worktree.setup]` command:

| Token            | Replacement                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `@db@`           | Database-compatible worktree identity.                                                    |
| `@site@`         | DNS-compatible worktree host label.                                                       |
| `@port@`         | Deterministic worktree port.                                                              |
| `@worktree@`     | Generic worktree handle.                                                                  |
| `@resource@`     | Current resource's handle; empty in setup commands that are not attached to one resource. |
| `@project_slug@` | Configured project slug.                                                                  |
| `@dir@`          | Absolute worktree root.                                                                   |

Token replacement is literal and happens only for tokens present in the command. Use `@site@` when the destination requires a 63-character DNS label. `@resource@` has no DNS length limit.
