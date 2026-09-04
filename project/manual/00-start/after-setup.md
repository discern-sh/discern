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
| `discern/map/`            | Project-owned | The maintained project guide (the map) agents keep current.           | Edit the authored Markdown. `[map].dir` can relocate it. |
| `discern/TODO.md`         | Project-owned | Deferred work the agents keep visible.                                | Edit it like any tracked project file.                   |
| `discern/brief.md`        | Project-owned | The project description recorded during setup, when one was captured. | Update it when the project's purpose materially moves.   |
| `discern/skills/`         | Project-owned | Skills your project authors or overrides, once it has any.            | Add or edit each skill at its source.                    |
| `discern/scripts/`        | Project-owned | Project-specific executables reached through `discern scripts`.       | Edit and test the executable itself.                     |

<!-- /discern-workflow -->

Setup writes the instruction source, the map, and the deferred-work ledger for every project. The other paths appear when your project first uses them. The `discern/` folder holds authored material only; generated copies live elsewhere, which is what keeps this folder safe to edit.

## Files discern shares with you

`discern.toml` at the repository root is the configuration. The values are yours: the gate's commands, the worktree location, every setting the [config reference](../30-reference/config-reference.md) lists. `discern upgrade` may restore missing sections or refresh the explanatory banners around them; it doesn't replace values you set.

Your `.gitignore` gains one marked block, which discern rebuilds to cover materialized skills and machine-local settings. Your `.gitattributes` gains a separate marked block for generated-file merging and Markdown diffs. Keep your own rules outside those blocks and both can evolve without collisions.

Setup adds the files each selected coding tool needs to work with discern. Depending on the tool, those files connect the MCP server, run a command when a session starts, or grant a small set of permissions. Setup leaves unrelated settings alone.

Claude Code keeps every permission rule already in its shared settings file. Codex allows `git add` and `git commit` so an agent can save its work. Those Codex rules apply wherever the commands run, but they don't allow `git push`, `git reset`, other Git commands, or general shell access. [Connect a coding agent](../10-guides/connect-a-coding-agent.md) lists the files added for each tool.

## Files discern regenerates

Agent files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` combine discern's built-in operating instructions with your `discern/instructions.md`. They're committed, so a new clone starts with the same written instructions. The MCP server, session hooks, and generated skill folders still need the discern binary on that machine. Install discern, run `discern refresh`, and open a new coding-agent session after cloning.

Never edit a compiled file by hand. Change the source and run `discern refresh`; the gate fails a tracked generated file that has drifted from its source, which is how the copies stay trustworthy. Materialized skill folders, such as `.claude/skills/`, follow the same rule with less ceremony: Git ignores them and `discern refresh` rebuilds them.

## One repository, one installation

Install discern once at the root of each Git repository. In a monorepo, the root `discern.toml` can give different parts of the repository their own checks. A folder that is itself a separate Git repository can have its own discern installation. Adding another `discern.toml` to an ordinary nested folder has no effect.

## What stays outside the repository

Parts of the practice never join the diff:

- **Task workspaces.** The first `discern start` creates a sibling folder, `<repo>.worktrees` by default, holding one isolated worktree per task. `discern accept` removes a worktree when its work lands, and `discern worktree prune` clears abandoned leftovers.
- **The logbook.** discern's local activity record lives inside the repository's Git directory, holds metadata about discern use rather than code or command output, and never enters tracked files. [Local control](../20-understand/local-control.md) covers where evidence lives and what leaves your machine, which is nothing on discern's account.

## The decision the diff supports

`discern setup done` normally runs the full gate and records [Proof](../20-understand/proof.md) for the setup branch. If setup was marked unproven, discern records that state and refuses to land the branch. The agent can finish the missing work and run `discern setup done` again.

Once the branch has Proof, review whether its instructions, map, and checks describe the project you want future sessions to inherit. If they do, follow the landing step in the [tutorial](first-success.md#5-review-and-land-setup). If they don't, ask the agent to revise the branch and prove the new version.
