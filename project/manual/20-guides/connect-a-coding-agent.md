---
id: guide-connect-a-coding-agent
title: "Connect a coding agent"
description: "Add a coding tool to your project, and it starts with the same instructions, skills, and checks as the tools you already use."
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

Add another coding tool to your project, and it starts with the same instructions, skills, and checks as the tools you already use. You don't have to teach the project again. Everything your agents have learned stays in the project, whichever tool does the next task.

discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. [Platforms and providers](../30-reference/platforms-and-providers.md) lists what each one needs.

## Ask for the new tool

Install the coding tool first. Then ask the agent you already use:

> Add Cursor alongside the coding tools this project already uses. Keep our existing instructions and skills, tell me about any trust steps I need to complete, and help me check that a new Cursor session can use discern.

This guide follows that example. Swap in the tool you want.

## What your agent does

You don't need to run any of these commands yourself. They're here so you know what's happening.

**It works in its own worktree.** A worktree is a separate copy of the project on its own branch, so the change stays off your shared branch until you land it.

**It updates the list of tools.** `discern.toml`, your project's discern configuration, lists every tool the project uses. The agent reads the current list and adds Cursor, so the tools you still use stay on it. A project using Codex and Cursor has:

```toml
[project]
agents = ["codex", "cursor"]
```

The list is complete: tools missing from it aren't set up. Without the `agents` line, discern sets up Claude Code and Codex. The [configuration reference](../30-reference/config-reference.md#project) gives every value, such as `claude_code` for Claude Code.

**It refreshes the tool files.** `discern refresh --dry-run` shows what refresh would write, and `discern refresh` writes it. For each tool on the list, refresh sets up its instructions, its skills, its hooks, and its Model Context Protocol (MCP) registration. MCP is the connection that lets an agent call discern's tools directly. Some of these files also contain settings that belong to your project. Refresh changes only discern's entries and keeps the rest.

**It checks the setup and brings it back.** The agent runs `discern doctor`, which checks the installation and names a fix for anything wrong. Then it commits and runs the gate, the full set of checks your project requires, and brings the change to you. [Finish and land a change](finish-and-land-a-change.md) covers review and landing.

## Turn on the connection

Once the change lands, open a new Cursor session in your main checkout, your original project folder. The new tool only finds discern in a checkout that contains the change.

Your coding tool may ask you to trust the folder or approve discern's tools. These steps belong to the tool, so discern can't approve them for you. The [table of supported tools](../30-reference/platforms-and-providers.md#provider-matrix) lists what each one asks, and `discern doctor` reports it too.

Then ask the new agent:

> Read this project's instructions and call discern's status tool. Tell me which project and worktree you're in, whether discern is connected, and what its next action says.

The status tool is `discern_status`. Claude Code and Codex show it as `mcp__discern__discern_status`. Some tools need a new conversation, a window reload, or a restart before they load the connection.

A refresh makes the files current. A successful status call shows the new session has loaded them. You need both before the next task.

## If the new tool can't find discern

Ask it to work through the problem:

> Check that this session opened the right checkout and loaded its discern connection. Use the discern command line while you diagnose it, and tell me if a trust step or a restart needs me.

The agent checks the folder it opened, the tool's trust settings, and `discern doctor`. It can use `discern status --json` while the connection is down. If the `discern` command itself isn't found, a new terminal and `which discern` show whether the tool can see it. [Setup and integrations](../40-troubleshooting/setup-and-integrations.md) covers more causes.

The problem is fixed when a new session calls the status tool successfully.

## Stop using a tool

Tell your agent which tools to keep. It updates the list, refreshes, and runs the gate as before.

Refresh sets up the tools on the list and leaves the old tool's files where they are. Ask your agent to remove the ones no remaining tool uses, such as that tool's instruction file and discern's entries in its settings. It keeps anything your project added. [Platforms and providers](../30-reference/platforms-and-providers.md) lists each tool's files. Removing a tool from the project doesn't uninstall it from your computer.

## When it's done

- The tool list names every tool your project uses.
- The change passed the gate and landed.
- A new, trusted session of the new tool calls discern's status tool successfully.

The new tool now reads the same instructions and skills as the others. To change what every tool's sessions know, edit your [project instructions](write-project-instructions.md) once.
