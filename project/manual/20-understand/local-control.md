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

discern runs on your machine and keeps its records there. It has no AI model inside, needs no account or API key, and sends no telemetry. The discern program makes no network requests of its own.

It also writes only where you've given it a place, and it can show you what a command will change before it runs. So you can add discern to a serious project without adding another service, another bill, or a decision-maker you can't see.

## No model inside

discern runs the checks your project sets up and records the results. It never asks an AI model whether your code is finished. When a question needs judgment, a [checkpoint](checkpoints.md) asks your coding agent, and discern records the answer as the agent's judgment.

Say your agent improves the search page in your recipe app. discern runs the project's search tests, and the tests decide whether they pass. Whether the new "no recipes found" message helps anyone still needs judgment. discern doesn't turn that into a test result.

So discern adds no model calls and no model bill of its own. Your coding agent keeps using its own provider, and your project's commands may call paid services. Checks also take time and use your machine's resources.

## What can reach the network

The discern program makes no network requests. The installer downloads it, and you choose when to download an update.

To check for updates, your agent runs `discern releases`, or you choose **Check for updates** in the **desk**, the interactive view that opens when you run `discern` in your project folder. That opens the release page in your browser. Your browser sends your discern version to discern.sh, so the page can say whether an update exists. You choose whether to install it. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md) shows how.

Other parts of your work can still connect:

- Your coding agent may send context to its model provider, under that tool's own settings.
- Your project's commands, such as tests, builds, and setup steps, can reach the services they normally use. The recipe app's tests might call a nutrition service, for example.
- Git sends or fetches history when you or your agent push, pull, or fetch.

discern doesn't limit what those can reach, and a check that runs on your machine can still call out. To find out what your setup contacts, ask:

> Review the commands configured for this project. Tell me which ones use the network or paid services, and what they send.

## What discern records, and where

The **logbook** is discern's local record of what its commands did. It holds names and numbers: which command ran, on which branch, whether it passed, how long it took, and what it measured. It never holds source code, prompts, command output, file contents, or the reasons your agent gives for checkpoint answers.

The logbook lives inside your repository's `.git` folder, outside the files Git tracks, and discern never uploads it. Your agent can use it to look into repeated failures or slow checks. [Learn from your project's history](evidence-and-improvement.md) explains how.

To stop recording, set `[project].record_logbook = false` in `discern.toml`. Sealing or deleting past history is a terminal command that asks you to confirm first. [The logbook reference](../30-reference/logbook.md) lists every recorded field and which features need the record.

When a change lands, discern attaches its [Proof](proof.md) to the landed commit as a Git note in your local repository. You can set up fetching other people's notes through Git. Sharing your own is a separate Git step you choose, and discern never uploads them for you. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) has the commands.

discern keeps its update reminder on your machine too, and the reminder sends nothing.

## What discern writes, and where

discern writes only where it has a place: its default locations, or a path you chose in `discern.toml`. discern's own test suite checks that no command writes anywhere else.

Setup tells you what it will add before you approve it. That includes `discern.toml` at the root of your project, your project's own files under `discern/` by default, and the instruction and connection files for the coding agents you pick. Later, discern also creates a **worktree** for each task, a separate copy of the project to work in, and keeps its records inside `.git`. Your own content in shared settings files stays outside discern's marked sections.

Choosing a path gives discern permission to manage it. If you point the map setting at an existing docs folder, your agents will maintain that folder as the project's map. So pick paths with that in mind.

Before a command changes your project, discern checks that it's allowed to write there. Commands that write to Git also check that they can, so they stop before they start instead of failing halfway. Your agent can also preview most commands that change things with `--dry-run`, which shows the planned changes without making them.

That permission covers discern's own files only. Your coding agent's settings decide what else it can read or edit. The [files and ownership reference](../30-reference/files-and-ownership.md) lists every path discern manages and how to change them.

## What discern doesn't secure or decide

discern isn't a sandbox around your agent. Your agent's own permission settings decide what it can read, run, or edit.

A pass means your project's checks passed on one exact version. When a change calls for it, you may still want a security review, a test on a real phone, or your own view on whether a feature fits.

Landing a change on your shared branch needs your permission, given for that change or through a grant you set up. A pass never grants that permission, and discern never publishes or deploys your app. [Proof](proof.md) explains the difference.

## Upgrades and removal stay your choice

The discern program never checks for updates on its own, and never replaces itself. The installer checks the published checksum before it replaces an existing copy. [Platforms and providers](../30-reference/platforms-and-providers.md) covers signing and where releases come from.

If you remove discern, uninstall takes out its wiring and keeps `discern.toml`, your instructions, skills, map, and other files you wrote. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md) shows the steps. What you and your agents wrote stays yours to read and use.
