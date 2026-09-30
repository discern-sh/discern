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

Setup leaves your project with working instructions for every agent session, the commands every change must pass, and the **map**, your project's guide to how it works, which your agents keep current. Every later session works from these files, so reading them shows what your agent understood, and a correction you make reaches every later session.

## Review what later sessions will inherit

Ask:

> "Show me the project's purpose, the most important instructions, and the checks that now run. Explain what you learned during setup, and anything we still need to decide."

Read for meaning: do the purpose, instructions, and map describe what you're building and what matters to you? Say your app keeps people's reading lists. A rule about keeping saved lists safe should say what that means in practice, such as keeping every list when the storage format changes.

Ask what the tests check, too: "saved lists survive a restart" tells you more than "the tests pass". You can fix a misunderstanding in your own words:

> "Saved lists must open without an internet connection. Make sure every future session knows that, and tell me whether our tests cover it."

Your agent records it in the instructions and the map, then checks the setup again.

## Files you and your agents write

Most of what you'll read is in the `discern/` folder, in ordinary files you and your agents keep up to date. Setup may have used other paths you chose.

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it holds                             | How to change it                     |
| ------------------------- | ------------- | ----------------------------------------- | ------------------------------------ |
| `discern/instructions.md` | Project-owned | Rules every configured agent receives.    | Edit it, then run `discern refresh`. |
| `discern/map`             | Project-owned | The map.                                  | Edit it as the project changes.      |
| `discern/TODO.md`         | Project-owned | Work saved for a later task.              | Add or change entries.               |
| `discern/brief.md`        | Project-owned | The project description, if you gave one. | Update it when the purpose changes.  |
| `discern/skills/`         | Project-owned | Your project's own playbooks for agents.  | Add or edit a skill at its source.   |
| `discern/scripts/`        | Project-owned | The project's own helper commands.        | Edit and test the command itself.    |

<!-- /discern-workflow -->

Setup always writes the instructions, map, and list of saved work. The other paths appear once your project uses them.

## Files discern shares with you

`discern.toml`, at the root of your repository, holds discern's settings, such as where task workspaces go and which commands the **gate** runs: the commands every change must pass before it counts as finished. You own its values, and an upgrade keeps them. Your agent can explain or change any setting, and the [Config reference](../30-reference/config-reference.md) lists every key.

discern also adds marked sections to your `.gitignore` and `.gitattributes`, which control what Git tracks and how it merges certain files, and leaves your rules outside them alone.

Each coding tool you chose also gains settings that load discern's tools, run actions when a session starts, or allow particular commands. Some of those grant permissions, so ask your agent to point them out when you review. [Connect a coding agent](../20-guides/connect-a-coding-agent.md) covers each tool.

## Files discern regenerates

`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are the files coding tools read for their instructions. discern builds them from its own built-in instructions plus your project's instructions file, so to change a rule, your agent edits `discern/instructions.md` and runs `discern refresh` to rebuild them. If a committed copy drifts from its source, the gate fails until your agent brings it back in line.

discern also generates each coding tool's skill folder, which stays out of Git. So after you clone the project onto another machine, install discern there and have your agent run `discern refresh` before you open a fresh session.

## What stays outside the repository

By default, task workspaces live beside your project, in a folder such as `reading-list.worktrees` for a project in `reading-list`. Each **worktree** is a separate copy of the project for one task, and discern removes it when the change lands.

The **logbook**, discern's local record of what its commands did, lives inside Git's own storage folder. It records metadata such as timings and outcomes, and leaves out your code and command output. [What stays on your machine](../10-understand/local-control.md) explains more.

## Before you land setup

Setup's **Proof** records which of your project's commands passed on the exact version you're reviewing, but landing setup on your shared branch stays your decision. Once the files describe your project, go back to [review and land setup](installation-and-setup.md#5-review-and-land-setup). The [Files and ownership](../30-reference/files-and-ownership.md) reference covers every path.
