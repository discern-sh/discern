---
title: Getting started
description: Install discern, set up a repository, run the first gated change, troubleshoot setup, and upgrade later.
aliases:
  - install
  - setup
  - start
  - upgrade
---

# Getting started

_Install discern, set up your repository, and take one real change through the project's final quality check (the gate)._

You need a Git repository, a supported coding agent, and macOS, Linux, or WSL 2. discern is a self-contained binary. The project does not need Deno or Node to run discern.

Start with the [quickstart](quickstart.md). It is the shortest path from installation to a reviewed change on your trunk. [Setup decisions](setup-decisions.md) explains why the model choice matters and which later choices remain yours. The [walkthrough](walkthrough.md) then explains the branch, Gate, Proof, and review boundaries you encounter while an agent works.

Setup leaves ordinary files on a branch for you to inspect. [What setup added](after-setup.md) explains that diff and names what you edit, what discern shares with you, and what it regenerates. If a command or agent integration fails, the manual's [troubleshooting section](https://discern.sh/docs/troubleshooting) starts with the diagnostic command.

When you return for a later release, follow [Upgrade discern](upgrade-discern.md). Updating the binary and updating the project are separate actions, and the guide keeps them in the right order.

| Read next                                                                      | What it helps you do                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Quickstart](quickstart.md)                                                    | Install, complete setup, and land your first gated change.                  |
| [Setup decisions](setup-decisions.md)                                          | Choose the setup model and recognize the decisions that need your judgment. |
| [Walkthrough](walkthrough.md)                                                  | Follow the same flow with each handoff and verification explained.          |
| [What setup added](after-setup.md)                                             | Read the setup diff and know which files to edit.                           |
| [Upgrade discern](upgrade-discern.md)                                          | Update the binary, migrate the project, and verify the result.              |
| [Files & ownership](../70-reference/artifact-ownership.md)                     | Look up the complete write surface and removal behavior.                    |
| [`discern.toml` reference](https://discern.sh/docs/reference/config-reference) | Look up every configuration key, type, and default.                         |
