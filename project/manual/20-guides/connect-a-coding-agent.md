---
id: guide-connect-a-coding-agent
title: "Connect a coding agent"
description: "Add a coding tool to your project, and it starts with the same instructions and skills as your other tools, and its changes face the same tests and linters."
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

Add another coding tool to your project, and its first session starts with the same instructions and skills as your other tools. Its changes face the same **gate**: your project's own commands, such as its linter and tests, which a change must pass before it counts as finished. You don't teach the project again, because what your agents have learned lives in the project.

discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. [Platforms and providers](../30-reference/platforms-and-providers.md) lists what each one needs.

## Ask for the new tool

Say your project already uses Claude Code and Codex, and you want to try Cursor on it too. Install Cursor first, then ask the agent you already use:

> "Set this project up for Cursor as well, alongside the tools we already use. Keep our existing instructions and skills, tell me about any trust steps I need to complete, and help me check that a new Cursor session can reach discern."

Any other supported tool works the same way.

## What your agent does

You don't need to run any of these commands yourself. They're here so you know what's happening.

**It works in its own worktree.** A **worktree** is a separate copy of the project on its own branch, so the change stays off your shared branch until you land it.

**It updates the list of tools.** `discern.toml`, your project's discern configuration, lists every tool discern sets up, and the list is complete: a tool missing from it isn't set up. So the agent reads the current list and adds Cursor, keeping the tools you still use:

```toml
[project]
agents = ["claude_code", "codex", "cursor"]
```

A project without an `agents` line gets discern's default, Claude Code and Codex, so the agent writes all three names out. The [configuration reference](../30-reference/config-reference.md#project) gives every value.

**It refreshes the tool files.** For each tool on the list, `discern refresh` sets up its instructions, its skills, its hooks, and its Model Context Protocol (MCP) registration, the connection that lets an agent call discern's tools directly. The agent runs `discern refresh --dry-run` first to see what would change. Some of these files also hold settings that belong to your project, so refresh changes only discern's entries and keeps the rest.

**It checks the setup and brings the change to you.** `discern doctor` checks the installation and names a fix for anything wrong. Then the agent commits and runs the gate, and a pass means the change is ready for your review: it lands only when you say so. [Finish and land a change](finish-and-land-a-change.md) covers review and landing.

## Turn on the connection

Once the change lands, open a new Cursor session in your **main checkout**, your original project folder. The new tool finds discern only in a checkout that contains the change.

Cursor then asks you to trust the folder, and to approve discern's tools the first time it uses them. Those steps belong to the tool, so neither discern nor your agent can take them for you. `discern doctor` names the steps for every tool on your list, and for Cursor it reports:

```text
`cursor`: Committed integration configuration and first-use tool calls require workspace approval. Trust the workspace, then approve the discern MCP server tools on first use; use the headless bypass only when explicitly intended (flag `--approve-mcps`).
```

The [table of supported tools](../30-reference/platforms-and-providers.md#provider-matrix) lists what each tool asks. Then ask the new agent:

> "Check that you can reach discern from this session. Tell me which project and worktree you're in, and what discern says to do next."

The agent reads the project's instructions and calls `discern_status`, discern's status tool, which Claude Code and Codex show as `mcp__discern__discern_status`. A connected session in a clean main checkout reports the result's first sentence:

```text
`main` is clean in the main checkout.
```

Some tools need a new conversation, a window reload, or a restart before they load the connection. A refresh makes the files current, but only a successful status call shows that a session has loaded them, and you need both before the next task.

## If the new tool can't find discern

Ask it to work through the problem:

> "discern isn't showing up in this session. Find out why, and tell me if a trust step or a restart needs me."

The agent checks the folder the session opened, the tool's trust settings, and `discern doctor`. While the connection is down, it can still reach discern from the command line with `discern status --json`. If the `discern` command itself isn't found, `which discern` in a new terminal shows whether the tool can see it. [Setup and integrations](../40-troubleshooting/setup-and-integrations.md) covers more causes.

The problem is fixed when a new session calls the status tool successfully.

## Stop using a tool

If you decide against Cursor, tell your agent which tools to keep. It updates the list, refreshes, and runs the gate as before.

Refresh sets up only the tools on the list and leaves a dropped tool's files where they are, so ask your agent to remove the ones no remaining tool uses. For Cursor, those are discern's entries in `.cursor/mcp.json` and `.cursor/hooks.json`, while `AGENTS.md` stays, because Codex reads it too. The agent keeps anything your project added. [Platforms and providers](../30-reference/platforms-and-providers.md) lists each tool's files. Taking a tool out of the project doesn't uninstall it from your computer.

## When it's done

- The tool list names every tool your project uses.
- The change passed the gate and landed.
- A new, trusted session of the new tool calls discern's status tool successfully.

The new tool now reads the same instructions and skills as the others. To change what every tool's sessions know, edit your [project instructions](write-project-instructions.md) once.
