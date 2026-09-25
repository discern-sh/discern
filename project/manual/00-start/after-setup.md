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

Setup leaves your project with instructions, checks, and a guide to the project called the **map**. Every later session uses them. Reading them shows you what your agent understood about your project. They also give you a lasting place for corrections and decisions.

This page explains what each new file is for, who changes it, and where to make changes later. You can ask your agent to show you any of these files and explain what it does.

## Review what later sessions will inherit

Start with a request:

> Show me the project's purpose, the most important instructions, and the checks that now run. Explain what you learned during setup, and anything we still need to decide.

Read for meaning. Does the purpose describe what you're building? Do the instructions protect what matters to you? Does the map describe the project correctly? If your app keeps people's reading lists, for example, a rule about keeping saved lists safe should say what that means when agents change the app.

Then ask what the checks cover. “The tests pass” tells you less than “the tests check that saved lists are still there after the app restarts.” Your agent should tell you what the checks cover, and what they don't.

You can fix a misunderstanding in your own words:

> People should be able to read their saved lists without an internet connection. Make sure the map and the instructions say so, and tell me whether our checks cover it.

The agent updates the files and checks the revised setup again. Whatever you correct now, every later session inherits.

## Files you and your agents write

Most of what you'll want to read is in the `discern/` folder. These are ordinary project files, and you and your agents keep them up to date. The paths below are the defaults. Setup may have used paths you chose instead.

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

Setup writes the instructions, the map, and the list of saved work in every project. The other paths appear when the project starts using them. [Create and manage skills](../20-guides/create-and-manage-skills.md) covers playbooks.

## Files discern shares with you

`discern.toml`, at the root of your project, holds discern's settings. It names the commands the gate runs and where task workspaces go. It also holds the other choices setup made, such as how many test runs can happen at once. You own its values. When you upgrade, discern can add missing sections and refresh its own comments, and it keeps the values you set. Your agent can explain or change any setting, and the [Config reference](../30-reference/config-reference.md) lists every key.

discern adds a marked section to your `.gitignore` and `.gitattributes` files. The `.gitignore` section keeps generated and machine-local files out of Git. The `.gitattributes` section sets how Git compares and merges certain files. Your own rules stay outside discern's sections, and discern leaves them alone.

Setup also connects the coding tools you chose. Their settings files gain entries that load discern's tools, run actions when a session starts, or allow particular commands. Ask your agent to point out any permission changes when you review. [Connect a coding agent](../20-guides/connect-a-coding-agent.md) covers each tool's settings and trust steps.

## Files discern regenerates

You may also see `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. Coding tools read these files to find their instructions. discern builds them from its own built-in instructions plus your project's instructions file.

To change a rule, edit its source, because discern rebuilds the generated files on the next refresh. For example:

> Ask me before adding a new outside service. Put that rule in our project instructions and refresh the agent files.

The agent changes `discern/instructions.md`, then runs `discern refresh`, which rebuilds the file each coding tool reads. If a committed copy drifts from its source, the gate fails until your agent brings the copy back in line.

discern also generates each coding tool's skill folder, and `discern refresh` rebuilds it from the skill sources. These folders stay out of Git. So after you clone the project onto another machine, install discern there, ask your agent to refresh, and open a fresh session. Git carries the instructions you wrote, and the refresh restores the local pieces.

## One repository, one setup

Set up discern once, at the root of each Git repository. If the repository holds several apps or packages, that one setup can give each of them its own checks. A folder inside it gets its own setup only if it's a separate Git repository.

## What stays outside the repository

By default, task workspaces live beside your project, in a folder named after it with `.worktrees` on the end. Each **worktree** is a separate copy of the project for one task. It stays until the change lands and discern removes it. The landing result tells your agent whether that cleanup finished.

discern's local activity record, the **logbook**, lives inside Git's own storage folder, so it isn't one of your project's files. It holds metadata about discern's use, such as timings and outcomes. It leaves out code and command output. [What stays on your machine](../10-understand/local-control.md) explains what discern runs and records.

## Before you land setup

Setup's **Proof** records that your project's checks passed on the exact version you're reviewing. Proof doesn't add setup to your shared branch. That step, called landing, stays your decision. If setup is still unproven, your agent needs to finish checking it before it can land.

Once the files describe your project and you understand the checks and the open work, go back to [review and land setup](installation-and-setup.md#5-review-and-land-setup). If something is wrong, ask the agent to fix it and check the new version. The [Files and ownership](../30-reference/files-and-ownership.md) reference covers every path in detail.
