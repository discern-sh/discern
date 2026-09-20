---
id: reference-platforms-and-providers
title: "Platforms and providers"
description: "Check supported computers and coding tools, required software, integration files, and steps to activate each tool."
order: 70
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
  - "WSL 2"
  - "x86_64"
  - "aarch64"
  - "arm64"
  - "identity tokens"
---

# Platforms and providers

Check whether your machine and coding tool can use discern, then find the files or activation details for that tool. To add a tool to an existing project, follow [Connect a coding agent](../10-guides/connect-a-coding-agent.md).

Start with [platforms and prerequisites](#platforms-and-prerequisites) or choose your tool: [Claude Code](#claude-code-integration), [Codex](#codex-integration), [Gemini CLI](#gemini-integration), [Cursor](#cursor-integration), or [GitHub Copilot CLI](#github-copilot-integration).

The [provider matrix](#provider-matrix) compares file locations and call limits. discern writes project-local integration files; your coding tool owns its user-level trust settings.

## Platforms and prerequisites

discern runs on macOS and Linux. On Windows, use WSL 2. The binary includes its own runtime; the project still needs the tools used by its checks.

### Supported release targets

<!-- BEGIN GENERATED BUILD TARGETS -->

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

<!-- END GENERATED BUILD TARGETS -->

There is no native Windows release. On Windows, run the Linux binary inside WSL 2. The installer rejects unsupported operating systems and architectures before downloading an asset.

### Required tools

| Context                    | Requirement                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Download installer         | POSIX `sh`, `uname`, `mktemp`, standard file utilities, `sha256sum` or `shasum`, and `curl` or `wget`.                         |
| Install destination        | A writable directory. On macOS, the installer uses `DISCERN_BIN_DIR`, writable existing `/usr/local/bin`, then `~/.local/bin`. |
| discern runtime            | `git` and a POSIX `sh` on `PATH`. Configured gate and resource commands run through `sh -c`.                                   |
| Isolated-worktree workflow | A git repository whose project root is the repository root, with at least 1 commit to branch from.                             |
| Project checks             | Every executable named by jobs, standards, setup steps, and resource commands available on `PATH`.                             |

The released binary is self-contained. A project does not need Deno or Node to run discern. Setup can create files outside a git repository, but `discern start` remains unavailable until the project is a repository with a first commit.

Run the live prerequisite and install checks from any directory inside the project:

```sh
discern doctor
```

Doctor checks configuration, required tools, integrations, and the project setup without repairing files or running generators. Its result explains any problem and the next action. [Setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) helps when those checks fail.

### Installer behavior

The installer's `DISCERN_*` inputs are listed in [Environment variables](environment-variables.md#installation). `NO_COLOR` disables styled installer output when set.

The installer accepts a bare or `v`-prefixed `DISCERN_VERSION` and normalizes either form to the `v`-prefixed release tag. It makes up to three download attempts for transient failures. It refuses when the final `discern` destination is a directory. On macOS, it never selects `/opt/homebrew/bin`; Homebrew owns that prefix.

The installer places the binary and its `.sha256` file in a `.discern-install.*` staging directory beside the install destination, so the final rename stays on one filesystem. Its traps remove that directory after ordinary completion, failure, or a signal the shell can handle. A forced process kill that bypasses those traps, or a power loss, can leave the staging directory behind. When no installer is running, it is safe to remove that residue from the selected bin directory. The installer verifies the checksum before replacing an existing installation. If the installed command does not resolve on `PATH`, it prints a persistent shell-profile fix. It does not print the setup handoff until `discern` is directly usable.

After installation, discern itself makes no network calls. Project commands remain free to use the network because they belong to the project.

### Verify a release download

Choose `TAG` and the `ASSET` for your system from the generated target table above. Download the binary and its checksum sidecar from the release:

```sh
TAG=vX.Y.Z
ASSET=discern-aarch64-apple-darwin
gh release download "$TAG" --repo discern-sh/discern \
  --pattern "$ASSET" --pattern "$ASSET.sha256"
```

Verify the checksum before running the binary. Use the command for your system:

```sh
# macOS
shasum -a 256 -c "$ASSET.sha256"

# GNU/Linux and WSL 2
sha256sum -c "$ASSET.sha256"
```

Verify GitHub's build-provenance attestation for the binary and its sidecar:

```sh
gh attestation verify "$ASSET" --repo discern-sh/discern
gh attestation verify "$ASSET.sha256" --repo discern-sh/discern
```

For a macOS asset, verify the Developer ID signature and the notarization requirement used by the release workflow:

```sh
codesign --verify --strict --verbose=2 "$ASSET"
codesign -dv --verbose=4 "$ASSET" 2>&1 | grep 'Authority=Developer ID Application:'
codesign -vvvv -R="notarized" --check-notarization "$ASSET"
```

All commands must succeed. The `codesign -dv` output must name a Developer ID Application authority. The provenance commands require a public release and GitHub CLI authentication appropriate for attestation verification.

### Worktree identity selectors

A task's worktree has an identity used for its development port and resource names. `discern identity` reads it. See [Worktrees and status](worktrees-and-status.md#read-the-derived-identity) for every selector and its exact value.

### Worktree env files

Your project chooses which environment values each task inherits and where to write them. [Worktrees and status](worktrees-and-status.md#inherit-selected-env-values) gives file precedence and resource behavior; [Environment variables](environment-variables.md) lists the exported values.

### Worktree command tokens

Resource and setup commands can use tokens such as `@port@` and `@dir@` for values that differ by worktree. The [worktree reference](worktrees-and-status.md#use-tokens-during-setup) lists the tokens and their replacement rules.

## Provider matrix

| Provider       | Launcher       | Agent file            | Skills            | MCP config              | Hook config                  | Trust required                                  | Tool / await budget        |
| -------------- | -------------- | --------------------- | ----------------- | ----------------------- | ---------------------------- | ----------------------------------------------- | -------------------------- |
| Claude Code    | `claude`       | `CLAUDE.md` pointer   | `.claude/skills/` | `.mcp.json`             | `.claude/settings.json`      | Workspace trust, then named server pre-approval | 3,600s / 3,300s            |
| Codex          | `codex`        | canonical `AGENTS.md` | `.agents/skills/` | `.codex/config.toml`    | `.codex/hooks.json`          | Directory trust and hook-hash approval          | 3,600s / 3,300s            |
| Gemini         | `gemini`       | `GEMINI.md` pointer   | `.agents/skills/` | `.gemini/settings.json` | same file                    | Workspace trust; hooks enabled by default       | 3,600s / 3,300s            |
| Cursor         | `cursor-agent` | canonical `AGENTS.md` | `.agents/skills/` | `.cursor/mcp.json`      | `.cursor/hooks.json`         | Workspace and first-use tool approval           | 60s shortest surface / 45s |
| GitHub Copilot | `copilot`      | canonical `AGENTS.md` | `.agents/skills/` | `.mcp.json`             | `.github/hooks/discern.json` | Folder trust                                    | 3,600s / 3,300s            |

Every provider's activation check calls `discern_status` (Claude Code and Codex expose it as `mcp__discern__discern_status`). Removing a provider from the machine does not change who owns its files. Coding tools outside this table have no supported discern configuration, skill location, trust instructions, or MCP timeout.

The final column gives each provider's MCP call limit and the longest `discern_await` request. Most providers allow an MCP call to run for 3,600 seconds. `discern_await` uses at most 3,300 seconds, leaving 5 minutes for the provider to deliver the result. Cursor has the shorter limits shown in the table.

Session hooks have a separate 600-second limit. Gemini records that value as 600,000 milliseconds; the other providers use seconds. `discern refresh` updates the settings discern owns to the current format for each coding tool and keeps unrelated settings unchanged. The file locations and ownership rules do not change when those formats change.

Third-party product names and trademarks in this reference belong to their respective owners. discern uses them to identify supported integrations, which implies no affiliation or endorsement.

## Clones without discern

Git keeps the agent instruction files and provider configuration. It does not keep the generated skill folders: Claude Code uses `.claude/skills/`, while Codex, Gemini, Cursor, and GitHub Copilot use `.agents/skills/`. After cloning onto a machine without discern, install the binary, run `discern refresh`, and open a new coding-agent session. The refresh recreates the skill folders and updates discern's provider settings before the new session reads them.

## Claude Code integration

_The Claude Code integration supplies shared instructions and skills, a Model Context Protocol (MCP) server entry, and worktree hooks without adding permission rules._

When Claude Code is enabled in `[project].agents`, discern writes or co-manages these project-local files:

| File                    | Role                                        | Ownership             |
| ----------------------- | ------------------------------------------- | --------------------- |
| `CLAUDE.md`             | Pointer to the canonical agent file         | Generated, committed  |
| `.claude/skills/`       | Materialized Claude Code skills             | Generated, gitignored |
| `.mcp.json`             | Project Model Context Protocol (MCP) server | Shared, tracked       |
| `.claude/settings.json` | Hooks and named MCP pre-approval            | Shared, tracked       |

Claude Code may create `.claude/settings.local.json` for machine-local permissions. discern neither seeds nor tracks it. The shipped `.gitignore` keeps it local.

### Instructions and Skills

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so discern writes `CLAUDE.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains canonical. discern compiles its built-in instructions and `[instructions].sources` there. Edit the sources, then run `discern refresh`.

Claude Code does not read the cross-tool `.agents/skills/` directory. discern therefore materializes the effective skill set into `.claude/skills/` for Claude Code, while other agents can share `.agents/skills/`.

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

The Claude Code settings seed includes the worktree hooks and no permission rules:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
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
            "command": "discern worktree hook create",
            "timeout": 600
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree hook remove",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

`discern refresh` adds or updates discern's hooks without changing other hooks or permission rules. It also adds `discern` to `enabledMcpjsonServers`. Once the workspace is trusted, Claude Code can start that named local server without another server-approval prompt. Claude Code still applies its normal permissions when the server calls a tool.

### Runtime behavior and gotchas

Among the supported providers, Claude Code exposes the worktree lifecycle hook contract. `WorktreeCreate` and `WorktreeRemove` run `discern worktree hook`; `SessionStart` runs `discern worktree ensure`.

Claude Code sends `name` and `cwd` when it asks discern to create a worktree, and sends `worktree_path` when it removes one. Extra fields are ignored. If the create request omits a required value or supplies the wrong type, discern refuses it with an error. Removal remains best effort so a cleanup problem cannot strand Claude Code's own removal.

`EnterWorktree` re-roots Claude Code's shell and instruction context, but a stdio MCP process keeps its launch cwd. `discern_start` re-aims discern's live MCP root to its new worktree; a native cwd move does not move a generic server.

Claude Code's shell cwd persists across calls, so one `cd` affects later calls. Open or launch the session in the intended worktree when the task must stay isolated.

discern does not emit Claude Code sandbox settings. In discern's recorded provider evidence, Claude Code's native sandbox is the only modeled native agent sandbox that handles linked-worktree Git metadata automatically.

### See also

- Why the worktree-hook payloads are parsed in the binary ([ADR 0040](https://discern.sh/docs/decisions/0040-worktree-hooks-in-the-binary)).
- Why the provider registry is the single source for agent files, skills, settings, and ignores ([ADR 0043](https://discern.sh/docs/decisions/0043-registry-derived-agent-parity)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## Codex integration

_The Codex integration supplies canonical instructions, shared skills, a Model Context Protocol (MCP) server entry, hooks, app worktree scripts, and narrow Git rules._

discern's Codex integration is project-local and registry-driven. It writes or co-manages the files below when Codex is enabled in `[project].agents`:

| File                                   | Role                                                 | Ownership             |
| -------------------------------------- | ---------------------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical agent file                                 | Generated, committed  |
| `.agents/skills/`                      | Materialized Agent skills                            | Generated, gitignored |
| `.codex/config.toml`                   | Codex config and Model Context Protocol (MCP) server | Shared, tracked       |
| `.codex/hooks.json`                    | Session-start hook                                   | Shared, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup/cleanup                     | Shared, tracked       |
| `.codex/rules/discern.rules`           | Narrow Git rules for discern worktrees               | Shared, tracked       |

### Instructions and Skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical agent file. Claude Code and Gemini point back to that file rather than duplicating it. discern generates the file from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Codex also reads the cross-tool Agent skills directory `.agents/skills/`. discern materializes bundled skills there and creates symbolic links to authored project skills from `[skills].dir`.

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

`sandbox_workspace_write.writable_roots` keeps its existing values and gains the folder where discern creates worktrees. With the default `[worktree].root = ""`, the path is relative to `.codex/` and looks like `../../<repo>.worktrees`. Another relative value is adjusted from the same starting point, while an absolute value stays absolute. discern never replaces it with the broader `../..` path. Different clone directory names can make `discern refresh` update the tracked path; review that change before committing it.

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

### `.codex/environments/environment.toml`

The Codex app has its own worktree environment file. discern co-manages only the worktree lifecycle scripts and preserves the app's other keys:

```toml
version = 1
name = "<project name>"

[setup]
script = "discern worktree ensure"

[cleanup]
script = "discern worktree teardown"
```

discern adds `version` and `name` only when they're missing. A new file uses the project's configured name, or the name discern already displays for the project. An existing Codex file keeps its values. `discern refresh` restores missing setup and cleanup scripts, but keeps scripts the project has customized. A marker in a discern-created file lets uninstall recognize it without relying on the environment name.

This file is for Codex-app-managed worktrees. discern's own sibling worktrees still come from `discern start` / `discern_start` and the worktree lifecycle verbs.

### `.codex/rules/discern.rules`

Codex loads this rules file after the project is trusted. Each rule allows a command that begins with the listed words, wherever Codex runs it. discern writes a separate file and leaves project files such as `.codex/rules/default.rules` unchanged.

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

### Runtime behavior and gotchas

Codex ignores project `.codex/` settings until its user-level configuration marks the project's absolute path as trusted. That decision stays outside the repository, and discern cannot make it for you. Start a new session or restart Codex after changing the project settings or trust state.

`discern_start` points the running discern MCP server at the new worktree, but it cannot move Codex's shell there. The writable-root setting lets Codex work inside the configured worktree folder. The separate rules allow only commands beginning with `git add` or `git commit`, wherever the trusted session runs them.

Because Codex's shell stays at its original root, drive the worktree explicitly. Prefix every shell command with `cd <path> &&`, and pass `path` to every discern tool. Edits and the gate then use the same worktree root.

If a Codex session starts inside a worktree and that worktree is later removed, Codex can block the next user message with "Current working directory missing". This Codex runtime limitation remains after `discern_accept` successfully tears down the worktree and re-aims the long-lived MCP server at the main checkout: the Codex chat process can still remember the deleted directory it originally opened. There is no in-chat recovery once Codex blocks the conversation; start a new Codex session from the main checkout instead.

The default writable-root path includes the main checkout directory name. If a developer clones the same repository under a different folder name, run `discern refresh`. It updates `.codex/config.toml` to the local path convention and keeps the grant narrower than the parent directory.

### See also

- Why discern writes this narrow Codex project config and avoids broader sandbox control ([ADR 0082](https://discern.sh/docs/decisions/0082-codex-project-config-writable-root)).

## Gemini integration

_The Gemini integration supplies shared instructions and skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

discern's Gemini integration is project-local and registry-driven. It writes or co-manages the files below when Gemini is enabled in `[project].agents`:

| File                    | Role                                                       | Ownership             |
| ----------------------- | ---------------------------------------------------------- | --------------------- |
| `GEMINI.md`             | Pointer to the canonical agent file                        | Generated, committed  |
| `.agents/skills/`       | Materialized Agent skills                                  | Generated, gitignored |
| `.gemini/settings.json` | Model Context Protocol (MCP) server and session-start hook | Shared, tracked       |

Gemini is not in `DEFAULT_AGENTS`; add `"gemini"` to `[project].agents` to emit these artifacts.

### Instructions and Skills

Gemini reads `GEMINI.md` by default, not `AGENTS.md`, so discern writes `GEMINI.md` as an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` remains the canonical agent file. discern generates it from built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Gemini reads the cross-tool Agent skills directory `.agents/skills/`. discern materializes bundled skills there and creates symbolic links to authored project skills from `[skills].dir`. Codex, Cursor, and GitHub Copilot use the same directory.

### `.gemini/settings.json`

`discern refresh` adds or updates discern's hook in `.gemini/settings.json` and leaves other settings unchanged:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "discern worktree ensure",
            "timeout": 600000
          }
        ]
      },
      {
        "matcher": "resume",
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

Gemini enables hooks by default, so discern does not override `hooksConfig`. Gemini requires separate exact matches for a new session and a resumed session, so the example uses one group for each event. MCP setup also adds the `discern` entry under `mcpServers` and keeps every other server and setting. Gemini recognizes it as a local stdio server from its `command`, so the entry needs no `type` field.

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

_The Cursor integration supplies canonical instructions, shared skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

When `[project].agents` includes Cursor, discern uses these project-local files:

| File                 | Role                                       | Ownership                       |
| -------------------- | ------------------------------------------ | ------------------------------- |
| `AGENTS.md`          | Canonical agent file Cursor reads directly | Generated by canonical provider |
| `.agents/skills/`    | Materialized Agent skills                  | Generated, gitignored           |
| `.cursor/mcp.json`   | Project Model Context Protocol server      | Shared, tracked                 |
| `.cursor/hooks.json` | Session-start hook                         | Shared, tracked                 |

Cursor is not in `DEFAULT_AGENTS`. Setup adds it only when installation evidence is present.

### Using the IDE

Cursor's integrated development environment (IDE) is separate from its terminal agent. `discern setup` detects the [`cursor-agent` terminal agent](https://cursor.com/docs/cli/installation), the editor's `cursor` shell command, or a conventional host-specific application location. Portable AppImages can live anywhere, so nonstandard installs may need explicit configuration.

Add `cursor` to the existing `[project].agents` list, keeping the other tools you use, then run `discern refresh`. This example selects only Cursor:

```toml
[project]
agents = ["cursor"]
```

### Worktrees

#### Local sessions

A Local session stays rooted at its checkout. `discern start` creates a sibling outside that workspace. **External File Protection** can then pause each requested write for human approval. Cursor does not expose that interface pause to the agent process.

To let a Local session write into a sibling discern worktree, turn off External File Protection under **Cursor Settings → Agents → Auto-Run**. This user-wide setting lets Cursor's file tools write outside the open workspace. `discern setup done` reports the current choice but never changes it. Cursor's [agent security guide](https://cursor.com/docs/agent/security) covers the setting. [`.cursor/cli.json` permissions](https://cursor.com/docs/cli/reference/permissions) apply only to the terminal agent.

#### Cursor's Worktree option

To keep External File Protection enabled, select Cursor's native [**worktree option**](https://cursor.com/docs/configuration/worktrees) when starting the session. Cursor launches the agent inside its checkout. The `sessionStart` hook readies it for discern's normal workflow.

Acceptance removes that checkout. Cursor shows the landing response, then the session ends. Its transcript accepts no follow-up, so start a new session.

#### Project-local discern worktrees

You can instead set `[worktree].root` to keep discern-created worktrees inside the open project:

```toml
[worktree]
root = ".worktrees"
```

Add `/.worktrees/` to the root `.gitignore`. This keeps External File Protection enabled. The sibling default avoids nested checkouts. Run the full gate and check formatters, linters, indexers, and file watchers for recursive scans. Exclude the directory where needed.

### Instructions and Skills

Cursor reads the root `AGENTS.md` natively, so discern reuses the canonical file instead of emitting a Cursor-specific copy or import pointer. Codex normally emits that file. Claude Code and Gemini import it too.

discern generates `AGENTS.md` from its built-in instructions plus the project's `[instructions].sources`. Edit the sources, then run `discern refresh`.

Cursor also reads `.agents/skills/`. discern materializes bundled skills there and creates symbolic links to authored project skills from `[skills].dir`. Codex, Gemini, and GitHub Copilot share it.

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

Setup detection remains separate: it checks `cursor-agent`, the editor command, and known application paths. MCP identity is advisory and selects no setup, timeout, gate path, or landing authority.

#### Model Context Protocol call duration

Cursor does not use one MCP timeout across all of its surfaces. In the Cursor Agent CLI (`agent` / `cursor-agent`) and `agent acp`, each `tools/call` currently has an effective 60-second wall-clock limit. Cursor invokes the MCP TypeScript SDK without overriding its 60-second default, so `notifications/progress` do not renew the timer. Cursor exposes no supported per-server setting for changing this limit. [Cursor support confirms the CLI and ACP behavior](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925/5).

The editor's IDE Agent follows a different path. Cursor support reports its timeout as around 60 minutes, but Cursor publishes no precise maximum. The Agents Window and cloud-agent limits remain unverified.

The editor and CLI read the same project `.cursor/mcp.json`. discern does not use advisory MCP client names to choose behavior, so the generated entry selects the shortest verified transport profile. `discern_await` uses 45-second calls, leaving 15 seconds for result delivery. When the condition has not been met, the result carries a 15-character continuation handle and `--resume` command that preserve the original watch. Continue until the condition holds, the user stops the watch, or the task no longer needs the dependency.

Gate calls can exceed the Cursor Agent CLI's 60-second transport limit. Run `discern done --markdown` in a shell instead; use `discern prepare --markdown` or `discern test --markdown` there for the corresponding gate stages.

### `.cursor/hooks.json`

The discern-owned Cursor hook seed is:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "discern worktree ensure",
        "timeout": 600
      }
    ]
  }
}
```

`discern refresh` re-seeds this hook idempotently and preserves unrelated groups. The hook reruns worktree setup for sessions opened or resumed inside a discern worktree.

discern does not set Cursor sandbox options, static command permission lists, model settings, or approval defaults. Those remain user or project choices.

### Runtime behavior and gotchas

Cursor workspace trust gates committed `.cursor/` config. The MCP server can also require per-tool approval on first use. For headless runs, `--approve-mcps` bypasses the MCP approval prompt, but it does not replace workspace trust.

Skill-loading behavior varies across Cursor CLI versions. When diagnosing a missing skill in the CLI, verify the installed `cursor-agent` version before treating the materialized directory as stale.

### See also

- Why Cursor emits no provider-specific agent file ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)).
- Why Cursor shares the same stdio MCP JSON writer shape as Claude Code and GitHub Copilot ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## GitHub Copilot integration

_The GitHub Copilot integration supplies canonical instructions, shared skills, a Model Context Protocol (MCP) server entry, and a session-start hook._

discern's GitHub Copilot integration is project-local and registry-driven. It writes, co-manages, or relies on the files below when GitHub Copilot is enabled in `[project].agents`:

| File                         | Role                                        | Ownership                       |
| ---------------------------- | ------------------------------------------- | ------------------------------- |
| `AGENTS.md`                  | Canonical agent file Copilot reads directly | Generated by canonical provider |
| `.agents/skills/`            | Materialized Agent skills                   | Generated, gitignored           |
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

Copilot also reads the cross-tool Agent skills directory `.agents/skills/`. discern materializes bundled skills there and creates symbolic links to authored project skills from `[skills].dir`. Codex, Gemini, and Cursor use the same directory.

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

Copilot supports both `.mcp.json` at the repository root and `.github/mcp.json`. discern uses the root file because Claude Code reads the same server entry there. Both tools can share that local server entry. The Claude Code approval setting is not written for Copilot; Copilot relies on folder trust.

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
        "timeoutSec": 600
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

Copilot's local sandbox and pre-tool hooks are separate vendor features. discern does not configure them today. The provider integration is limited to instructions, skills, MCP, and the session-start setup hook.

### See also

- Why Copilot emits no provider-specific agent file ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)).
- Why Claude Code and GitHub Copilot co-own `.mcp.json` ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)).

## Secure entropy

discern uses the operating system's secure random source through WebCrypto for identifiers, nonces, and key material. This is separate from the deterministic worktree identities described above.

For the implementation and its security boundaries, see [secure entropy in the project map](https://github.com/discern-sh/discern/blob/main/project/map/00-orientation/secure-entropy.md). The [files reference](files-and-ownership.md#runtime-state-inside-git) identifies local records and key storage.
