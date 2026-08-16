---
title: After setup
description: Read the setup diff file by file, including what you edit, what discern shares, and what it regenerates.
order: 40
aliases:
  - after setup
  - what discern writes
  - setup diff
  - installed files
---

# What setup added to your repo

_Setup works on a `discern-setup` branch. This guide tells you what each part of that branch is for and who edits it._

Review the branch before landing it. The paths depend on the coding agents you selected and any locations you configured, but each written file belongs to one of the groups below. For the exhaustive inventory and uninstall behavior, use [Files & ownership](../70-reference/artifact-ownership.md).

## Files you edit

These are project sources. Your agents maintain them as the project changes.

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it contains                                                | How to change it                                         |
| ------------------------- | ------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `discern/instructions.md` | Project-owned | Instructions shared by every configured coding agent.           | Edit the Markdown, then run `discern refresh`.           |
| `discern/TODO.md`         | Project-owned | Deferred work the agents keep visible.                          | Edit it like any tracked project file.                   |
| `discern/brief.md`        | Project-owned | The project description captured during setup.                  | Update it when the project's purpose materially moves.   |
| `discern/skills/`         | Project-owned | Skills your project creates or overrides.                       | Add or edit each Skill at its source.                    |
| `discern/scripts/`        | Project-owned | Project-specific executables reached through `discern scripts`. | Edit and test the executable itself.                     |
| `discern/map/`            | Project-owned | The documentation map your agents keep current with the code.   | Edit the authored Markdown. `[map].dir` can relocate it. |

<!-- /discern-workflow -->

The `discern/` namespace contains authored material only. Generated copies do not belong there ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

## Files discern shares with you

`discern.toml` is the root configuration file. You own its values and ordinary comments. `discern upgrade` may restore missing fixed sections or keys and refresh discern-owned ruled banners from the current template; it does not replace values you set.

Fresh setup leaves `discern tidy` in the format job. It canonically formats the Map, instruction sources, deferred-work ledger, and root config. If the project has its own formatter, that command runs first. Remove the tidy entry to opt out. See [Format discern-owned surfaces](../20-quality-gate/tidy.md) for the exact boundary.

The `.gitignore` file gains one marked `# --- discern ---` block. Keep your rules outside that block. discern rebuilds the block from the artifact registry so it ignores materialized skills and machine-local settings without sweeping up unrelated files.

Each selected coding agent also has integration files. discern adds its own Model Context Protocol (MCP) server, hooks, and permission defaults to the provider's existing configuration. It leaves unrelated entries in place. The [agent integration guides](../60-agent-integrations/) list the exact paths for each provider.

## Files discern regenerates

Agent files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` come from discern's built-in instructions plus your authored sources. The files are committed so a bare clone gives its coding agents the same instructions. Edit the source and run `discern refresh`. The Gate rejects a tracked generated copy that has drifted ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)).

Git ignores materialized Skill directories such as `.agents/skills/` and `.claude/skills/`. `discern refresh` recreates them from bundled and authored Skills.

## The worktree directory appears later

The first `discern start` creates a sibling directory named `<repo>.worktrees/` by default. Each child is an isolated workspace for one task (a Git worktree). `discern accept` removes a landed worktree. `discern worktree prune` clears merged or orphaned leftovers.

Next, follow the [setup walkthrough](walkthrough.md) or go to the [FAQ](faq.md) if the diff does not match this guide.
