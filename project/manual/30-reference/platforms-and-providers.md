---
id: reference-platforms-and-providers
title: "Platforms and providers"
description: "Check which computers and coding tools discern supports, what each one needs, which files discern writes for it, and how to confirm that it loaded discern."
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

Check here that discern runs on your computer and works with the coding tool you already use. discern runs on macOS and Linux, and on Windows inside WSL 2, and it supports Claude Code, Codex, Gemini CLI, Cursor, and GitHub Copilot CLI. For each tool, this page lists the files discern writes, how long one call can run, and how to confirm that a new session loaded discern.

discern writes integration files into your project, but each coding tool keeps its own user-level trust settings, which discern can't change for you, so every tool asks you for a trust step. Say your recipe app uses Claude Code and Codex, discern's default pair: the sections below show the files discern writes for each and how you confirm that each loaded discern. To add a tool to an existing project, follow [Connect a coding agent](../20-guides/connect-a-coding-agent.md).

| Find                                     | Go to                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What your computer needs                 | [Platforms and prerequisites](#platforms-and-prerequisites)                                                                                                                                  |
| How to check a release before running it | [Verify a release download](#verify-a-release-download)                                                                                                                                      |
| Every tool side by side                  | [Provider matrix](#provider-matrix)                                                                                                                                                          |
| How to confirm a session loaded discern  | [Confirm that a tool loaded discern](#confirm-that-a-tool-loaded-discern)                                                                                                                    |
| One tool's files and behavior            | [Claude Code](#claude-code-integration), [Codex](#codex-integration), [Gemini CLI](#gemini-integration), [Cursor](#cursor-integration), or [GitHub Copilot CLI](#github-copilot-integration) |

## Platforms and prerequisites

discern runs on macOS and Linux. On Windows, use WSL 2. The binary includes its own runtime, but your project still needs the tools its own commands use, such as its test runner.

### Supported release targets

<!-- BEGIN GENERATED BUILD TARGETS -->

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

<!-- END GENERATED BUILD TARGETS -->

There's no native Windows release. On Windows, run the Linux binary inside WSL 2. The installer refuses an unsupported operating system or architecture before it downloads anything.

### Required tools

| When                           | You need                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Downloading with the installer | POSIX `sh`, `uname`, `mktemp`, standard file utilities, `sha256sum` or `shasum`, and `curl` or `wget`.                                                                                                                                           |
| Installing                     | A writable directory. On macOS, the installer uses `DISCERN_BIN_DIR`, then `/usr/local/bin` if it exists and is writable, then `~/.local/bin`. On Linux, it uses `DISCERN_BIN_DIR`, then `~/.local/bin`, then `/usr/local/bin` if it's writable. |
| Running discern                | `git` and a POSIX `sh` on `PATH`. discern runs the commands in your gate, the checks a change must pass, such as your linter and tests, and your resource commands through `sh -c`.                                                              |
| Using worktrees                | A Git repository whose root is the project root, with at least 1 commit to branch from.                                                                                                                                                          |
| Running your project's checks  | Every program that your jobs, standards, setup steps, and resource commands name, available on `PATH`.                                                                                                                                           |

The released binary is self-contained, so a project doesn't need Deno or Node to run discern. Setup needs a Git repository: without one, `discern setup begin` refuses with `no_repository` and changes nothing. `discern start` also needs a first commit to branch from.

To check the prerequisites and the installation, run this from any directory inside the project:

```sh
discern doctor
```

Doctor checks the configuration, the required tools, the integrations, and the project setup, without repairing files or running generators, and its result explains each problem and the next action. [Setup and integrations troubleshooting](../40-troubleshooting/setup-and-integrations.md) helps when a check fails.

### What the installer does

[Environment variables](environment-variables.md#installation) lists the installer's `DISCERN_*` inputs. The installer styles its output only on a terminal, and a non-empty `NO_COLOR` turns the styling off.

- It accepts `DISCERN_VERSION` with or without a leading `v`, and turns either form into the `v`-prefixed release tag.
- It retries a failed download. With `curl`, it retries up to 3 times after the first try, whatever the error. With `wget`, it makes up to 3 attempts in all. The binary and its checksum file each get their own retries.
- It refuses when the final `discern` destination is a directory.
- On macOS, it never picks `/opt/homebrew/bin`, because Homebrew owns that prefix.
- It places the binary and its `.sha256` file in a `.discern-install.*` staging directory beside the install destination, so the final rename stays on one filesystem. It removes that directory when it exits, including after a failure or a `HUP`, `INT`, or `TERM` signal.
- It checks the checksum before it replaces an existing installation. The checksum file must hold exactly one line, for this asset.
- If the installed command doesn't resolve on `PATH`, it prints a lasting fix for your shell profile. If another `discern` earlier on `PATH` would run instead, it warns you and says to put the install directory first.
- It prints the setup handoff only when `discern` runs directly from the new install. When it replaces an existing installation, it prints upgrade steps instead.

A forced kill, or a power loss, can leave the staging directory behind. When no installer is running, you can safely remove it from the chosen bin directory.

Once installed, discern makes no network calls itself, though your project's own commands can still use the network.

### Verify a release download

Pick `TAG` and the `ASSET` for your system from the target table above. Download the binary and its checksum file from the release:

```sh
TAG=vX.Y.Z
ASSET=discern-aarch64-apple-darwin
gh release download "$TAG" --repo discern-sh/discern \
  --pattern "$ASSET" --pattern "$ASSET.sha256"
```

Check the checksum before you run the binary. Use the command for your system:

```sh
# macOS
shasum -a 256 -c "$ASSET.sha256"

# GNU/Linux and WSL 2
sha256sum -c "$ASSET.sha256"
```

Check GitHub's build-provenance attestation for the binary and its checksum file:

```sh
gh attestation verify "$ASSET" --repo discern-sh/discern
gh attestation verify "$ASSET.sha256" --repo discern-sh/discern
```

For a macOS asset, also check the Developer ID signature and the notarization requirement the release workflow uses:

```sh
codesign --verify --strict --verbose=2 "$ASSET"
codesign -dv --verbose=4 "$ASSET" 2>&1 | grep 'Authority=Developer ID Application:'
codesign -vvvv -R="notarized" --check-notarization "$ASSET"
```

The download is verified only when every command succeeds and the `codesign -dv` output names a Developer ID Application authority. The attestation commands need a public release, and a GitHub CLI login that can verify attestations.

### Values that differ by worktree

Each task works in its own worktree, a separate copy of the project on its own branch, and discern derives values from its identity that you can use in your tooling:

- `discern identity` reads the worktree's identity, such as its development port and resource names. [Worktrees and status](worktrees-and-status.md#read-the-derived-identity) lists every selector and its exact value.
- Your project chooses which environment values each worktree inherits, and which files receive them. [Worktrees and status](worktrees-and-status.md#inherit-selected-env-values) gives the file precedence and resource behavior, and [Environment variables](environment-variables.md) lists the values discern exports.
- A resource's commands can use tokens such as `@port@` and `@dir@`. The [worktree reference](worktrees-and-status.md#use-tokens-during-setup) lists every token, and how setup steps read the same values.

## Provider matrix

This table compares each tool's launcher, files, trust step, and limits. MCP, the Model Context Protocol, is how a coding tool calls discern's tools directly, and the recipe app's two tools are the first two rows.

| Provider       | Launcher       | Agent file  | Skills            | MCP config              | Hook config                  | Trust required                                  | Tool / await budget        |
| -------------- | -------------- | ----------- | ----------------- | ----------------------- | ---------------------------- | ----------------------------------------------- | -------------------------- |
| Claude Code    | `claude`       | `CLAUDE.md` | `.claude/skills/` | `.mcp.json`             | `.claude/settings.json`      | Workspace trust, then named server pre-approval | 3,600s / 3,300s            |
| Codex          | `codex`        | `AGENTS.md` | `.agents/skills/` | `.codex/config.toml`    | `.codex/hooks.json`          | Directory trust and hook-hash approval          | 3,600s / 3,300s            |
| Gemini         | `gemini`       | `GEMINI.md` | `.agents/skills/` | `.gemini/settings.json` | same file                    | Workspace trust; hooks enabled by default       | 3,600s / 3,300s            |
| Cursor         | `cursor-agent` | `AGENTS.md` | `.agents/skills/` | `.cursor/mcp.json`      | `.cursor/hooks.json`         | Workspace and first-use tool approval           | 60s shortest surface / 45s |
| GitHub Copilot | `copilot`      | `AGENTS.md` | `.agents/skills/` | `.mcp.json`             | `.github/hooks/discern.json` | Folder trust                                    | 3,600s / 3,300s            |

The agent file is the file each tool reads its instructions from. When Codex, Cursor, or GitHub Copilot is configured, discern writes the full instructions into `AGENTS.md`, and `CLAUDE.md` and `GEMINI.md` hold only the pointer `@AGENTS.md`, so in the recipe app, Codex reads `AGENTS.md` and Claude Code follows the pointer to it. When only Claude Code, Gemini, or both are configured, `CLAUDE.md` and `GEMINI.md` hold the full instructions, and discern writes no `AGENTS.md`.

The last column gives each tool's limit for one MCP call, then the longest `discern_await` request discern makes there. Most tools let an MCP call run for 3,600 seconds, and `discern_await` uses at most 3,300 seconds of that, which leaves 5 minutes for the tool to deliver the result. Cursor has the shorter limits shown.

Session hooks have their own limit of 600 seconds, which Gemini records as 600,000 milliseconds and the other tools in seconds. `discern refresh` brings the settings discern owns up to each tool's current format and keeps unrelated settings unchanged, and the file locations and ownership rules stay the same when a format changes.

When you run setup without naming tools, it selects every tool it finds installed: the tool's launcher on `PATH`, or for Cursor also the editor's `cursor` command or its usual application location. If it finds none, it selects Claude Code and Codex, and discern also uses those two when `[project].agents` isn't set.

Removing a tool from `[project].agents` leaves its files in place, and the gate stops checking them. Only `discern uninstall` removes them. Uninstalling a coding tool from your computer doesn't change who owns its files in the project. Coding tools outside this table have no supported discern configuration, skill location, trust instructions, or MCP timeout.

Third-party product names and trademarks in this reference belong to their owners. discern uses them to identify supported integrations, which implies no affiliation or endorsement.

## Confirm that a tool loaded discern

A coding tool loads discern's MCP server, hooks, and rules when a session starts, so the session that ran setup can't see them. After setup or an upgrade, start a fresh session and ask your agent something like "Is discern connected in this session?" Your agent checks the tools the session registered, then calls the activation check below, which for both of the recipe app's tools is `mcp__discern__discern_status`. Activation is confirmed only when that call returns, because files on disk don't prove that the session loaded the integration.

| Tool           | Activation check               | If the check is missing                                                                                                  |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Claude Code    | `mcp__discern__discern_status` | close and reopen Claude Code in this project, then check whether the project MCP server was loaded                       |
| Codex          | `mcp__discern__discern_status` | open a new Codex task for this project and re-check the project integration; if it remains absent, restart the Codex app |
| Gemini         | `discern_status`               | start a new Gemini CLI session in this project after completing the workspace trust step, then check again               |
| Cursor         | `discern_status`               | reload the Cursor window, start a new agent conversation in this workspace, and check again                              |
| GitHub Copilot | `discern_status`               | start a new Copilot CLI session in the trusted folder and check again                                                    |

If the check is still missing after that, run `discern doctor`. Meanwhile, `discern status --json` gives your agent the same status from the command line. The setup handoff gives your agent these checks too, so you don't need to look them up during setup.

## Clones without discern

Git keeps the agent instruction files and the provider configuration, but not the generated skill folders: `.claude/skills/` for Claude Code, and `.agents/skills/` for Codex, Gemini, Cursor, and GitHub Copilot.

After you clone the project onto a computer without discern, install discern, run `discern refresh`, and open a new coding-agent session. The refresh recreates the skill folders and updates discern's provider settings before the new session reads them.

## Claude Code integration

discern gives Claude Code the shared instructions and [skills](glossary.md#skill), an MCP server entry, and worktree hooks. It adds no permission rules.

When `[project].agents` includes Claude Code, discern writes or co-manages these project files:

| File                    | Role                                       | Ownership             |
| ----------------------- | ------------------------------------------ | --------------------- |
| `CLAUDE.md`             | Agent file, often a pointer to `AGENTS.md` | Generated, committed  |
| `.claude/skills/`       | Materialized Claude Code skills            | Generated, gitignored |
| `.mcp.json`             | Project MCP server                         | Shared, tracked       |
| `.claude/settings.json` | Hooks and named MCP pre-approval           | Shared, tracked       |

Claude Code may create `.claude/settings.local.json` for permissions on one computer. discern doesn't seed or track it, and its `.gitignore` rules keep it out of Git.

### Instructions and skills

Claude Code reads `CLAUDE.md` rather than `AGENTS.md`. When discern also writes `AGENTS.md`, because Codex, Cursor, or GitHub Copilot is configured, `CLAUDE.md` is an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` then holds the canonical instructions. When no configured tool reads `AGENTS.md`, `CLAUDE.md` holds the full instructions instead. Either way, discern compiles its built-in instructions and your `[instructions].sources`. To change them, edit the sources, then run `discern refresh`.

Claude Code doesn't read the shared `.agents/skills/` directory, so discern materializes the effective skill set into `.claude/skills/` for Claude Code, and the other tools share `.agents/skills/`.

### `.mcp.json`

`discern refresh` co-manages `.mcp.json` and keeps other servers and top-level keys. discern owns this entry:

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

GitHub Copilot can use the same `.mcp.json` file. Claude Code and Copilot share one writer for this entry, so the `discern` server entry is byte-identical whichever tool wires it first.

When `DISCERN_EXPERIMENTAL_MCP_PRELOAD=1` is set while discern writes the entry, it also gets `alwaysLoad: true` when Claude Code is configured, and `deferTools: "never"` when GitHub Copilot is configured. [Environment variables](environment-variables.md) lists this and the other experimental settings.

#### Tool discovery

[Claude Code's MCP Tool Search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) is on by default: a session starts with tool names and server instructions, and selected schemas arrive after a search. This client policy doesn't change the full definitions that MCP `tools/list` returns.

discern keeps its server instructions under Claude Code's 2KB limit and leads with the lifecycle, so they tell the agent to start with `discern_status`, whose result names the next MCP tool.

Claude Code's one-hour client timeout leaves 55 minutes for `discern_await`, and five for delivery and cancellation. Codex, Gemini, and GitHub Copilot get the same budget, and Cursor a shorter one. When the watched condition holds, the call returns at once, and a longer watch continues from a 15-character resume handle. Claude Code's own [`MCP_TOOL_TIMEOUT`](https://code.claude.com/docs/en/env-vars) defaults to about 28 hours.

### `.claude/settings.json`

The Claude Code settings seed has the worktree hooks and no permission rules:

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

`discern refresh` adds or updates discern's hooks and leaves other hooks and permission rules unchanged. It also adds `discern` to `enabledMcpjsonServers`, so once you trust the workspace, Claude Code can start that named local server without another server-approval prompt. Claude Code still applies its normal permissions when the server calls a tool.

### How Claude Code works with discern

Of the supported tools, only Claude Code exposes a worktree lifecycle hook contract. `WorktreeCreate` and `WorktreeRemove` run `discern worktree hook`, and `SessionStart` runs `discern worktree ensure` ([ADR 0040](https://discern.sh/docs/decisions/0040-worktree-hooks-in-the-binary)).

- To create a worktree, Claude Code sends `name` and `cwd`. To remove one, it sends `worktree_path`. discern ignores extra fields.
- If a create request leaves out a required value or sends the wrong type, discern refuses it with an error.
- Removal stays best effort, so a cleanup problem can't strand Claude Code's own removal.

`EnterWorktree` moves Claude Code's shell and instruction context, but a stdio MCP process keeps the directory it started in, and a native directory move doesn't move a generic server. That's why `discern_start` itself points discern's running MCP server at the new worktree.

Claude Code's shell keeps its working directory between calls, so one `cd` affects every later call. When a task must stay isolated, open or launch the session in its worktree.

discern doesn't write Claude Code sandbox settings. Of the agent sandboxes discern's provider records cover, Claude Code's native sandbox is the only one that handles linked-worktree Git metadata automatically.

## Codex integration

discern gives Codex the canonical instructions, shared skills, an MCP server entry, hooks, app worktree scripts, and narrow Git rules.

When `[project].agents` includes Codex, discern writes or co-manages these project files:

| File                                   | Role                                   | Ownership             |
| -------------------------------------- | -------------------------------------- | --------------------- |
| `AGENTS.md`                            | Canonical agent file                   | Generated, committed  |
| `.agents/skills/`                      | Materialized agent skills              | Generated, gitignored |
| `.codex/config.toml`                   | Codex configuration and MCP server     | Shared, tracked       |
| `.codex/hooks.json`                    | Session-start hook                     | Shared, tracked       |
| `.codex/environments/environment.toml` | Codex app worktree setup and cleanup   | Shared, tracked       |
| `.codex/rules/discern.rules`           | Narrow Git rules for discern worktrees | Shared, tracked       |

### Instructions and skills

Codex reads `AGENTS.md` directly, so discern makes it the canonical agent file, and Claude Code and Gemini point back to it instead of copying it ([ADR 0043](https://discern.sh/docs/decisions/0043-registry-derived-agent-parity)). discern generates it from its built-in instructions and your `[instructions].sources`. To change it, edit the sources, then run `discern refresh`.

Codex also reads the shared agent skills directory, `.agents/skills/`. discern materializes the bundled skills there, and links to your authored skills from `[skills].dir`.

### `.codex/config.toml`

`discern refresh` co-manages `.codex/config.toml` with a TOML editor that keeps comments. It keeps other servers, other top-level settings, comments, and existing writable roots. discern owns these settings:

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

- **`project_doc_max_bytes`:** discern sets it only when the project hasn't chosen its own value. The 65,536-byte value raises Codex's default limit on instruction files, to fit discern's generated instructions.
- **`sandbox_workspace_write.writable_roots`:** discern keeps the existing values and adds the folder where it creates worktrees. With the default `[worktree].root = ""`, the path is relative to `.codex/` and looks like `../../<repo>.worktrees`. discern adjusts another relative root from the same starting point, and keeps an absolute root absolute. It never replaces the entry with the broader `../..` path ([ADR 0082](https://discern.sh/docs/decisions/0082-codex-project-config-writable-root)).
- **`startup_timeout_sec`:** the local server gets 30 seconds to start.
- **`tool_timeout_sec`:** Codex's [per-tool timeout](https://developers.openai.com/codex/config-reference) defaults to 60 seconds, so discern raises it to one hour. `discern_await` uses up to 55 minutes and returns at once when its condition holds. A longer watch continues from the returned 15-character resume handle.

When `discern refresh` runs inside a linked worktree, discern asks Git for the main checkout and computes the writable root from there, so a refresh in a worktree doesn't rewrite the tracked setting to `../../<worktree-id>.worktrees`.

The writable root includes the main checkout's folder name, and discern only ever adds its root to the list, never removing one. So in a clone under a different folder name, `discern refresh` adds a second root for that folder, and the first stays: review that change before you commit it. Each root stays narrower than the parent directory.

discern doesn't set an MCP `cwd`, and refresh removes one from discern's entry, because Codex starts the project's server from the project root by default, and overriding that can detach the server from the project's `discern.toml`.

discern doesn't set `sandbox_mode`, `approval_policy`, `approvals_reviewer`, model settings, network access, `required = true`, MCP tool lists, or tool approval modes, because those are security choices for you or your project. Restricting tools here could also block the command-line fallback or future discern tools.

### `.codex/hooks.json`

discern's Codex hook seed is:

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

`discern refresh` re-seeds this hook idempotently and keeps unrelated settings and hook groups in the same file. The hook reruns worktree setup when a Codex session opens or resumes inside a discern worktree, but only after you trust the hook's hash, because Codex holds committed hooks until then.

### `.codex/environments/environment.toml`

The Codex app has its own worktree environment file. discern co-manages only the worktree setup and cleanup scripts, and keeps the app's other keys:

```toml
version = 1
name = "<project name>"

[setup]
script = "discern worktree ensure"

[cleanup]
script = "discern worktree teardown"
```

discern adds `version` and `name` only when they're missing: a new file uses the project's configured name, or the name discern already shows for the project, and an existing Codex file keeps its values. `discern refresh` restores missing setup and cleanup scripts, and keeps scripts the project has customized. discern puts its marker comment at the top of the file.

`discern uninstall` removes discern's setup and cleanup scripts while they still hold discern's commands. It then deletes the file if nothing remains, or if only `version` and `name` remain and the marker is there. A file with the Codex app's own settings stays, without discern's scripts. The environment name plays no part in this.

This file is for worktrees the Codex app manages. discern's own worktrees still come from `discern start` or `discern_start` and the other worktree commands.

### `.codex/rules/discern.rules`

Codex loads this rules file after you trust the project. Each rule allows a command that begins with the listed words, wherever Codex runs it, so Codex lets your agent stage and commit its work without asking you first. discern writes its own file and leaves project files such as `.codex/rules/default.rules` unchanged.

The generated file allows only these prefixes. Its first line is discern's marker comment, which `DISCERN_NO_ATTRIBUTION` shortens:

```text
# Generated automatically by discern via the bundled Codex project rules | https://discern.sh
# Put user-owned Codex rules in a separate .codex/rules/*.rules file.

prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow the git add command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = [
        "git add -A",
        "git add src/example.ts",
    ],
    not_match = [
        "git status",
        "git push",
        "git reset --hard",
    ],
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow the git commit command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = [
        "git commit -m Example",
        "git commit --amend --no-edit",
        "git commit --no-verify -m Example",
    ],
    not_match = [
        "git status",
        "git push",
        "git reset --hard",
    ],
)
```

The prefixes cover trailing arguments such as `git add -A`, `git commit --amend`, and `git commit --no-verify`. They don't grant `git` in general, `git push`, `git reset`, shell wrappers, network access, or a sandbox bypass. Codex checks the `match` and `not_match` examples when it loads the rules.

### How Codex works with discern

Codex ignores the project's `.codex/` settings until its user-level configuration marks the project's absolute path as trusted: `projects."<absolute-project-path>".trust_level = "trusted"` in `~/.codex/config.toml`. That decision lives outside the repository, and discern can't make it for you, so trusting the recipe app is your step. Codex also asks you to approve each committed hook's hash before the hook runs, and `--dangerously-bypass-hook-trust` skips that approval. After you change the project settings or trust them, start a new session or restart Codex.

`discern_start` points the running discern MCP server at the new worktree, but it can't move Codex's shell there. The writable root lets Codex work inside the worktree folder, and the rules allow only commands that begin with `git add` or `git commit`, wherever the trusted session runs them. So your agent drives the worktree explicitly: it prefixes every shell command with `cd <path> &&`, and passes `path` to every discern tool, so its edits and the gate use the same worktree.

If a Codex session starts inside a worktree that's later removed, Codex can block the next message with "Current working directory missing". This happens even after `discern_accept` removes the worktree and points the MCP server back at the main checkout, because the Codex chat process remembers the deleted directory it opened in. Once Codex blocks the conversation, you can't recover it from inside the chat, so start a new Codex session from the main checkout.

## Gemini integration

discern gives Gemini the shared instructions and skills, an MCP server entry, and a session-start hook.

When `[project].agents` includes Gemini, discern writes or co-manages these project files:

| File                    | Role                                       | Ownership             |
| ----------------------- | ------------------------------------------ | --------------------- |
| `GEMINI.md`             | Agent file, often a pointer to `AGENTS.md` | Generated, committed  |
| `.agents/skills/`       | Materialized agent skills                  | Generated, gitignored |
| `.gemini/settings.json` | MCP server and session-start hook          | Shared, tracked       |

Setup selects Gemini when it finds `gemini` on `PATH`. Otherwise, add `"gemini"` to `[project].agents` to get these files.

### Instructions and skills

By default, Gemini reads `GEMINI.md` rather than `AGENTS.md`. When discern also writes `AGENTS.md`, because Codex, Cursor, or GitHub Copilot is configured, `GEMINI.md` is an import pointer:

```md
@AGENTS.md
```

`AGENTS.md` then holds the canonical instructions. When no configured tool reads `AGENTS.md`, `GEMINI.md` holds the full instructions instead. Either way, discern generates them from its built-in instructions and your `[instructions].sources`. To change them, edit the sources, then run `discern refresh`.

Gemini reads the shared agent skills directory, `.agents/skills/`. discern materializes the bundled skills there and links to your authored skills from `[skills].dir`. Codex, Cursor, and GitHub Copilot use the same directory.

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

Gemini turns hooks on by default, so discern doesn't set `hooksConfig`, and if `hooksConfig` is exactly `{ "enabled": true }`, refresh removes it. Gemini needs separate exact matches for a new session and a resumed one, so the seed has one group for each. MCP setup also adds the `discern` entry under `mcpServers` and keeps every other server and setting ([ADR 0072](https://discern.sh/docs/decisions/0072-typed-mcp-status-forcing-function)). Gemini recognizes a local stdio server from its `command`, so the entry needs no `type` field.

Gemini's [MCP server configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md#mcpservers) accepts a request timeout in milliseconds, and defaults to 10 minutes. discern raises it to one hour. `discern_await` uses up to 55 minutes and returns at once when its condition holds. A longer watch continues from the returned 15-character resume handle.

discern doesn't set Gemini sandbox options, model settings, custom commands, `.env` loading, approval defaults, or worktree flags. Those stay your choice, or your project's.

### How Gemini works with discern

Gemini's safe mode ignores the project's `.gemini/settings.json` until Gemini trusts the folder, and that trust lives outside the repository. Before trust, Gemini still reads `GEMINI.md` as instructions, but it doesn't load the committed MCP server and hooks. To load them, trust the folder, or choose a bypass such as `--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true`.

A running Gemini session can't move its project root into a discern worktree: `/directory add` can widen the workspace, and the native `--worktree` flag works only at launch. When commands must run from a worktree, create it with `discern start` or `discern_start`, then launch a Gemini session there.

The hook discern wires is a `SessionStart` setup hook only. Gemini doesn't expose a worktree create and remove contract like Claude Code's `WorktreeCreate` and `WorktreeRemove`, and its `SessionEnd` hook is advisory. So discern creates and removes worktrees through its own commands and MCP tools, and never treats `SessionEnd` as a signal to tear down a worktree.

After you change the configured agent set or upgrade the project, run `discern refresh` to keep the committed settings in line with discern's provider registry.

## Cursor integration

discern gives Cursor the canonical instructions, shared skills, an MCP server entry, and a session-start hook.

When `[project].agents` includes Cursor, discern uses these project files:

| File                 | Role                                       | Ownership             |
| -------------------- | ------------------------------------------ | --------------------- |
| `AGENTS.md`          | Canonical agent file Cursor reads directly | Generated, committed  |
| `.agents/skills/`    | Materialized agent skills                  | Generated, gitignored |
| `.cursor/mcp.json`   | Project MCP server                         | Shared, tracked       |
| `.cursor/hooks.json` | Session-start hook                         | Shared, tracked       |

Setup selects Cursor when it finds Cursor installed, as the next section describes. Otherwise, add `"cursor"` to `[project].agents` to get these files.

### Using the editor

Cursor's editor, its integrated development environment (IDE), is separate from its terminal agent. `discern setup` detects the [`cursor-agent` terminal agent](https://cursor.com/docs/cli/installation), the editor's `cursor` shell command, or the usual application location for your system. A portable AppImage can live anywhere, so a nonstandard install may need explicit configuration.

Add `cursor` to the existing `[project].agents` list, keeping the other tools you use, then run `discern refresh`. This example selects only Cursor:

```toml
[project]
agents = ["cursor"]
```

### Worktrees

#### Local sessions

A Local session stays rooted at its checkout, and `discern start` creates a worktree beside it, outside that workspace, so **External File Protection** can pause each write there for your approval. Cursor doesn't tell the agent process about that pause.

To let a Local session write into a discern worktree beside it, turn off External File Protection under **Cursor Settings → Agents → Auto-Run**. This user-wide setting lets Cursor's file tools write outside the open workspace. discern can't read the setting and never changes it, but its setup handoff for Cursor reminds you about this choice. Cursor's [agent security guide](https://cursor.com/docs/agent/security) covers the setting. [`.cursor/cli.json` permissions](https://cursor.com/docs/cli/reference/permissions) apply only to the terminal agent.

#### Cursor's Worktree option

To keep External File Protection on, choose Cursor's native [**worktree option**](https://cursor.com/docs/configuration/worktrees) when you start the session. Cursor launches the agent inside its own checkout, and the `sessionStart` hook gets it ready for discern's normal workflow.

When the change lands, discern removes that checkout. Cursor shows the landing result, then the session ends. Its conversation accepts no follow-up, so start a new session.

#### Project-local discern worktrees

Instead, you can set `[worktree].root` so discern creates worktrees inside the open project:

```toml
[worktree]
root = ".worktrees"
```

This keeps External File Protection on. Setup and `discern upgrade` add the configured root to discern's `.gitignore` block. If you set it at another time, add `/.worktrees/` to the root `.gitignore` yourself. The default location beside the project avoids nested checkouts, so after you change it, run the full gate and check your formatters, linters, indexers, and file watchers for recursive scans, and exclude the directory where needed.

### Instructions and skills

Cursor reads the root `AGENTS.md` natively, so discern reuses the canonical file instead of writing a Cursor-specific copy or an import pointer ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)). discern writes `AGENTS.md` whenever Cursor is configured, even without Codex, and Claude Code and Gemini then import it.

discern generates `AGENTS.md` from its built-in instructions and your `[instructions].sources`. To change it, edit the sources, then run `discern refresh`.

Cursor also reads `.agents/skills/`. discern materializes the bundled skills there and links to your authored skills from `[skills].dir`. Codex, Gemini, and GitHub Copilot share it.

### `.cursor/mcp.json`

`discern refresh` co-manages `.cursor/mcp.json` and keeps other servers and top-level keys. discern owns this entry:

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

Cursor requires `type: "stdio"`, and discern writes this entry with the same writer as Claude Code's and GitHub Copilot's ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)). Unlike theirs, it lives in `.cursor/mcp.json`, passes `--strict-tool-calls`, and sets no `timeout`.

#### Logbook identity

Cursor's MCP client declares the name `cursor-vscode`, and discern's agent catalog recognizes that exact name, with no `cursor-*` prefix rule. New calls that carry only that name get a Cursor `mcp-client` signal in the [logbook](logbook.md#possible-agent-identity-signals).

discern classifies the stored name when it reads the logbook, so `discern patterns` attributes older `cursor-vscode` events without rewriting them. An unknown name stays in the identity-gap finding.

Setup detection is separate: it checks for `cursor-agent`, the editor command, and known application paths. MCP identity is advisory, and chooses no setup, timeout, gate path, or landing authority.

#### How long a call can run

Cursor doesn't use one MCP timeout across all its surfaces:

- **Cursor Agent CLI** (`agent` or `cursor-agent`) and `agent acp`: each `tools/call` currently has an effective 60-second wall-clock limit. Cursor calls the MCP TypeScript SDK without overriding its 60-second default, so `notifications/progress` messages don't renew the timer. Cursor offers no supported setting to change this limit for one server. [Cursor support confirms the CLI and ACP behavior](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925/5).
- **The editor's IDE Agent:** Cursor support reports its timeout as around 60 minutes, but Cursor publishes no exact maximum.
- **The Agents Window and cloud agents:** their limits are unverified.

The editor and the CLI read the same `.cursor/mcp.json`, and discern doesn't use advisory MCP client names to choose behavior, so the generated entry selects the shortest verified profile. `discern_await` makes 45-second calls, which leaves 15 seconds to deliver the result. When the condition hasn't been met, the result carries a 15-character continuation handle and a `--resume` command that keep the original watch, and your agent continues until the condition holds, you stop the watch, or the task no longer needs it.

A gate call can take longer than the Cursor Agent CLI's 60-second limit, so there your agent runs `discern done --markdown` in a shell instead, and `discern prepare --markdown` or `discern test --markdown` for those stages of the gate.

### `.cursor/hooks.json`

discern's Cursor hook seed is:

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

`discern refresh` re-seeds this hook idempotently and keeps unrelated groups. The hook reruns worktree setup for a session that opens or resumes inside a discern worktree.

discern doesn't set Cursor sandbox options, fixed command permission lists, model settings, or approval defaults. Those stay your choice, or your project's.

### How Cursor works with discern

Cursor's workspace trust controls the committed `.cursor/` configuration, and the MCP server can also ask for approval of each tool on first use. In a headless run, `--approve-mcps` skips the MCP approval prompt, but it doesn't replace workspace trust.

How the Cursor CLI loads skills varies between versions. When a skill seems missing in the CLI, check the installed `cursor-agent` version before you treat the materialized directory as stale.

## GitHub Copilot integration

discern gives GitHub Copilot the canonical instructions, shared skills, an MCP server entry, and a session-start hook.

When `[project].agents` includes GitHub Copilot, discern writes, co-manages, or relies on these project files:

| File                         | Role                                        | Ownership             |
| ---------------------------- | ------------------------------------------- | --------------------- |
| `AGENTS.md`                  | Canonical agent file Copilot reads directly | Generated, committed  |
| `.agents/skills/`            | Materialized agent skills                   | Generated, gitignored |
| `.mcp.json`                  | Project MCP server                          | Shared, tracked       |
| `.github/hooks/discern.json` | Session-start hook                          | Shared, tracked       |

Setup selects GitHub Copilot when it finds the `copilot` CLI on `PATH`. Otherwise, add `"copilot"` to `[project].agents` to wire its configuration.

### Using the editor

discern doesn't currently detect a Copilot installation that runs only inside an editor, an integrated development environment (IDE), because `discern setup` finds GitHub Copilot only when the `copilot` terminal CLI is on `PATH`. For an editor-only install, add `copilot` to `[project].agents` yourself, then run `discern refresh`:

```toml
[project]
agents = ["copilot"]
```

If the project already lists other agents, add `copilot` to that same list.

### Instructions and skills

The Copilot CLI reads `AGENTS.md` natively as its main instruction file, so discern reuses the canonical file ([ADR 0070](https://discern.sh/docs/decisions/0070-reuse-canonical-guidance)). It doesn't write a Copilot-specific instruction file or an import pointer. discern writes `AGENTS.md` whenever Copilot is configured, even without Codex, and Claude Code and Gemini then import it.

discern generates `AGENTS.md` from its built-in instructions and your `[instructions].sources`. To change it, edit the sources, then run `discern refresh`.

Copilot also reads the shared agent skills directory, `.agents/skills/`. discern materializes the bundled skills there and links to your authored skills from `[skills].dir`. Codex, Gemini, and Cursor use the same directory.

### `.mcp.json`

`discern refresh` co-manages `.mcp.json` and keeps other servers and top-level keys. discern owns this entry:

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

Copilot and Claude Code co-own this file ([ADR 0074](https://discern.sh/docs/decisions/0074-co-owned-mcp-json)). Both write the same byte-identical `discern` entry through one shared writer. The second tool finds the identical entry and writes nothing.

Copilot's [MCP server configuration](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration) accepts a tool-call timeout in milliseconds, but publishes no default or maximum. discern sets one hour. `discern_await` uses up to 55 minutes and returns at once when its condition holds. A longer watch continues from the returned 15-character resume handle.

Copilot supports both `.mcp.json` at the repository root and `.github/mcp.json`. discern uses the root file because Claude Code reads the same server entry there, so both tools can share it, and it doesn't write the Claude Code approval setting for Copilot, which relies on folder trust instead.

### `.github/hooks/discern.json`

discern's Copilot hook seed is:

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

`discern refresh` re-seeds this hook idempotently and keeps unrelated Copilot hook files. Copilot loads every `.github/hooks/*.json` file, so discern keeps its hook in a file of its own instead of merging it into a broader project hook file.

discern doesn't set Copilot sandbox options, tool approval defaults, model settings, path grants, or network settings. Those stay your choice, or your project's.

### How GitHub Copilot works with discern

Copilot ignores the committed configuration until you trust the folder, and that trust grant lives outside the repository, in `trustedFolders` in `~/.copilot/config.json`. For unattended runs, discern's provider registry names `--allow-all-tools` and `--allow-all-paths` as the headless bypasses.

Copilot can move a running session with `/cwd`, and create and enter a native worktree with `/worktree`, but it exposes no worktree create and remove hook for discern to drive. So discern runs its own worktree lifecycle through `discern start`, `discern update`, and `discern accept`.

In interactive mode, Copilot's `sessionStart` hook can fire once per prompt, which does no harm because `discern worktree ensure` is idempotent: repeated calls leave the same result.

Copilot's local sandbox and pre-tool hooks are separate features, and discern doesn't configure them. discern's integration covers instructions, skills, MCP, and the session-start setup hook.

## Secure entropy

discern uses the operating system's secure random source, through WebCrypto, for identifiers, nonces, and key material, separately from the deterministic worktree identities above. [Files and ownership](files-and-ownership.md#runtime-state-inside-git) lists the local records, including where discern keeps its key.
