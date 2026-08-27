---
id: start-after-setup
title: "After setup"
description: "Recognize what setup authored, shares, generates, and keeps outside the repository."
order: 40
publish: true
kind: explanation
aliases:
  - "start-after-setup"
  - "What setup added to your repo"
  - "what discern writes"
  - "setup diff"
  - "installed files"
redirect_from:
  - "/docs/getting-started/after-setup"
---

# After setup

Recognize what setup authored, shares, generates, and keeps outside the repository.

# What setup added to your repo

_Setup works on a `discern-setup` branch. This guide tells you what each part of that branch is for and who edits it._

Review the branch before landing it. The paths depend on the coding agents you selected and any locations you configured, but each written file belongs to one of the groups below. For the exhaustive inventory and uninstall behavior, use [Files & ownership](../30-reference/files-and-ownership.md).

Successful `discern setup done` commits setup's completion state and returns [Gate Proof](../20-understand/proof.md) for that clean tip. Repeating it unchanged re-serves the Proof and inventory without effects. `discern setup accept` validates and records that Proof on the landed main version. `--force` returns no Proof and cannot use this path.

Before landing, the handoff explains where later sessions start, which other areas have distinct responsibilities, one important project rule, the checks now active, and what remains open. Its explanation and supporting inventory derive from committed project files. [Setup decisions](first-success.md) explains the owner review.

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

The `discern/` namespace contains authored material only. Generated copies do not belong there ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace)).

## Files discern shares with you

`discern.toml` is the root configuration file. You own its values and ordinary comments. `discern upgrade` may restore missing fixed sections or keys and refresh discern-owned ruled banners from the current template; it does not replace values you set.

`discern config set-job format --run "<project formatter>" --run "discern tidy"` keeps `discern tidy` last; repeat `--run` to preserve order. See [Format discern-owned surfaces](../10-guides/maintain-or-remove-discern.md).

`--not-applicable` marks a missing known lifecycle; `--applicable` restores it. It changes assurance only, and configuring the job restores applicability ([ADR 0317](https://discern.sh/docs/decisions/0317-gate-commands-and-setup-applicability-are-separate-facts)).

The `.gitignore` file gains one marked `# --- discern ---` block. Keep your rules outside that block. discern rebuilds the block from the artifact registry so it ignores materialized skills and machine-local settings without sweeping up unrelated files.

Each selected coding agent also has integration files. discern adds its own Model Context Protocol (MCP) server, hooks, and permission defaults to the provider's existing configuration. It leaves unrelated entries in place. The [agent integration guides](../10-guides/connect-a-coding-agent.md) list the exact paths for each provider.

Unlanded `setup done` stops at Proof and the landing choice. After `setup accept` lands, it serves one provider-owned fresh-session instruction: inspect the registered tool inventory, invoke the exact local action, and use the included local recovery if that action is missing. See [Setup command boundaries](../40-troubleshooting/setup-and-integrations.md).

## Files discern regenerates

Agent files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` come from discern's built-in instructions plus your authored sources. The files are committed so a bare clone gives its coding agents the same instructions. Edit the source and run `discern refresh`. The Gate rejects a tracked generated copy that has drifted ([ADR 0128](https://discern.sh/docs/decisions/0128-enumerated-ownership-tracked-guidance)).

Git ignores materialized Skill directories such as `.agents/skills/` and `.claude/skills/`. `discern refresh` recreates them from bundled and authored Skills.

## The worktree directory appears later

The first `discern start` creates a sibling directory named `<repo>.worktrees/` by default. Each child is an isolated workspace for one task (a Git worktree). `discern accept` removes a landed worktree. `discern worktree prune` clears merged or orphaned leftovers.

Next, follow the [setup walkthrough](first-success.md) or go to the [FAQ](../40-troubleshooting/README.md) if the diff does not match this guide.
