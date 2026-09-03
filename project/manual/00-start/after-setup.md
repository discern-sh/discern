---
id: start-after-setup
title: "After setup"
description: "Read the setup diff with confidence: what you author, what discern shares with you, what it regenerates, and what stays outside the repository."
order: 40
publish: true
kind: explanation
aliases:
  - "start-after-setup"
  - "What setup added to your repo"
  - "what discern writes"
  - "setup diff"
  - "installed files"
---

# After setup

Setup hands you a branch and asks for a landing decision, so the diff on `discern-setup` deserves a reading before you say yes. This page makes that reading fast. Every file in the diff belongs to a group, each group has one owner, and each has one supported way to change it. Knowing the groups tells you what you're agreeing to maintain, and what discern maintains for you.

The same groups keep mattering after you land. When you want to change how agents work in the project, the group a file belongs to says whether you edit it, configure it, or regenerate it. For the exhaustive path-by-path inventory, including what removal leaves behind, use [Files and ownership](../30-reference/files-and-ownership.md).

## Files you and your agents author

These are project sources. They carry your project's knowledge, they're yours to edit, and your agents maintain them as the project changes:

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it contains                                                      | How to change it                                         |
| ------------------------- | ------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `discern/instructions.md` | Project-owned | Instructions shared by every configured coding agent.                 | Edit the Markdown, then run `discern refresh`.           |
| `discern/map/`            | Project-owned | The maintained project guide (the Map) agents keep current.           | Edit the authored Markdown. `[map].dir` can relocate it. |
| `discern/TODO.md`         | Project-owned | Deferred work the agents keep visible.                                | Edit it like any tracked project file.                   |
| `discern/brief.md`        | Project-owned | The project description recorded during setup, when one was captured. | Update it when the project's purpose materially moves.   |
| `discern/skills/`         | Project-owned | Skills your project authors or overrides, once it has any.            | Add or edit each Skill at its source.                    |
| `discern/scripts/`        | Project-owned | Project-specific executables reached through `discern scripts`.       | Edit and test the executable itself.                     |

<!-- /discern-workflow -->

Setup writes the instruction source, the Map, and the deferred-work ledger for every project. The other paths appear when your project first uses them. The `discern/` folder holds authored material only; generated copies live elsewhere, which is what keeps this folder safe to edit.

## Files discern shares with you

`discern.toml` at the repository root is the configuration. The values are yours: the Gate's commands, the worktree location, every setting the [config reference](../30-reference/config-reference.md) lists. `discern upgrade` may restore missing sections or refresh the explanatory banners around them; it doesn't replace values you set.

Your `.gitignore` gains one marked `# --- discern ---` block, which discern rebuilds to cover materialized Skills and machine-local settings. Keep your own rules outside the block and both can evolve without collisions.

Each coding tool you selected also gains integration entries: discern's MCP server, session hooks, and permission defaults, added into that provider's existing configuration files. Unrelated entries in those files stay untouched. [Connect a coding agent](../10-guides/connect-a-coding-agent.md) lists the paths per provider.

## Files discern regenerates

Agent files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are compiled: discern's built-in operating instructions plus your `discern/instructions.md`, rendered per provider. They're committed, so a bare clone gives its coding agents the same instructions without a discern install.

Never edit a compiled file by hand. Change the source and run `discern refresh`; the Gate fails a tracked generated file that has drifted from its source, which is how the copies stay trustworthy. Materialized Skill folders, such as `.claude/skills/`, follow the same rule with less ceremony: Git ignores them and `discern refresh` rebuilds them.

## What stays outside the repository

Parts of the practice never join the diff:

- **Task workspaces.** The first `discern start` creates a sibling folder, `<repo>.worktrees` by default, holding one isolated worktree per task. `discern accept` removes a worktree when its work lands, and `discern worktree prune` clears abandoned leftovers.
- **The Logbook.** discern's local activity record lives inside the repository's Git directory, holds metadata about discern use rather than code or command output, and never enters tracked files. [Local control](../20-understand/local-control.md) covers where evidence lives and what leaves your machine, which is nothing on discern's account.

## The decision the diff supports

Setup's completion ran the full Gate over this branch and recorded [Proof](../20-understand/proof.md) for its exact tip, so the question in front of you isn't whether the checks passed. It's whether this account of your project, its instructions, its Map, and its declared checks, is what future sessions should inherit. When it is, landing is one command away in the [tutorial](first-success.md#5-review-and-land-setup); when something's off, say so and the agent revises the branch and proves it again.
