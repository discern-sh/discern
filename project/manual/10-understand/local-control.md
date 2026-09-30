---
id: explanation-local-control
title: "What stays on your machine"
description: "See what discern runs, records, and writes on your machine, and where your coding agent and your own commands go beyond it."
order: 90
publish: true
kind: explanation
aliases:
  - "explanation-local-control"
  - "Local control"
  - "Trust & your data"
  - "trust"
  - "privacy"
  - "telemetry"
  - "network"
  - "security"
---

# What stays on your machine

discern runs on your machine and keeps its records there. It has no AI model inside and needs no account or API key. The discern program makes no network requests of its own, so it sends no telemetry.

It writes only where you've given it a place, and it can show you what a command will change before it runs. So you can add discern to a serious project without adding another service, another bill, or a decision-maker you can't see.

## No model inside

discern runs your project's own commands, such as its tests, and records the results. It never asks an AI model whether your code is finished, so it adds no model calls or model bill of its own.

Say your agent improves the search page in your recipe app. The search tests decide whether they pass, but whether the new "no recipes found" message helps anyone needs judgment. A [checkpoint](checkpoints.md) puts that question to your coding agent, and discern records the answer as the agent's judgment.

## What can reach the network

The discern program never updates itself. The installer downloads it and each update you choose to install, checking every download against its published checksum. When you or your agent check for updates, the release page on discern.sh receives your discern version, so it can say whether a newer one exists.

Other parts of your work can still connect, and discern doesn't limit them:

- Your coding agent may send context to its model provider, under that tool's own settings.
- Your project's commands, such as tests, builds, and setup steps, can reach the services they use, such as a nutrition service the recipe app's tests call.
- Git sends or fetches history when you or your agent push, pull, or fetch.

To see what your setup contacts, ask:

> "Review the commands this project runs. Tell me which ones use the network or paid services, and what they send."

## The logbook: what discern records, and where

The **logbook** is discern's local record of what its commands did. It holds names and numbers: which command ran, on which branch, whether it passed, how long it took, and what it measured. It never holds source code, prompts, command output, file contents, or the reasons your agent gives for checkpoint answers.

The logbook lives inside your repository's `.git` folder, outside the files Git tracks, and discern never uploads it. It helps your agent find repeated failures or slow tests, as [Improve how your agents work](../20-guides/improve-the-practice.md) shows.

To stop recording, set `[project].record_logbook = false` in `discern.toml`. [The logbook reference](../30-reference/logbook.md) lists every field and the features that read it.

Each landed change's [Proof](proof.md), discern's record of what passed, stays in your local repository as a Git note until you choose to share it.

## What discern writes, and where

discern writes only where it has a place: its default locations, or a path you chose in `discern.toml`. discern's own test suite checks that no command writes anywhere else.

Before you approve setup, discern shows what it will add, such as `discern.toml` and the files your coding agents read. Later, discern creates a **worktree**, a separate copy of the project, for each task. In a settings file it shares with you, discern changes only its own part.

Choosing a path gives discern permission to manage it: point the [map](instructions-skills-and-map.md) setting at an existing docs folder, and your agents will maintain it as the map.

Before a command changes your project, discern checks that it's allowed to write there. A command that writes to Git first checks that it can, so it stops before it starts instead of failing halfway. Your agent can preview most changes with `--dry-run`.

discern isn't a sandbox around your agent, so your coding agent's own settings decide what it can read, run, or edit. The [files and ownership reference](../30-reference/files-and-ownership.md) lists every path discern manages.

Uninstalling removes discern's wiring and keeps `discern.toml` and everything you and your agents wrote. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md) covers updates and removal.

## What discern doesn't secure or decide

A pass means your project's own commands passed on one exact commit, and nothing more. A change may still need a security review or a test on a real phone. discern lands a change only with your permission, and never publishes or deploys your app. [Proof](proof.md#from-green-to-live) follows a change from a pass to your users.
