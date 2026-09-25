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

If installing or setting up discern stops partway, you don't start again: setup keeps what it has finished, and each result says what's left. This page helps you find where it stopped, carry on, and get your coding agent talking to discern.

Say you're setting up discern in your recipe app and the session ends halfway through. In a new session, ask your agent:

> "Find where setup stopped and follow the next step its result names. Tell me what's finished, what's left, and whether you need a decision from me."

## `discern: command not found`

Your shell can't find the discern program, usually because its folder isn't on your `PATH`. The installer prints where it put discern, such as `installed discern to /Users/you/.local/bin/discern`, and warns when that folder isn't on your `PATH`:

```text
! /Users/you/.local/bin is not on PATH. Add this line to your shell profile, then open a new shell:
    export PATH="/Users/you/.local/bin:$PATH"
  Verify afterward with: command -v discern, then discern --version.
```

Add the line it prints to your shell profile, open a new terminal, and check:

```sh
command -v discern
discern --version
```

If `command -v` shows a different path, an older copy comes first, and the installer warns about that too: `PATH resolves discern to <old copy> before <new copy>`. Put the new folder first in your shell profile, or remove the old copy.

If discern works in your terminal but your agent can't find it, the agent's shell may not read your shell profile. Ask your agent to check its own `PATH`, then add the folder there or give the agent the full path to discern.

You're ready when `discern --version` works in the shell your agent uses.

## The installer stops

The installer checks your system and the download before it installs anything. If it stops, it says why:

| What the installer prints                       | What to do                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported OS` or `unsupported architecture`  | discern runs on macOS and Linux, on Intel, AMD, and ARM processors. On Windows, use WSL 2.                                                                                             |
| `no writable install dir`                       | Set `DISCERN_BIN_DIR` to a folder on your `PATH` that you can write to, then run the installer again.                                                                                  |
| `download failed` or `checksum download failed` | Check your connection and try again. If the main address is down, use the fallback installer in [Install and set up discern](../00-start/installation-and-setup.md#1-install-discern). |
| `checksum verification failed`                  | Don't use the download. Try again later, and report it if it keeps failing.                                                                                                            |

Each of these stops before your existing copy of discern changes, and the download and checksum messages say so: `was not changed`.

## Setup won't start

Setup starts with `discern setup verify`, which checks the project and changes nothing, and your agent asks for your go-ahead before it writes anything. If a check fails, the result names the problem:

| What you see                                            | What it means                                                                                      | What to do                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `no_project`: `discern could not find a project`        | You ran a command outside a project that uses discern.                                             | Move into your project folder. If it doesn't use discern yet, ask your agent to set it up. |
| `setup_unfinished`: `this project isn't set up yet`     | Setup has started but not finished. Some commands, such as `discern accept`, refuse until it does. | Ask your agent to resume setup.                                                            |
| `no_repository`                                         | Setup needs a Git repository for its branch and commits.                                           | Your agent asks you before it runs `git init`. Then it runs `discern setup verify` again.  |
| `missing_git_identity`: `No git identity is configured` | Git needs a name and email to make setup's commits.                                                | Set them with `git config user.name` and `git config user.email`, then check again.        |
| `write_denied`: `discern cannot write … at <path>`      | Something stopped discern writing a file setup needs. Nothing was written.                         | Give discern write access to that path, then retry.                                        |

## Your discern is older than the project

A teammate may have set up or upgraded the project with a newer discern than yours, and your copy then stops before it changes anything:

| What you see                                                                          | What it means                                                                                                              | What to do                                                                          |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `schema_version_too_new`: `this project needs a newer discern — re-run the installer` | The project's configuration schema is newer than this binary.                                                              | Run the installer again to get the new version, then retry.                         |
| `This project was last upgraded with discern <version>; this binary is <older>`       | A newer discern last updated discern's files. Yours won't overwrite them, but it can still read the project and run tests. | Run `discern releases`, install the update, and restart your coding-agent sessions. |

[Maintain or remove discern](../20-guides/maintain-or-remove-discern.md#upgrade-the-project) covers upgrading.

## `discern.toml` can't be read

discern reads its settings from `discern.toml`. If it can't, the command stops with exit code `1` and one of these codes:

- **`invalid_toml`:** the file isn't valid TOML, such as a missing quote. When it can, the message names the line: `syntax error near line`.
- **`invalid_config`:** the file reads, but a setting is wrong or unknown. The result lists each problem and where it is.

Your agent fixes each problem the result names, then runs `discern doctor` to check the file before retrying. The [configuration reference](../30-reference/config-reference.md) lists every setting.

If the result names a section your discern doesn't recognize, check for a typo first. If `discern.toml` or discern itself changed since your agent's session started, restart the session, because the running copy may be out of date.

## Setup was interrupted

Setup keeps its progress, so a new session carries on where the last one stopped. When you ask your agent to resume setup in the recipe app, it runs `discern setup`, which works out whether setup is not started, in progress, or done, and names the next command. Resuming with `discern setup begin` shows the setup instructions again and skips the steps already finished.

**The result of `discern setup done` got lost.** Your agent runs it again. If the setup commit hasn't changed since it passed, discern returns the saved **Proof**, its record of which commands passed on that commit, without running the checks again:

```text
This exact clean commit already has current Proof; no write, worktree probe, or gate job ran.
```

If anything changed, the checks run again. If there are uncommitted changes, discern stops and asks for a commit first.

## A worktree setup step may have finished

When discern creates a **worktree**, a separate copy of the project for one task, it runs your project's setup steps, such as loading sample recipes into a test database. If a step stopped partway, discern can't always tell whether it finished: the result names the step, says it's `recorded as running`, and says discern `cannot prove whether its arbitrary shell command completed`.

Running the step again could repeat its effect, such as loading the same recipes twice, so discern waits for a person to decide. Your agent checks the effect, such as whether the test database already has the recipes, and tells you what it found. Once you've decided, it runs one of these with the step id from the result:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
discern worktree setup --retry-step <id> --confirmed
```

The first records that the step finished, and the second runs it again. `--confirmed` records a person's decision, so the agent adds it only after you've answered. If nobody can tell whether the step finished, leave it and ask whoever looks after that database or service.

## Setup can't prove or land

`discern setup done` checks the setup and runs the full **gate**, your project's own commands such as its tests and linter. It runs the gate both in your project folder and in a fresh worktree like the ones future tasks use. If it fails, start with the first problem in the result, whether that's unfinished instructions, uncommitted files, or a failed test. Your agent fixes it and runs `discern setup done` again.

If a test passes in your main checkout but fails in the fresh copy, the copy is missing something. The result names the failing command, and your agent adds what's missing to the right setting:

| What the copy needs                                            | Where it goes          |
| -------------------------------------------------------------- | ---------------------- |
| Something every checkout needs, such as installed dependencies | `[repository].ensure`  |
| Preparation for each new worktree                              | `[worktree.setup]`     |
| A separate service for each worktree, such as a test database  | `[worktree.resources]` |

When setup passes, discern records its Proof, and your agent brings setup back for your review. Landing it is your decision: when you say so, the agent runs `discern setup accept`. If setup was reported **unproven**, acceptance refuses until `discern setup done` passes. Running `discern setup accept` again after setup has landed changes nothing, and says so.

## `discern doctor` reports a failed check

`discern doctor` checks your installation, changes nothing, and ends with `All checks passed` or `N check(s) failed — see the fixes above.` Each problem comes with a fix. A failed check can stop work, such as a command the gate runs that isn't installed, or a Git setup that can't record who made a commit, while a warning is advice.

Apply the fix doctor prints for the failed check, then run doctor again. It's fixed when that check passes.

Some findings are about how Git merges the files discern generates. Use the exact fix the finding prints, because it names the setting, or the file and rule, to change. For an attribute fix, the finding also gives a `git check-attr` command to confirm it. When discern's own entry in `.gitattributes` is missing or out of date, doctor warns, and `discern refresh` puts it back.

If a fix belongs to another system, such as file permissions, make it there. To share a finding you can't resolve, keep the output of `discern doctor --json`.

## An agent's integration files are missing or stale

discern writes files for each coding agent you use, such as its instructions, its skills, and its connection settings. If they're missing or out of date, your agent rebuilds them:

```sh
discern refresh
```

It then reviews the changes and commits them. When nothing needed changing, refresh says `refresh: every managed artifact is current.`

If a settings file isn't valid JSON, refresh leaves that file alone and reports `malformed JSON`. Fix the file, then run refresh again. If setup reports `partial_refresh`, the steps before it still stand, so run `discern refresh`. If an upgrade reports it, fix the file it names, then run `discern upgrade` again.

To change what these files say, edit the source they're built from and refresh, because refresh overwrites edits to the generated copies. [Files and ownership](../30-reference/files-and-ownership.md) shows which files are sources.

## The tools don't appear in the agent's session

Coding agents load their tools only when a session starts, so after setup lands, or after an upgrade, start a fresh session and ask the agent to call discern's status tool. Its name depends on the agent: `mcp__discern__discern_status` in Claude Code and Codex, and `discern_status` in Gemini, Cursor, and GitHub Copilot.

If the tool still isn't there:

1. Your agent runs `discern doctor`. It checks the agent's instruction file and settings, and names any trust step your coding tool needs.
2. If your coding tool asks you to trust discern's server, approve it there. discern can't do that step for you.
3. Meanwhile, the agent keeps working through the command line with `discern status --json`.

It's working when a new session calls the status tool and gets an answer, because files on disk can't show that a session loaded them. If the tools worked earlier and then stopped, see [MCP, terminal, and docs](mcp-terminal-and-docs.md#the-discern-tools-are-missing-from-the-session).

## When to stop

Your agent can keep diagnosing and fixing within the setup you asked for. It stops and asks you when:

- a result asks for your go-ahead to set up or to land;
- a setup step may or may not have run, and only a person can check;
- your coding tool asks you to trust discern's server.

If the fix a result names doesn't work, keep the result and the state it describes. [Crashes and local state](crashes-and-local-state.md) explains what to send in a report.
