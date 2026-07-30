# ADR 0226: Protected editors open the worktree as the workspace

**Status**: accepted; extends the isolated-worktree workflow in [ADR 0052](0052-worktree-sibling-placement.md), preserves the vendor-security boundary in [ADR 0193](0193-discern-does-not-enforce-the-vendor-security-boundary.md), and adds a provider handoff to [ADR 0031](0031-typed-provider-integration.md)

## Context

`discern start` creates a linked worktree beside the main checkout. Its guidance correctly told fixed-root agents to address that path explicitly: prefix shell commands with `cd <path> &&` and pass `path` to discern's Model Context Protocol (MCP) tools. That fallback covers a client whose file tools can write the sibling path.

It is the wrong fallback for an editor that protects files outside its open workspace. Cursor's External File Protection treats the sibling worktree as external while the editor window remains rooted at the main checkout, so its built-in Edit tool asks for approval on every file. Shell commands can run in the worktree and discern's MCP server can target it while the editor's own workspace boundary remains unchanged. The result looks re-rooted to the agent but stays approval-gated to the user.

Cursor exposes a global External File Protection toggle. Its project-scoped `.cursor/cli.json` permissions govern the terminal CLI, not the editor's built-in file tools. No documented project-scoped IDE allowlist can narrowly grant one changing sibling worktree path.

## Decision

When an editor protects writes outside its open workspace, the safe re-root is a workspace handoff:

1. create the worktree with `discern start` or `discern_start`;
2. open the returned path as the editor workspace, normally in a fresh window or session;
3. begin the coding-agent session there.

The shared `discern_start` hint, operating policy, and compiled worktree guidance now teach two branches. A fixed-root client that already permits writes may use the explicit `cd` and MCP `path` fallback. A client asking for external-file edit approvals must open the returned worktree as its workspace instead of approving files one by one.

The provider registry gains optional `worktreeAccess` guidance. Cursor declares the workspace handoff, and setup's provider-derived completion message includes it alongside trust and reactivation steps. The worktree map carries the reusable editor workflow, and the Cursor integration page points to it.

discern does not disable External File Protection, write a broad external-path permission, or change a user-level security setting. The vendor remains the security authority; discern changes only its own workflow guidance.

## Consequences

- Cursor users approve workspace trust at the workspace boundary instead of approving every edited file.
- The editor, shell, generated guidance, and discern MCP tools all point at the same checkout. This also reduces the risk that built-in Edit writes to the trunk while the gate runs in the worktree.
- The generic hint remains valid for clients that genuinely cannot change their root and already permit external writes.
- Adding another protected editor is registry data plus its integration documentation; setup completion cannot silently omit its handoff.
- Opening another workspace is a visible transition the user must perform. discern cannot move a running editor window through a project file or MCP response.

## Alternatives considered

- **Disable External File Protection.** Rejected: it weakens a user-wide vendor security setting to solve one project workflow and crosses ADR 0193's boundary.
- **Write `.cursor/cli.json` permissions for the sibling root.** Rejected: that file governs Cursor CLI permissions, not the IDE Edit tool that prompted, and the absolute worktree root is machine-specific.
- **Keep approving each file.** Rejected: it is operationally unsustainable and trains users to dismiss a security prompt without evaluating a boundary.
- **Open the main checkout and worktree together as a multi-root workspace.** Rejected as the default: it leaves both the trunk and task checkout writable in one agent context, preserving the wrong-root risk the isolated workflow is meant to remove.
