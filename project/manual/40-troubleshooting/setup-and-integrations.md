---
id: troubleshoot-setup-and-integrations
title: "Setup and integrations"
description: "Finish installing discern, carry on with a setup that stopped partway, and get your coding agent connected."
order: 20
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-setup-and-integrations"
  - "Setup command boundaries"
  - "setup write authority"
  - "setup activation"
  - "setup recovery"
  - "Recover an interrupted worktree setup step"
  - "worktree setup recovery"
  - "setup step journal"
  - "ambiguous setup step"
  - "command not found"
  - "no_project"
  - "write_denied"
  - "schema_version_too_new"
  - "partial_refresh"
  - "unsupported platform"
---

# Setup and integrations

If installing or setting up discern stops partway, you don't start again: setup keeps what it has finished, and each result says what's left.

Say the session ends halfway through setting up your recipe app. In a new session, ask your agent:

> "Pick up setup where it stopped, and tell me what's left and any decision you need from me."

## `discern: command not found`

Your shell can't find discern, usually because its folder isn't on your `PATH`. The installer warns when that happens:

```text
! /Users/you/.local/bin is not on PATH. Add this line to your shell profile, then open a new shell:
    export PATH="/Users/you/.local/bin:$PATH"
  Verify afterward with: command -v discern, then discern --version.
```

Add the line it prints to your shell profile, then check in a new terminal:

```sh
command -v discern
discern --version
```

If `command -v` shows another path, an older copy comes first, and the installer warns `PATH resolves discern to <old copy> before <new copy>`. Put the new folder first, or remove the old copy.

If your agent still can't find discern, its shell may not read your profile. Ask it to add the folder to its own `PATH`, or to use discern's full path. You're ready when `discern --version` works in your agent's shell.

## The installer stops

The installer checks your system and the download first, so when it stops, your existing discern is unchanged:

| What the installer prints                       | What to do                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported OS` or `unsupported architecture`  | See [Platforms and providers](../30-reference/platforms-and-providers.md). On Windows, use WSL 2.                                              |
| `no writable install dir`                       | Set `DISCERN_BIN_DIR` to a writable folder on your `PATH`, and rerun the installer.                                                            |
| `download failed` or `checksum download failed` | Check your connection and retry. If discern.sh is down, use the [fallback installer](../00-start/installation-and-setup.md#1-install-discern). |
| `checksum verification failed`                  | Don't use the download. Retry later, and report it if it keeps failing.                                                                        |

## Setup won't start

The result names the problem:

| What you see                                            | What to do                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `no_project`: `discern could not find a project`        | Move into your project folder, or ask your agent to set discern up.                              |
| `setup_unfinished`: `this project isn't set up yet`     | Setup hasn't finished, so commands such as `discern accept` refuse. Ask your agent to resume it. |
| `no_repository`                                         | Setup needs a Git repository. Your agent asks before running `git init`.                         |
| `missing_git_identity`: `No git identity is configured` | Set your Git name and email with `git config user.name` and `git config user.email`.             |
| `write_denied`: `discern cannot write … at <path>`      | Nothing was written. Give discern write access to that path and retry.                           |

## Your discern is older than the project

If a teammate set up or upgraded the project with a newer discern, yours stops before changing anything:

- `schema_version_too_new`: `this project needs a newer discern — re-run the installer`. The project's configuration schema is newer than this binary.
- `This project was last upgraded with discern <version>; this binary is <older>`.

Install the new version as [Upgrade the project](../20-guides/maintain-or-remove-discern.md#upgrade-the-project) describes, then restart your coding-agent sessions.

## `discern.toml` can't be read

If discern can't read its settings, the command exits with code `1` and one of these codes:

- **`invalid_toml`:** the file isn't valid TOML, such as a missing quote. When it can, the message names the line: `syntax error near line`.
- **`invalid_config`:** a setting is wrong or unknown.

Your agent fixes each listed problem, using the [configuration reference](../30-reference/config-reference.md), and checks the file with `discern doctor` before retrying. If the message says `The running discern process does not recognize` a section, check for a typo, or restart the session if discern or `discern.toml` changed since the session started.

## Setup was interrupted

Back in the recipe app, your agent runs `discern setup`, which reports whether setup is not started, in progress, or done, and names the next command.

If the result of `discern setup done` got lost, your agent runs it again. For an unchanged commit that already passed, discern returns the saved **Proof**, its record of which commands passed on that commit:

```text
This exact clean commit already has current Proof; no write, worktree probe, or gate job ran.
```

If anything changed, the checks run again, and uncommitted changes need a commit first.

## A worktree setup step may have finished

In each new **worktree**, a separate copy of the project for one task, discern runs your project's setup steps, such as loading sample recipes into a test database. If a step stopped partway, the result says it's `recorded as running` and that discern `cannot prove whether its arbitrary shell command completed`.

Running the step again could load the same recipes twice, so discern waits for you to decide. Your agent checks whether the test database already has the recipes and tells you what it found. Once you decide, it runs one of these:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
discern worktree setup --retry-step <id> --confirmed
```

The first marks the step finished, and the second runs it again. `--confirmed` records your decision, so the agent adds it only after you've answered. If nobody can tell, leave the step and ask whoever runs that database.

## Setup can't prove or land

`discern setup done` checks the setup and runs the full **gate**: your project's own commands, such as its tests and linter. It runs them in your project folder and in a fresh worktree like the ones future tasks use. If it fails, your agent fixes the first problem the result names and runs it again.

If a test passes in your main checkout but fails in the fresh worktree, your agent adds what's missing to the right setting:

| What the worktree needs                                         | Where it goes          |
| --------------------------------------------------------------- | ---------------------- |
| Something every checkout needs, such as installed dependencies. | `[repository].ensure`  |
| Preparation for each new worktree.                              | `[worktree.setup]`     |
| A separate service per worktree, such as a test database.       | `[worktree.resources]` |

When setup passes, your agent brings it back for review, and lands it with `discern setup accept` only when you say so. If setup was reported **unproven**, acceptance refuses until `discern setup done` passes.

## `discern doctor` reports a failed check

`discern doctor` checks your installation and ends with `All checks passed` or `N checks failed — see the fixes above.` A failed check can stop work, such as a missing command the gate runs, while a warning is advice. Apply the fix doctor prints and run it again. It's fixed when that check passes.

Findings about how Git merges discern's generated files name the exact setting, or the file and rule, to change. If discern's own entry in `.gitattributes` is missing or out of date, `discern refresh` puts it back.

## An agent's integration files are missing or stale

discern writes each coding agent's instructions, skills, and connection settings. If they're missing or stale, your agent rebuilds them with `discern refresh`, then reviews and commits them. Refresh prints `refresh: every managed artifact is current.` when nothing needed changing.

Refresh skips a settings file that isn't valid JSON and reports `malformed JSON`: fix it and refresh again. After a `partial_refresh` from setup or an upgrade, the earlier steps still stand, and the result names a safe retry.

Refresh overwrites edits to these generated files, so change their source instead. [Files and ownership](../30-reference/files-and-ownership.md) shows which files are sources.

## The tools don't appear in the agent's session

Coding agents load tools only when a session starts, so start a fresh session and ask your agent to call discern's status tool: `discern_status`, or `mcp__discern__discern_status` in Claude Code and Codex.

If it's missing:

1. Your agent runs `discern doctor`, which checks the agent's connection and names any trust step your coding tool needs.
2. If your coding tool asks you to trust discern's server, approve it there yourself.
3. Meanwhile, the agent works through the command line with `discern status --json`.

It's working when a new session's status call gets an answer, because files on disk can't show that a session loaded them. If the tools worked before and then stopped, see [MCP, terminal, and docs](mcp-terminal-and-docs.md#the-discern-tools-are-missing-from-the-session).

## When to stop

Your agent keeps fixing within the setup you asked for. It stops and asks you when:

- a result asks for your go-ahead to set up or land;
- only a person can tell whether a setup step ran;
- your coding tool asks you to trust discern's server.

If a result's fix doesn't work, keep the result and the state it describes, and [report it](crashes-and-local-state.md#report-it).
