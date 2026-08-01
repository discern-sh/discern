---
title: Platforms & prerequisites
description: Supported operating systems and architectures, required tools, environment variables, identity selectors, and worktree tokens.
order: 90
publish: true
aliases:
  - platforms
  - prerequisites
  - system requirements
  - macOS
  - Linux
  - Windows
  - WSL
  - x86_64
  - aarch64
  - arm64
  - environment variables
  - DISCERN_NO_ATTRIBUTION
  - DISCERN_WORKTREE_ID
  - DISCERN_WORKTREE_PORT
  - DISCERN_RESOURCE
  - discern identity
  - identity tokens
---

# Platforms and prerequisites

_The release targets and local tools discern requires, followed by the environment and identity values available to project commands._

## Supported release targets

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

There is no native Windows release. Run the Linux binary inside Windows Subsystem for Linux (WSL). The installer rejects other operating systems and architectures before downloading an asset.

## Required tools

| Context                    | Requirement                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Download installer         | POSIX `sh`, `uname`, `mktemp`, standard file utilities, `sha256sum` or `shasum`, and `curl` or `wget`.       |
| Install destination        | A writable `DISCERN_BIN_DIR`. On macOS, the installer tries writable `/usr/local/bin` before `~/.local/bin`. |
| discern runtime            | `sh` and `git` on `PATH`. Configured gate and resource commands run through `sh -c`.                         |
| Isolated-worktree workflow | A git repository whose project root is the repository root, with at least 1 commit to branch from.           |
| Project checks             | Every executable named by jobs, standards, setup steps, and resource commands available on `PATH`.           |

The released binary is self-contained. A project does not need Deno or Node to run discern. Setup can create files outside a git repository, but `discern start` remains unavailable until the project is a repository with a first commit.

Run the live prerequisite and install checks from any directory inside the project:

```sh
discern doctor
```

`doctor` checks root discovery (a working directory nested in a repository that resolves to an outer project), `discern.toml`, schema currency, `sh`, `git`, repository shape, configured job commands, resource-command executables, generated guidance, skills, and provider integration state. A warning keeps the command green; a failed required check exits non-zero and carries a fix.

## Installer environment variables

| Variable          | Default or behavior                                                             |
| ----------------- | ------------------------------------------------------------------------------- |
| `DISCERN_REPO`    | GitHub release repository; defaults to `jackwh/discern`.                        |
| `DISCERN_VERSION` | Release tag to download; defaults to `latest`.                                  |
| `DISCERN_BIN_DIR` | Install directory; overrides the `/usr/local/bin` and `~/.local/bin` selection. |
| `NO_COLOR`        | Disables styled installer output when set.                                      |

The installer makes up to three download attempts for transient failures. It places the binary and its `.sha256` file in a staging directory beside the install destination, so the final rename stays on one filesystem. It verifies the checksum before replacing an existing installation. If the installed command does not resolve on `PATH`, the installer prints a persistent shell-profile fix. It does not print the setup handoff until `discern` is directly usable.

After installation, discern itself makes no network calls. Project commands remain free to use the network because they belong to the project.

## Runtime and Project Script environment

| Variable                         | Consumer and value                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `DISCERN_TRUNK`                  | Per-process override for the configured trunk branch.                                   |
| `DISCERN_NO_ATTRIBUTION`         | Omits the `discern` co-author trailer from discern-composed commits when non-empty.     |
| `DISCERN_PROJECT_SLUG`           | Per-process override for the project slug used in derived identity.                     |
| `DISCERN_WORKTREE_BRANCH_PREFIX` | Per-process override for the worktree branch prefix.                                    |
| `DISCERN_WORKTREE_ID`            | Optional explicit worktree id; accepts letters, numbers, dots, dashes, and underscores. |
| `DISCERN_ROOT`                   | Absolute project root exported to a Project Script.                                     |
| `DISCERN_TOML`                   | Absolute path to the active config exported to a Project Script.                        |
| `DISCERN_SCRIPTS`                | Absolute configured Project Scripts directory exported to a Project Script.             |
| `DISCERN_SCRIPTS_DIR`            | The configured Project Scripts directory value exported to a Project Script.            |
| `DISCERN_DESK_SESSION`           | `1` in desk-launched processes; `discern doctor` reports it.                            |

Project Scripts also receive `DISCERN_TRUNK`. They read other config through `discern config get|array|has|subsections|keys` rather than parsing TOML or sourcing a helper library.

## Worktree identity selectors

Run `discern identity` inside a linked worktree. With no selector it prints the id.

| Selector            | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `--id`              | Stable worktree id.                                                     |
| `--branch`          | Branch prefix plus the id.                                              |
| `--port`            | Deterministic development port, `17290 + cksum(id) % 2000`.             |
| `--site`            | DNS-safe project slug plus id, fitted to 63 characters.                 |
| `--db`              | Database-safe project slug plus id, using underscores.                  |
| `--worktree`        | Generic project-slug-plus-id handle.                                    |
| `--resource <name>` | Stable project-slug-plus-id-plus-name handle for one declared resource. |
| `--resources`       | Every declared resource printed as `name=handle`.                       |

For example:

```sh
discern identity --resource database
```

Identity resolution checks `DISCERN_WORKTREE_ID` in the process, then the configured env files, then git's linked-worktree metadata. An explicit path argument inspects another worktree.

## Values written to worktree env files

`[worktree].env_files` defaults to `.env` followed by `.env.local`; the last file defining a key wins. `[worktree].inherit_env` names values copied from the main checkout. The lifecycle records these derived values when an env file exists:

| Variable                  | Value                                      |
| ------------------------- | ------------------------------------------ |
| `DISCERN_WORKTREE_PORT`   | Deterministic port for this worktree.      |
| `DISCERN_WORKTREE`        | Generic worktree handle.                   |
| `DISCERN_RESOURCE_<NAME>` | Stable handle for one configured resource. |

Resource commands receive their own `DISCERN_RESOURCE_<NAME>` and `DISCERN_WORKTREE` values in the process environment even when no env file exists. `discern identity --resource <name>` reports the same handle directly.

## Worktree command tokens

discern replaces these literal tokens before running a resource command or a `[worktree.setup]` command:

| Token            | Replacement                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `@db@`           | Database-safe worktree identity.                                                          |
| `@site@`         | DNS-safe worktree host label.                                                             |
| `@port@`         | Deterministic worktree port.                                                              |
| `@worktree@`     | Generic worktree handle.                                                                  |
| `@resource@`     | Current resource's handle; empty in setup commands that are not attached to one resource. |
| `@project_slug@` | Configured project slug.                                                                  |
| `@dir@`          | Absolute worktree root.                                                                   |

Token replacement is literal and happens only for tokens present in the command. Use `@site@` when the destination requires a 63-character DNS label; `@resource@` has no DNS length limit.
