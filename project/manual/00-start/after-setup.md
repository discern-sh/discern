---
id: start-after-setup
title: "After setup"
description: "See what each file setup added is for, check what later sessions will inherit, and know where to make changes later."
order: 50
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

Setup leaves your project with working instructions for every agent session, the commands every change must pass, and a guide to how the project works called the **map**. Every later session works from these files, so reading them shows you what your agent understood about your project, and a correction you make there reaches every session after.

This page explains what each new file is for, who changes it, and where to make changes later. You can ask your agent to show you any of these files and explain what it does.

## Review what later sessions will inherit

Start with a request:

> "Show me the project's purpose, the most important instructions, and the checks that now run. Explain what you learned during setup, and anything we still need to decide."

Read for meaning: does the purpose describe what you're building, do the instructions protect what matters to you, and does the map describe the project correctly? Say your app keeps people's reading lists. A rule about keeping saved lists safe should say what that means when an agent changes the app, such as keeping every saved list when the storage format changes.

Then ask what the tests and other checks cover. "The tests pass" tells you less than "the tests check that saved lists are still there after the app restarts", so ask your agent what they cover, and what they don't.

You can fix a misunderstanding in your own words:

> "People should be able to read their saved lists without an internet connection. Make sure every future session knows that, and tell me whether our tests cover it."

Your agent records it in the instructions and the map, and checks the revised setup again. Whatever you correct now, every later session inherits.

## Files you and your agents write

Most of what you'll want to read is in the `discern/` folder: ordinary project files that you and your agents keep up to date. The paths below are the defaults, and setup may have used paths you chose instead.

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it holds                                          | How to change it                              |
| ------------------------- | ------------- | ------------------------------------------------------ | --------------------------------------------- |
| `discern/instructions.md` | Project-owned | Working rules that every configured agent receives.    | Edit it, then run `discern refresh`.          |
| `discern/map`             | Project-owned | The map, a guide to how the project works.             | Edit its Markdown as the project changes.     |
| `discern/TODO.md`         | Project-owned | Work saved for a later task.                           | Add or change entries in the file.            |
| `discern/brief.md`        | Project-owned | The project description, if you gave one during setup. | Update it when the project's purpose changes. |
| `discern/skills/`         | Project-owned | Playbooks your project writes for its agents.          | Add or edit a skill at its source.            |
| `discern/scripts/`        | Project-owned | The project's own helper commands.                     | Edit and test the command itself.             |

<!-- /discern-workflow -->

Setup writes the instructions, the map, and the list of saved work in every project, and the other paths appear when the project starts using them. [Create and manage skills](../20-guides/create-and-manage-skills.md) covers playbooks.

## Files discern shares with you

`discern.toml`, at the root of your project, holds discern's settings: the commands the **gate** runs before a change counts as finished, where task workspaces go, and the other choices setup made, such as how many test runs can happen at once. You own its values, so when you upgrade, discern restores any of its own sections that are missing and refreshes its own comments, and it keeps the values you set. Your agent can explain or change any setting, and the [Config reference](../30-reference/config-reference.md) lists every key.

discern adds a marked section to your `.gitignore`, which keeps generated and machine-local files out of Git, and to your `.gitattributes`, which sets how Git compares and merges certain files. Your own rules stay outside discern's sections, and discern leaves them alone.

Setup also connects the coding tools you chose, so their settings files gain entries that load discern's tools, run actions when a session starts, or allow particular commands. Because some of those entries grant permissions, ask your agent to point them out when you review. [Connect a coding agent](../20-guides/connect-a-coding-agent.md) covers each tool's settings and trust steps.

## Files discern regenerates

You may also see `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, the files coding tools read to find their instructions. discern builds them from its own built-in instructions plus your project's instructions file.

To change a rule, change its source, because discern rebuilds the generated files on the next refresh. Say you want agents to check with you before the reading-list app depends on anything new:

> "From now on, ask me before adding a new outside service. Make that a rule every agent follows."

Your agent adds the rule to `discern/instructions.md`, then runs `discern refresh`, which rebuilds the file each coding tool reads. If a committed copy drifts from its source, the gate fails until your agent brings the copy back in line.

discern also generates each coding tool's skill folder from the skill sources, and these folders stay out of Git. After you clone the project onto another machine, install discern there and have your agent run `discern refresh` before you open a fresh session: Git carries the instructions you wrote, and the refresh restores the local pieces.

## One repository, one setup

Set up discern once, at the root of each Git repository. If the repository holds several apps or packages, that one setup can give each of them its own checks. A folder inside it gets its own setup only if it's a separate Git repository.

## What stays outside the repository

By default, task workspaces live beside your project, in a folder named after it with `.worktrees` on the end, so a project in `reading-list` keeps them in `reading-list.worktrees`. Each **worktree** is a separate copy of the project for one task, and it stays until the change lands and discern removes it. The landing result tells your agent whether that cleanup finished.

discern's local activity record, the **logbook**, lives inside Git's own storage folder, so it isn't one of your project's files. It holds metadata about discern's use, such as timings and outcomes, and leaves out code and command output. [What stays on your machine](../10-understand/local-control.md) explains what discern runs and records.

## Before you land setup

Setup's **Proof** records which of your project's commands passed on the exact version you're reviewing. It doesn't add setup to your shared branch: that step, called landing, stays your decision. If setup is still unproven, your agent has to finish checking it before it can land.

Once the files describe your project and you understand the checks and the open work, go back to [review and land setup](installation-and-setup.md#5-review-and-land-setup). If something is wrong, ask your agent to fix it and check the new version. The [Files and ownership](../30-reference/files-and-ownership.md) reference covers every path in detail.
