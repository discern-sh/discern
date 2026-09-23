---
id: reference-environment-variables
title: "Environment variables"
description: "Look up the DISCERN_* settings you can supply and the values discern passes to project commands."
order: 60
publish: true
kind: reference
aliases:
  - "reference-environment-variables"
  - "env vars"
  - "DISCERN_REPO"
  - "DISCERN_VERSION"
  - "DISCERN_BIN_DIR"
  - "DISCERN_TRUNK"
  - "DISCERN_NO_ATTRIBUTION"
  - "DISCERN_PROJECT_SLUG"
  - "DISCERN_WORKTREE_BRANCH_PREFIX"
  - "DISCERN_WORKTREE_ID"
  - "DISCERN_ROOT"
  - "DISCERN_TOML"
  - "DISCERN_SCRIPTS_DIR"
  - "DISCERN_CHECKPOINT_INPUT"
  - "DISCERN_WORKTREE_PORT"
  - "DISCERN_WORKTREE"
  - "DISCERN_RESOURCE_<NAME>"
  - "DISCERN_EXPERIMENTAL_MCP_PRELOAD"
  - "DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS"
---

<!-- This reference is generated from the environment-variable registry. -->

# Environment variables

Environment variables pass settings to a running program. Some let you change how discern starts; others give your project scripts information such as the current worktree or its assigned port. This page lists the supported `DISCERN_*` variables by purpose.

Find the variable name below to see who sets it, who reads it, and its default where one exists. Setting a variable affects the current process unless its entry says discern exports or writes it. For lasting project settings, use [`discern.toml`](config-reference.md).

## Installation

You can set these when you run the install script, to change what it downloads and where it puts discern.

| Variable          | What it does                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_REPO`    | The GitHub repository, as `owner/repo`, whose releases the install script downloads. Default: `discern-sh/discern`.                                                                                           |
| `DISCERN_VERSION` | The release the install script downloads, with or without a leading `v`. Default: `latest`.                                                                                                                   |
| `DISCERN_BIN_DIR` | The folder the install script puts discern in, created if it doesn't exist. Without it, the script uses a writable `/usr/local/bin` on macOS, and otherwise `~/.local/bin`, then a writable `/usr/local/bin`. |

## Runtime overrides

You can set these to change how discern behaves, for one command or for your whole session.

| Variable                 | What it does                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_TRUNK`          | Use a different trunk than `[repository].trunk` while it's set; an empty value is ignored. discern also sets it for each project script, to the trunk in use.                                                                                                                                                                                                 |
| `DISCERN_NO_ATTRIBUTION` | Set it to any non-empty value to leave discern's name off what it writes. Generated-file markers drop discern's name and web address, commits discern makes drop its co-author line, and Proof notes use your Git identity instead of discern's. Keep it set the same way for every command, or `discern upgrade --check` reports the markers as out of date. |

## Worktree identity

You can set these to replace the names discern works out for a worktree.

| Variable                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCERN_PROJECT_SLUG`           | Use this slug instead of `[project].slug` in a worktree's site, database, and resource names. discern converts it to lowercase and turns other characters into dashes; the `@project_slug@` token keeps the configured slug.                                                                                                                                                                                             |
| `DISCERN_WORKTREE_BRANCH_PREFIX` | Use this prefix instead of `[repository].branch_prefix` for worktree branch names. An empty value means no prefix.                                                                                                                                                                                                                                                                                                       |
| `DISCERN_WORKTREE_ID`            | Give a worktree a chosen id, which its port, site, database, and resource names follow. Set it in the environment, where it applies to the worktree the command runs in, or on a line in that worktree's env files. It starts with a letter or digit and continues with letters, digits, dots, dashes, or underscores, up to 81 characters; discern converts it to lowercase and turns dots and underscores into dashes. |

## Project Scripts

discern sets these for a project script each time it runs one, from `discern scripts` or the desk. It removes any other `DISCERN_*` variables from the script's environment.

| Variable              | What it does                                                  |
| --------------------- | ------------------------------------------------------------- |
| `DISCERN_ROOT`        | Absolute path of the project root.                            |
| `DISCERN_TOML`        | Absolute path of the `discern.toml` in use.                   |
| `DISCERN_SCRIPTS_DIR` | Absolute path of the project scripts folder, `[scripts].dir`. |

## Checkpoint commands

discern sets these for a checkpoint's `when` command while it runs.

| Variable                   | What it does                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_CHECKPOINT_INPUT` | Absolute path of a JSON file that describes the change for the checkpoint's `when` command. It holds facts about the changed files, but not their contents, in the versioned format the [checkpoint `when` protocol](https://github.com/discern-sh/discern/blob/main/project/map/70-reference/checkpoint-when-protocol.md) describes. The file exists only while the command runs. |

## Worktree environment

discern gives these to a worktree's resource commands or writes them into its env files, as each entry describes. It only writes into env files that already exist.

| Variable                  | What it does                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCERN_WORKTREE_PORT`   | The worktree's stable development port. discern writes it into the worktree's env file when `[worktree].export_port = true`; `discern identity --port` prints it either way.                                                                                                                                       |
| `DISCERN_WORKTREE`        | The worktree's resource handle, a stable name made from the project slug and worktree id. discern gives it to every resource command, and writes it into the env files when a resource has a `create` or `destroy` command.                                                                                        |
| `DISCERN_RESOURCE_<NAME>` | The stable name of one declared resource. Each resource command gets its own resource's variable, and discern writes them into the env files alongside `DISCERN_WORKTREE`. `<NAME>` is the resource's name in uppercase, with each run of other characters turned into one underscore and any at the ends removed. |

## Experimental features

You can set these to try an experiment. Their names and behavior may change in any release.

| Variable                                  | What it does                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_EXPERIMENTAL_MCP_PRELOAD`        | Set it to `1` to have coding agents that support it load discern's MCP tools at startup instead of on first use. discern applies it whenever it writes agents' MCP settings, as `discern refresh` does. Use the same setting when you run `discern done`, which checks those settings against what a refresh would write. |
| `DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS` | Limit each await to this many whole seconds; it can only shorten the usual limit. It applies to every agent `discern_await` call and to `discern await` without `--timeout`. An explicit `--timeout` on the command line still applies in full.                                                                           |
