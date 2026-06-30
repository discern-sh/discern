# ADR 0081: Codex project config grants the discern worktree root, not broader sandbox control

**Status**: accepted; extends [ADR 0031](0031-typed-provider-integration.md)
(one provider registry), [ADR 0045](0045-mcp-is-core-infrastructure.md) (MCP is
rewired on refresh), [ADR 0052](0052-worktree-sibling-placement.md) (worktrees
live beside the checkout), and
[ADR 0073](0073-codex-worktree-lifecycle-comanagement.md) (Codex app lifecycle
co-management).

## Context

Codex sessions commonly start in the main checkout. In a discern-enabled
project, the agent then calls `discern_start`, which creates a linked worktree
under the configured worktree root and re-aims the discern MCP server at that
new checkout. The MCP tools follow the new root, but Codex's shell sandbox was
launched with the main checkout as its writable workspace.

That mismatch causes daily friction: normal edits and commands in the new
sibling worktree can trip Codex's filesystem permission checks. The obvious
Codex knob is `sandbox_workspace_write.writable_roots`, which can add another
writable directory to workspace-write mode.

There are two constraints:

- Codex resolves project-config relative paths from the containing `.codex/`
  directory, so discern must write a path relative to that directory, not the
  repository root.
- A writable root is not a linked-worktree Git carve-out. Codex protects `.git`
  paths inside writable roots, including a linked worktree's `.git` pointer and
  the resolved shared Git directory. Adding the worktree directory reduces
  normal file-edit friction, but it does not make `git commit` inside that
  linked worktree approval-free.

## Decision

discern co-manages the Codex project config in `.codex/config.toml` through the
existing provider registry and writes only the narrow settings it owns:

```toml
project_doc_max_bytes = 65536

[sandbox_workspace_write]
writable_roots = ["../../<repo>.worktrees"]

[mcp_servers.discern]
command = "discern"
args = ["mcp"]
cwd = ".."
startup_timeout_sec = 30
tool_timeout_sec = 3600
```

`writable_roots` is merged with any existing user list. The added entry is the
configured `[worktree].root`: default sibling roots are written relative to
`.codex/`, relative configured roots are rewritten relative to `.codex/`, and
absolute configured roots stay absolute.

When refresh runs inside a linked worktree, discern asks Git for the main
checkout and computes the writable root from that main checkout. This prevents a
worktree-local refresh from committing a transient
`../../<worktree-id>.worktrees` path.

`project_doc_max_bytes` is set only if absent. The MCP server table is
discern-owned, so refresh rewrites its command, arguments, cwd, and timeout
keys.

The explicit *no*s:

- **No broad parent-directory grant.** `../..` from `.codex/` would cover every
  sibling of the repository, not just discern's worktree root.
- **No `sandbox_mode`, approval-policy, network, model, profile, or MCP
  approval-mode settings.** Those are user and project security choices, not
  discern-owned wiring.
- **No claim that linked-worktree Git writes are solved.** Codex still protects
  the Git metadata paths; commits can still prompt or require a session whose
  workspace is already the worktree.
- **No `required = true` on the MCP server.** A missing or unhealthy discern MCP
  server should degrade to the documented CLI fallback, not block Codex startup.

## Consequences

Codex users get fewer filesystem prompts after `discern_start` because the
created sibling worktree sits under a configured writable root. The grant stays
narrow and derives from the same `[worktree].root` setting that creates the
worktrees.

The committed config can still change when a repository is cloned under a
different directory name, because the default worktree root is based on the main
checkout's basename. That churn is preferable to granting the whole parent
directory.

The integration remains honest about Codex's current linked-worktree limitation:
normal file work is smoother, but Git metadata remains protected by Codex.

## Alternatives considered

- **Grant the repository parent directory.** Rejected: it is portable, but it
  widens write access to unrelated sibling projects.
- **Set aggressive Codex security defaults from project config.** Rejected:
  discern should not override user security posture, model choices, network
  posture, or approval policy.
- **Do nothing and rely on approval prompts.** Rejected: the prompts occur on
  the common happy path and discern can compute the narrow worktree root
  exactly.
