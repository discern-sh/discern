---
title: Platforms & prerequisites
description: Supported operating systems and architectures, required tools, identity selectors, and worktree command tokens.
order: 120
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
  - discern identity
  - identity tokens
---

# Platforms and prerequisites

_The release targets and local tools discern requires, followed by identity selectors and worktree command tokens._

## Supported release targets

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

There is no native Windows release. Run the Linux binary inside Windows Subsystem for Linux (WSL). The installer rejects other operating systems and architectures before downloading an asset. Release CI verifies the WSL path: a release-blocking job runs the full repository gate inside WSL 2 Ubuntu on a hosted Windows runner before every publication ([ADR 0278](../_adr/0278-wsl-support-is-proven-by-a-hosted-wsl2-gate-lane.md)).

## Required tools

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

`doctor` checks root discovery, configuration, schema, tools, repository shape, jobs, resources, Instructions, Skills, integrations, and the managed `.gitattributes` block. It also gives every canonical tracked generated path to Git's NUL-delimited `check-attr` protocol. This detects effective `merge` values changed by later, nested, or repository-local attribute rules, including paths with spaces or newlines. In a linked worktree, doctor separately requires the effective `merge.discern-generated.driver=true` entry to come from worktree-local configuration and reports Git's scope and origin. These checks are diagnostic-only: doctor never rewrites project attribute files or Git configuration. For each `[generated.<name>]`, it probes `run`'s leading word and warns when `paths` match no tracked file, only untracked or ignored files, or another group's files. It never runs generators. Warnings keep exit 0. Failures name a fix.

## Installer behavior

The installer's `DISCERN_*` inputs are listed in [Environment variables](environment-variables.md#installation). `NO_COLOR` disables styled installer output when set.

The installer makes up to three download attempts for transient failures. It places the binary and its `.sha256` file in a staging directory beside the install destination, so the final rename stays on one filesystem. It verifies the checksum before replacing an existing installation. If the installed command does not resolve on `PATH`, the installer prints a persistent shell-profile fix. It does not print the setup handoff until `discern` is directly usable.

After installation, discern itself makes no network calls. Project commands remain free to use the network because they belong to the project.

## Worktree identity selectors

Run `discern identity` inside a linked worktree. With no selector it prints the id.

| Selector            | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `--id`              | Stable worktree id.                                                                |
| `--branch`          | Branch prefix plus the id.                                                         |
| `--port`            | Deterministic development port, `17290 + cksum(id) % 2000`.                        |
| `--site`            | Domain Name System (DNS) compatible project slug plus id, fitted to 63 characters. |
| `--db`              | Database-compatible project slug plus id, using underscores.                       |
| `--worktree`        | Generic project-slug-plus-id handle.                                               |
| `--resource <name>` | Stable project-slug-plus-id-plus-name handle for one declared resource.            |
| `--resources`       | Every declared resource printed as `name=handle`.                                  |

For example:

```sh
discern identity --resource database
```

Identity resolution checks the [worktree id override](environment-variables.md#worktree-identity) in the process, then the configured env files, then git's linked-worktree metadata. An explicit path argument inspects another worktree.

## Worktree env files

`[worktree].env_files` defaults to `.env` followed by `.env.local`; the last file defining a key wins. `[worktree].inherit_env` names values copied from the main checkout. The lifecycle writes the public values listed under [Worktree environment](environment-variables.md#worktree-environment) when their conditions apply. Resource commands receive the same handles in their process environment even when no env file exists. `discern identity --resource <name>` reports the resource handle directly.

## Worktree command tokens

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
