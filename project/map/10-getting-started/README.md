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

_Install discern, set up your repository, and take one real change through its quality gate._

You need a git repository, a supported coding agent, and macOS, Linux, or WSL2. discern is a self-contained binary; the project does not need Deno or Node to run it.

Start with the [quickstart](quickstart.md). It is the shortest complete path from installation to a reviewed change on your trunk. The [walkthrough](walkthrough.md) then slows that path down and explains the consent, branch, proof, and review moments you see while your agent works.

When you already know the outcome you need, open [Tasks by lifecycle](tasks.md). It routes installation, worktree, gate, guidance, Skill, standard, and handoff tasks to the page that owns each procedure.

Setup leaves ordinary files on a branch for you to inspect. [What setup added](after-setup.md) explains that diff and names what you edit, what discern shares with you, and what it regenerates. If a command or agent integration fails, go straight to the [FAQ](faq.md), which starts with the diagnostic command.

When you return for a later release, follow [Upgrade discern](upgrade-discern.md). Updating the binary and updating the project are separate actions, and the guide keeps them in the right order.

| Read next                                                       | What it helps you do                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Tasks by lifecycle](tasks.md)                                  | Jump from an intended outcome to the page that owns its procedure. |
| [Quickstart](quickstart.md)                                     | Install, complete setup, and land your first gated change.         |
| [Walkthrough](walkthrough.md)                                   | Follow the same flow with each handoff and safety check explained. |
| [What setup added](after-setup.md)                              | Read the setup diff and know which files to edit.                  |
| [FAQ and troubleshooting](faq.md)                               | Diagnose setup, command, MCP, platform, and worktree problems.     |
| [Upgrade discern](upgrade-discern.md)                           | Update the binary, migrate the project, and verify the result.     |
| [Files & ownership](../70-reference/artifact-ownership.md)      | Look up the complete write surface and removal behavior.           |
| [`discern.toml` reference](../70-reference/config-reference.md) | Look up every configuration key, type, and default.                |
