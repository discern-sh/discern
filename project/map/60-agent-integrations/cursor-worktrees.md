---
title: Cursor worktrees
description: How to use Cursor with discern worktrees without approving every file edit.
order: 50
aliases:
  - Cursor External File Protection
  - Cursor Worktree option
  - Cursor external edit approvals
---

# Cursor worktrees without edit prompts

## Local sessions: disable the protection once

A Local Cursor session stays rooted at the checkout it opened. If `discern_start` creates the default sibling worktree, discern's Model Context Protocol (MCP) tools re-aim there. Cursor's built-in file tools still see a path outside the open workspace.

External File Protection can then pause each requested write for human approval. The pause happens in Cursor's interface after the agent requests the edit, so the agent cannot reliably react to it.

For uninterrupted day-to-day work from a Local session, turn off **External File Protection** once under **Cursor Settings → Agents → Auto-Run**. This is a user-wide setting: Cursor's built-in file tools can then write outside any open workspace. discern reports the choice at setup completion but never changes it.

Cursor's [agent security guide](https://cursor.com/docs/agent/security) describes the setting. [`.cursor/cli.json` permissions](https://cursor.com/docs/cli/reference/permissions) configure the terminal agent only. External File Protection controls the editor's built-in file tools.

## Let Cursor create the worktree

To keep External File Protection enabled, select Cursor's native [**Worktree option**](https://cursor.com/docs/configuration/worktrees) when you start the agent session. Cursor creates the linked checkout and launches the agent inside it. The `sessionStart` hook runs `discern worktree ensure`, and the normal discern workflow applies from there, including acceptance and teardown.

When `discern accept` lands the work, it removes the checkout under the running session. Cursor can show the final landing response, then the session ends and its transcript cannot accept another message. Start a new session for any follow-up.

## Keep discern worktrees inside the project

You can also keep External File Protection enabled and put discern-created worktrees below the open project. Set `[worktree].root` to a project-relative directory:

```toml
[worktree]
root = ".worktrees"
```

Ignore that directory at the project root:

```gitignore
/.worktrees/
```

This layout is viable, but the default sibling keeps one checkout from appearing inside another. Before adopting the nested layout, run the full quality gate and check formatters, linters, indexers, and file watchers for recursive scans. Exclude `.worktrees/` from those tools where needed.

Return to [Cursor integration](cursor.md) for setup detection, generated files, trust, hooks, and MCP wiring.
