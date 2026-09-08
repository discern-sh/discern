---
id: guide-connect-a-coding-agent
title: "Connect a coding agent"
description: "Connect one supported coding agent using the shared setup path and the provider-specific facts it needs."
order: 130
publish: true
kind: guide
aliases:
  - "guide-connect-a-coding-agent"
  - "agent integrations"
  - "coding agents"
  - "providers"
---

# Connect a coding agent

You can try another coding tool without teaching the project all over again. discern gives each configured tool the project's instructions and skills, plus a connection to its checks and workflow. The tools may work differently, but the practice you have built stays in the project.

This guide adds a supported coding agent to a project that has already completed discern setup. Install the coding tool first, then ask your current agent:

> Add Cursor alongside the coding tools this project already uses. Keep our existing instructions and skills, show me any trust steps I need to complete, and help me check that a new Cursor session can use discern.

Replace Cursor with your chosen tool. [Platforms and providers](../30-reference/platforms-and-providers.md) lists the supported tools and their requirements.

## 1. Select the provider once

Your agent makes the configuration change in an isolated worktree, the workspace for this task. It checks the existing provider list before adding the new tool, so the edit keeps the tools you still use.

For example, a project using Codex and Cursor has:

```toml
[project]
agents = ["codex", "cursor"]
```

This is the complete desired list. Omitting `agents` uses the default pair, Claude Code and Codex; an explicit empty list selects no provider. The [config reference](../30-reference/config-reference.md#project) gives the supported values.

## 2. Preview and apply the shared wiring

Your agent previews the changes with `discern refresh --dry-run`. It then runs `discern refresh` and reviews the result. Refresh creates or updates the selected tools' instructions, skills, hooks, and MCP registration. MCP is the connection that lets an agent call discern's tools directly.

Some integration files also contain settings belonging to your project, so `refresh` changes discern's entries while preserving yours.

The agent runs `discern doctor` to check the installation, then prepares, commits, and checks the change through the [usual completion process](finish-and-land-a-change.md). The new tool must open a checkout containing those integration changes. A configuration still on a worktree branch is not yet present in the shared project.

## 3. Complete the provider-specific activation

Open a fresh session of the new tool in that checkout. Complete the trust or approval steps identified in the setup or refresh handoff. These belong to the coding tool: discern cannot grant that permission for you.

Ask the new agent:

> Read this project's instructions and call discern's status tool. Tell me which project and worktree you're in, whether discern is connected, and what its next action says.

The tool may need a new conversation, a window reload, or an application restart before it loads the connection. The [provider reference](../30-reference/platforms-and-providers.md) gives the specific action and callable name for each tool.

A successful refresh means the files are current. A successful status call from the new session shows that the tool loaded its connection. Your next task needs the running connection as well as current files.

## 4. Recover a missing action locally

If the new agent cannot find discern, ask it to work through the connection problem:

> Check that this session opened the intended checkout and loaded its discern integration. Use the local command-line fallback while diagnosing the connection, and tell me if a trust step or restart needs me.

The agent checks the checkout path, the tool's trust state, the refresh preview, and `discern doctor`. It can use `discern status --json` while repairing the MCP connection. If the program itself cannot be found, a fresh shell and `which discern` help establish whether the tool can see the installed command.

[Setup and integrations troubleshooting](../40-troubleshooting/setup-and-integrations.md) covers the recovery in detail. The successful status call remains the check that the connection is working.

## 5. Remove a provider from the project

Tell your agent which tools to keep. It updates the complete `[project].agents` list, previews refresh, and applies the integration removals. It reviews and commits the config and tracked output together, then runs the gate.

Refresh removes discern-owned entries for the deselected provider while preserving shared content owned by the project or another provider. It does not uninstall the coding tool from your machine.

## Completion

You can start using the new tool when the connection changes have passed the project's checks and a fresh trusted session calls discern successfully. Your [project instructions](write-project-instructions.md) remain the shared place to change what future sessions should know.
