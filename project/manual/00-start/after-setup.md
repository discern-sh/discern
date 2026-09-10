---
id: start-after-setup
title: "After setup"
description: "Understand the files setup added, review what future agents will inherit, and know where to make your next improvement."
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

Setup leaves your project with instructions, checks, and a guide that future agents can use. These files are worth a look: they show what the agent understood about your project, and they give you somewhere lasting to put corrections and decisions.

This page helps you review that result and find the right place for later changes. You can ask your agent to show the relevant files and explain what each does.

## Review what future sessions will inherit

Start with a request:

> Show me the project purpose, the most important instructions, and the list of active checks. Explain what you learned during setup and anything we still need to decide.

Read for meaning. Does the purpose describe the thing you are building? Do the instructions preserve what matters to you? Does the guide explain the project accurately? If your app stores personal reading lists, for example, a rule about preserving saved items should say what that means when agents change the app.

Then ask what the checks cover. “The tests pass” tells you less than “the tests check that saved items remain after reopening the app.” The agent should explain any gaps as well as the checks that passed.

You can correct a misunderstanding in ordinary language:

> People should be able to read their saved lists without an internet connection. Make sure the project guide and instructions reflect that, and explain whether our checks cover it.

The agent updates the source files and verifies the revised setup. You are shaping the understanding later sessions will inherit.

## Files you and your agents author

Most of the material you will want to read lives in the visible `discern/` folder. These are ordinary project files, written and maintained by you and your agents. The paths below are the defaults; setup may use paths you chose instead.

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it contains                                     | How to change it                              |
| ------------------------- | ------------- | ---------------------------------------------------- | --------------------------------------------- |
| `discern/instructions.md` | Project-owned | Working rules supplied to every configured agent.    | Edit the source, then run `discern refresh`.  |
| `discern/map/`            | Project-owned | The maintained project guide, called the map.        | Update the Markdown as the project changes.   |
| `discern/TODO.md`         | Project-owned | Work deferred for a later task.                      | Add or revise entries in the file.            |
| `discern/brief.md`        | Project-owned | The project description, when captured during setup. | Update it when the project's purpose changes. |
| `discern/skills/`         | Project-owned | Reusable agent playbooks your project authors.       | Add or edit a skill at its source.            |
| `discern/scripts/`        | Project-owned | The project's own supporting commands.               | Edit and test the command itself.             |

<!-- /discern-workflow -->

Setup writes the instructions, map, and deferred-work list for every project. The other paths appear as the project uses them. You can explore reusable playbooks in [Create and manage skills](../10-guides/create-and-manage-skills.md).

## Files discern shares with you

The root `discern.toml` is the configuration. It names the commands the gate runs, where task workspaces go, how many tasks may be checked at once, and the other choices that shape the practice. Your agent can explain or change these settings for you. [Configuration reference](../30-reference/config-reference.md) has the exact keys.

Some existing files gain clearly marked sections. `.gitignore` keeps generated and machine-local material out of Git; `.gitattributes` configures how certain files are compared or merged. Your own rules stay outside discern's marked sections.

Setup also connects the coding tools you selected. The new settings may load discern's tools, run session-start actions, or permit particular commands. Ask the agent to highlight any permission changes during review. [Connect a coding agent](../10-guides/connect-a-coding-agent.md) explains each provider's settings and trust steps.

## Files discern regenerates

You may also see `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. These are how supported coding tools find the operating instructions. discern generates them by combining its built-in instructions with your project's instruction source.

When you want to change a rule, edit the source rather than a generated copy. For example:

> Ask before adding a new external service. Put that rule in our shared project instructions and refresh the agent files.

The agent changes `discern/instructions.md`, then runs `discern refresh`. The refresh supplies the updated rule to each configured tool. The gate detects tracked copies that no longer match their source and requires your agent to correct them before completion.

Generated skill folders work similarly: refresh rebuilds them from the skill sources. After cloning the project onto another machine, install discern there, ask your agent to refresh, and open a fresh session. Git carries the written instructions, while refresh restores the local integration pieces.

## One repository, one installation

Set up discern once at the root of each Git repository. A repository containing several apps or packages can give them their own checks through that root configuration. A nested folder only gets a separate installation if it is itself a separate Git repository.

## What stays outside the repository

Task workspaces live beside your project by default, under `<repo>.worktrees`. Each holds one effort's work until discern can retire it. The landing result tells your agent whether cleanup completed or needs attention.

The local activity record, called the **logbook**, lives in Git's administrative storage and is not a tracked project file. It records metadata about discern use, excluding code and command output. [Local control](../20-understand/local-control.md) explains the records and network boundaries.

## The decision the diff supports

Before setup lands, its **Proof** records that the configured checks passed for the exact saved version you are reviewing. If setup is still unproven, your agent needs to finish verification first.

Once the files describe your project and you understand the checks and open work, return to [review and land setup](first-success.md#5-review-and-land-setup). If something is wrong, ask the agent to revise it and verify the new version. The full [files and ownership reference](../30-reference/files-and-ownership.md) remains available for any path you want to inspect more closely.
