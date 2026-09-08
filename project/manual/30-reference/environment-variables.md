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

Inputs read by the POSIX installer.

| Variable          | What it does                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `DISCERN_REPO`    | GitHub release repository the installer downloads from. Defaults to `jackwh/discern`.         |
| `DISCERN_VERSION` | Release version the installer downloads, with or without a leading `v`. Defaults to `latest`. |
| `DISCERN_BIN_DIR` | Install directory. Overrides the installer's automatic destination selection.                 |

## Runtime overrides

Per-process overrides for discern's runtime behavior.

| Variable                 | What it does                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_TRUNK`          | Overrides `[repository].trunk` for the current process. Project Scripts receive the resolved trunk in the same variable.                     |
| `DISCERN_NO_ATTRIBUTION` | Uses source-only generated-file markers and omits the discern co-author trailer from commits discern composes when set to a non-empty value. |

## Worktree identity

Inputs that override the identity derived for a worktree.

| Variable                         | What it does                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DISCERN_PROJECT_SLUG`           | Overrides `[project].slug` when discern derives worktree identities.                                                           |
| `DISCERN_WORKTREE_BRANCH_PREFIX` | Overrides `[repository].branch_prefix` when discern derives worktree branch names.                                             |
| `DISCERN_WORKTREE_ID`            | Sets an explicit worktree id in the process or a configured env file. Accepts letters, numbers, dots, dashes, and underscores. |

## Project Scripts

Values discern exports before running a Project Script.

| Variable              | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `DISCERN_ROOT`        | Absolute project root exported to a Project Script.                         |
| `DISCERN_TOML`        | Absolute path to the active `discern.toml` exported to a Project Script.    |
| `DISCERN_SCRIPTS_DIR` | Absolute configured Project Scripts directory exported to a Project Script. |

## Checkpoint commands

Structured inputs exported to checkpoint `when` commands.

| Variable                   | What it does                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCERN_CHECKPOINT_INPUT` | Absolute path to the versioned JSON facts without raw file content for the current checkpoint `when` command. See the [checkpoint `when` protocol](https://discern.sh/map/reference/checkpoint-when-protocol). The file exists only while that command runs. |

## Worktree environment

Identity values passed to resource commands or written to configured worktree env files.

| Variable                  | What it does                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCERN_WORKTREE_PORT`   | Deterministic development port written to a configured worktree env file when `[worktree].port = true`.                               |
| `DISCERN_WORKTREE`        | Generic worktree handle supplied to resource commands and written to configured env files when resources are declared.                |
| `DISCERN_RESOURCE_<NAME>` | Stable handle for one declared resource. `<NAME>` is the resource name uppercased with non-alphanumeric runs replaced by underscores. |

## Experimental features

User-facing controls for experiments whose names and behavior remain subject to change.

| Variable                                  | What it does                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `DISCERN_EXPERIMENTAL_MCP_PRELOAD`        | Requests eager discern MCP loading in supported provider integrations when set to `1`. |
| `DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS` | Sets a positive whole-number cap for one experimental automatic await call.            |
