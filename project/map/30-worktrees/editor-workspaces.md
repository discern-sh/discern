---
title: Editor workspaces
description: How to re-root a protected editor into a discern worktree without approving every file edit.
order: 130
aliases:
  - external file protection
  - editor worktree approvals
---

# Open a protected editor in the worktree

`discern start` creates a sibling worktree. `discern_start` also re-aims discern's Model Context Protocol (MCP) tools, but neither command can move an open editor window into the new checkout.

If the editor's file tools already permit the returned path, a fixed-root agent can prefix shell commands with `cd <path> &&` and pass `path` to every discern MCP tool. If the editor asks for approval on external file edits, its workspace boundary has not moved. Open the worktree instead:

1. Run `discern start` or `discern_start`.
2. Copy the returned worktree path.
3. Open that folder as the editor workspace, preferably in a fresh window.
4. Start the coding-agent session there.

The editor, shell, and discern tools now share one root. The main checkout stays in its own window as the fleet view, keeping built-in edits off the trunk while the gate runs in the worktree.

## Cursor

Cursor's External File Protection prompts before its built-in tools write outside the workspace. Keep it enabled. Cursor's [agent security guidance](https://cursor.com/docs/agent/security) offers a user-wide toggle, while [`.cursor/cli.json` permissions](https://docs.cursor.com/en/cli/reference/permissions) govern the terminal agent. Neither is a narrow IDE grant for one changing sibling path.

Use **File → Open Folder…** for the returned path. If you installed Cursor's shell command, `cursor <path>` opens it directly.

See [Cursor integration](../60-agent-integrations/cursor.md) for setup detection, generated files, trust, hooks, and MCP wiring.
