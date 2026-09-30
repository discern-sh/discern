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

Add another coding tool, and its first session starts with the same instructions and skills as your other tools. Its changes must pass the same **gate**: your project's own commands, such as its linter and tests. You don't teach the project again, because what your agents have learned lives in the project.

discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. [Platforms and providers](../30-reference/platforms-and-providers.md) lists what each needs.

## Ask for the new tool

Say your project uses Claude Code and Codex, and you want to try Cursor too. Install Cursor first, then ask the agent you already use:

> "Set this project up for Cursor alongside our other tools, keeping our instructions and skills. Tell me about any trust steps I need to take."

Any other supported tool works the same way.

## What your agent does

You don't need to run any of these commands yourself.

**It works in its own worktree**, a separate copy of the project on its own branch, so the change stays off your shared branch until you land it.

**It updates the list of tools.** `discern.toml`, your project's discern configuration, lists the tools discern sets up, and a tool missing from the list isn't set up. So the agent adds Cursor and keeps the tools you still use:

```toml
[project]
agents = ["claude_code", "codex", "cursor"]
```

**It refreshes the tool files.** For each tool on the list, `discern refresh` sets up its instructions, skills, hooks, and Model Context Protocol (MCP) registration. MCP is the connection that lets an agent call discern's tools directly. Where a file also holds your project's own settings, refresh changes only discern's entries.

**It checks the setup and brings the change to you.** `discern doctor` checks the installation and names a fix for anything wrong. The agent then commits and runs the gate. The change lands only when you say so, as [Finish and land a change](finish-and-land-a-change.md) describes.

## Turn on the connection

Once the change lands, open a new Cursor session in your **main checkout**, your original project folder. The new tool finds discern only in a checkout that contains the change.

Cursor then asks you to trust the folder and to approve discern's tools the first time it uses them. Those steps belong to the tool, so only you can take them. `discern doctor` names them for every tool on your list. For Cursor, it reports:

```text
`cursor`: Committed integration configuration and first-use tool calls require workspace approval. Trust the workspace, then approve the discern MCP server tools on first use; use the headless bypass only when explicitly intended (flag `--approve-mcps`).
```

Then ask the new agent:

> "Check that you can reach discern from this session, and tell me what it says to do next."

The agent calls `discern_status`, discern's status tool. In a clean main checkout, a connected session answers:

```text
`main` is clean in the main checkout.
```

Some tools need a new conversation, a window reload, or a restart before they load the connection. Only a successful status call shows that a session has loaded it.

## If the new tool can't find discern

Ask your agent to find out why, and whether a trust step or restart needs you. [The tools don't appear in the agent's session](../40-troubleshooting/setup-and-integrations.md#the-tools-dont-appear-in-the-agents-session) covers the causes and fixes.

## Stop using a tool

If you decide against Cursor, tell your agent which tools to keep. It updates the list, refreshes, and runs the gate as before.

Refresh leaves a dropped tool's files where they are, so ask your agent to remove the ones no remaining tool uses. For Cursor, those are discern's entries in `.cursor/mcp.json` and `.cursor/hooks.json`, while `AGENTS.md` stays, because Codex reads it too.

## When it's done

- The tool list names every tool your project uses.
- The change passed the gate and landed.
- A new, trusted session of the new tool calls discern's status tool successfully.

To change what every tool knows, edit your [project instructions](write-project-instructions.md) once.
