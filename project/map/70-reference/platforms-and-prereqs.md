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
  - "WSL 2"
  - x86_64
  - aarch64
  - arm64
  - discern identity
  - identity tokens
---

# Platforms and prerequisites

_The release targets and local tools discern requires, followed by identity selectors and worktree command tokens._

## Supported release targets

<!-- BEGIN GENERATED BUILD TARGETS -->

| Operating system | Architecture labels accepted by the installer | Release asset                       |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| macOS            | `x86_64`, `amd64`                             | `discern-x86_64-apple-darwin`       |
| macOS            | `arm64`, `aarch64`                            | `discern-aarch64-apple-darwin`      |
| GNU/Linux        | `x86_64`, `amd64`                             | `discern-x86_64-unknown-linux-gnu`  |
| GNU/Linux        | `arm64`, `aarch64`                            | `discern-aarch64-unknown-linux-gnu` |

<!-- END GENERATED BUILD TARGETS -->

There is no native Windows release. On Windows, run the Linux binary inside WSL 2. The installer rejects other operating systems and architectures before downloading an asset. Release CI verifies this path: a release-blocking job runs the full repository gate inside WSL 2 Ubuntu on a hosted Windows runner before every publication ([ADR 0278](../_adr/0278-wsl-support-is-proven-by-a-hosted-wsl2-gate-lane.md)).

## Required tools

| Context                    | Requirement                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Download installer         | POSIX `sh`, `uname`, `mktemp`, standard file utilities, `sha256sum` or `shasum`, and `curl` or `wget`.                         |
| Install destination        | A writable directory. On macOS, the installer uses `DISCERN_BIN_DIR`, writable existing `/usr/local/bin`, then `~/.local/bin`. |
| discern runtime            | `sh` and `git` on `PATH`. Configured Gate and resource commands run through `sh -c`.                                           |
| Isolated-worktree workflow | A git repository whose project root is the repository root, with at least 1 commit to branch from.                             |
| Project checks             | Every executable named by jobs, standards, setup steps, and resource commands available on `PATH`.                             |

The released binary is self-contained. A project does not need Deno or Node to run discern. Setup can create files outside a git repository, but `discern start` remains unavailable until the project is a repository with a first commit.

Run the live prerequisite and install checks from any directory inside the project:

```sh
discern doctor
```

`doctor` checks root discovery, configuration, schema, tools, repository shape, jobs, resources, Instructions, Skills, integrations, and the managed `.gitattributes` block. It asks Git for every canonical tracked generated path's effective merge attribute through the NUL-delimited protocol and, in linked worktrees, verifies the driver is worktree-local. It reports overrides, scope, and origin but never repairs rules or configuration. For each `[generated.<name>]`, it probes `run`'s leading word and warns when `paths` match no tracked file, only untracked or ignored files, or another group's files. It never runs generators. Warnings keep exit 0. Failures name a fix.

## Installer behavior

The installer's `DISCERN_*` inputs are listed in [Environment variables](https://discern.sh/docs/reference/environment-variables#installation). `NO_COLOR` disables styled installer output when set.

The installer accepts a bare or `v`-prefixed `DISCERN_VERSION` and normalizes either form to the `v`-prefixed release tag. It makes up to three download attempts for transient failures. It refuses when the final `discern` destination is a directory. On macOS, it never selects `/opt/homebrew/bin`; Homebrew owns that prefix.

The installer places the binary and its `.sha256` file in a `.discern-install.*` staging directory beside the install destination, so the final rename stays on one filesystem. Its traps remove that directory after ordinary completion, failure, or a signal the shell can handle. A forced process kill that bypasses those traps, or a power loss, can leave the staging directory behind. When no installer is running, it is safe to remove that residue from the selected bin directory. The installer verifies the checksum before replacing an existing installation. If the installed command does not resolve on `PATH`, it prints a persistent shell-profile fix. It does not print the setup handoff until `discern` is directly usable.

After installation, discern itself makes no network calls. Project commands remain free to use the network because they belong to the project.

## Verify a release download

Choose `TAG` and the `ASSET` for your system from the generated target table above. Download the binary and its checksum sidecar from the release:

```sh
TAG=v1.0.0
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

## Worktree identity selectors

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

Linked identity checks the [id override](https://discern.sh/docs/reference/environment-variables#worktree-identity), env files, then Git metadata; main identity uses the configured trunk. A path argument inspects either checkout kind.

## Worktree env files

`[worktree].env_files` defaults to `.env` followed by `.env.local`; the last file defining a key wins. `[worktree].inherit_env` names values copied from the main checkout. The lifecycle writes the public values listed under [worktree environment](https://discern.sh/docs/reference/environment-variables#worktree-environment) when their conditions apply. Resource commands receive the same handles in their process environment even when no env file exists. `discern identity --resource <name>` reports the resource handle directly.

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
