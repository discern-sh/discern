---
title: FAQ and troubleshooting
description: Diagnose common setup, command, MCP, platform, monorepo, worktree, and removal problems.
order: 40
aliases:
  - faq
  - troubleshooting
  - setup problems
  - doctor
---

# FAQ and troubleshooting

_Match the symptom below, apply the first fix, and use the linked guide when the problem belongs to another part of discern._

## Start with `discern doctor`

Run the install diagnostic from anywhere inside the project:

```sh
discern doctor
```

It checks that `discern.toml` parses, the schema matches the installed binary, configured commands resolve on `PATH`, and each selected coding agent has its expected integration. For a bug report, capture the structured result:

```sh
discern doctor --json
```

## `discern: command not found`

Open a new shell, then run `which discern`. If it prints nothing, add the install directory reported by the installer to your shell's `PATH`. When a coding agent launches a non-interactive shell, make sure that shell reads the same `PATH`, or give the agent the absolute binary path.

## The `discern_*` MCP tools are unreachable

Restart the coding-agent session first. MCP servers and hooks load when a session starts, so the session that ran setup cannot see newly written integration files.

If the tools remain unavailable, run `discern doctor`. Codex, Gemini, Cursor, and GitHub Copilot may keep committed integration settings inactive until you trust the folder. The diagnostic names the provider-specific action.

Use the CLI with `--json` while the MCP connection is unavailable. Every discern MCP tool has a CLI verb behind it.

## `discern done` failed

Read the diagnostic returned for the failed job. It names the tool, the command that reproduces the failure, and the captured output. Give that result to your agent. [When the gate fails](../20-quality-gate/when-the-gate-fails.md) covers stage failures and recovery; `discern doctor` rules out missing tools or an invalid install.

## The project schema is newer than this binary

Update the binary before running the project upgrade. The repository was upgraded by a newer discern, so the older binary refuses to stamp the schema backward. Follow [Upgrade discern](upgrade-discern.md).

## Windows reports an unsupported platform

Run discern under WSL2. Native Windows shells are not supported. macOS and Linux binaries are published for x86-64 and ARM64.

## A monorepo needs different commands per component

Use one discern install at the git root. Root capabilities cover shared checks. Add a scope for a component that needs its own gate:

```toml
[scopes.web]
paths = ["apps/web/**"]
gate = "npm --prefix apps/web test"
```

The scoped command runs when a matching path changes.

## Worktrees are using too much disk

Land finished work with `discern accept`. It removes the accepted worktree. Then run `discern worktree prune` to clear merged worktrees and stale git administration left by manual deletion. Change `[worktree].root` if the default sibling directory is unsuitable.

## Remove discern from the repository

Preview removal, then apply it:

```sh
discern uninstall --dry-run
discern uninstall
```

The command removes generated artifacts and discern's entries in shared integration files. It keeps `discern.toml` and authored content under `discern/`. [Files & ownership](../70-reference/artifact-ownership.md) lists the full footprint and the final binary-removal step.

## Report a bug or security issue

Open a GitHub issue and include `discern doctor --json`. For a security issue, follow the repository's `SECURITY.md` instructions instead of posting publicly.
