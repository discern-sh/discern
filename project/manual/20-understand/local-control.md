---
id: explanation-local-control
title: "Local control"
description: "See what discern runs, writes, and records on your machine, and how those boundaries differ from your coding agent and project commands."
order: 90
publish: true
kind: explanation
aliases:
  - "explanation-local-control"
  - "Trust & your data"
  - "trust"
  - "privacy"
  - "telemetry"
  - "network"
  - "security"
---

# Local control

Before adding a tool to your project, you may want to know where its records go, what it can change, and whether it adds another service to manage. discern keeps its own work local: it contains no AI model, needs no account or API key, and sends no telemetry.

discern itself makes no network requests. It does not block network access for your agent or your project's code.

## No model inside

discern runs the checks your project configures and records their results. It does not ask a model whether your code is finished. Where a review question needs judgment, a [checkpoint](checkpoints.md) asks the coding agent operating discern, and records that agent's answer as a judgment.

For example, when your agent improves a search page, discern can run the project's search tests. The tests determine whether their assertions pass. A question about whether the new message is helpful still needs someone to assess it; discern does not turn that assessment into a test result.

There is no additional model call or model bill from discern itself. Your coding agent continues to use its provider, and configured commands may call paid services. Checks may also take time and use your machine's resources.

## What can use the network

The discern executable makes no network requests of its own. The installer uses the network to download it, and you choose when to download an update.

Checking for updates opens the [release page](https://discern.sh/releases) in your browser, or your agent can read it for you. You choose whether to install an update. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md#check-release-information) shows how.

Other parts of your workflow can still connect:

- Your coding agent may send context to its model provider under that tool's settings.
- A configured test, build, setup step, or other project command can contact the services it normally uses.
- Git can send or fetch project history when you or your agent invoke those operations.

If you need to know what a particular setup will contact, ask:

> Review the commands configured for this project. Explain which use the network or paid services and what data they send.

That review should examine the actual commands and provider settings. discern does not restrict their access, and a local gate does not establish that its commands are offline.

## What stays on your machine

The **logbook** is a local activity record. It holds metadata about discern use, such as command names, branches, outcomes, durations, and measured quality values. It excludes source code, prompts, command output, file contents, and checkpoint rationales.

The record lives in Git's administrative storage rather than tracked project files. discern does not upload it. It can help your agent investigate repeated failures or slow checks; [Evidence and improvement](evidence-and-improvement.md) explains that use, and [the logbook reference](../30-reference/logbook.md) lists the recorded fields.

You can turn recording off with `[project].logbook = false`. Sealing or removing existing history uses an owner command that asks for confirmation in a terminal. The reference explains those choices and which features depend on recording.

A landed change's **Proof** is also recorded locally by default, as a note attached to its Git commit. You can explicitly configure fetching of other Proof notes through ordinary Git transport; publishing notes remains a separate Git action. discern does not automatically upload them. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) gives the sharing and removal commands.

The update reminder is stored locally too. It does not send information to discern.

## What discern may write

A project records the newest discern version used to update its managed files. Committing that version helps teammates know when to update their own copy. It does not track what they have installed.

Setup explains its proposed changes before you approve them. Its footprint includes the root `discern.toml`, authored material under `discern/` by default, and the instruction and integration files for your selected coding tools. Later operations also create task workspaces and keep local evidence in Git's administrative storage.

The full [files and ownership reference](../30-reference/files-and-ownership.md) identifies the managed paths and how to change them. Your own material in shared settings files stays outside discern's marked sections or owned keys.

For configurable authored paths, choosing a location gives discern permission to manage that location. If you point the map setting at an existing documentation folder, for example, you are choosing that folder as the project guide agents will maintain. Keep that consequence in mind when changing a path; it is more than a label.

You can ask your agent to preview a supported effectful operation with `--dry-run` before applying it. The preview describes the planned changes without making them. Permission for discern's files does not replace your coding agent's own filesystem permissions or authorize arbitrary work elsewhere.

## What discern does not secure or decide

Your coding agent's permissions govern what it may read, run, or edit. discern supplies a working process and checks; it is not a sandbox around the agent.

The gate's evidence also has a defined scope: it records that the project's configured checks passed for an exact version. A security review, a real-device check, or an assessment of suitability may still be needed when the change calls for it.

Landing a change onto the shared branch requires your permission, either given for the current change or explicitly recorded for a defined scope. A passing gate supplies evidence for that decision. It does not grant permission, publish the project, or deploy the app. [Proof](proof.md) explains the distinction.

## Upgrades and removal stay your choice

The binary does not check for updates or replace itself. The installer verifies the published checksum before replacing an existing installation; [Platforms and providers](../30-reference/platforms-and-providers.md) covers platform signing and release provenance.

If you remove discern, the uninstall operation removes its wiring while retaining the instructions, map, skills, scripts, and other project-authored material. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md) shows the supported procedure. What you and your agents have written remains available to read and use.
