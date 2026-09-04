# ADR 0082: Codex project config grants the discern worktree root and narrow Git rules

**Status**: accepted; extends [ADR 0031](0031-typed-provider-integration.md) (one provider registry), [ADR 0045](0045-mcp-is-core-infrastructure.md) (MCP is rewired on refresh), [ADR 0052](0052-worktree-sibling-placement.md) (worktrees live beside the checkout), and [ADR 0073](0073-codex-worktree-lifecycle-comanagement.md) (Codex app lifecycle co-management).

## Context

Codex sessions commonly start in the main checkout. In a discern-enabled project, the agent then calls `discern_start`, which creates a linked worktree under the configured worktree root and re-aims the discern MCP server at that new checkout. The MCP tools follow the new root, but Codex's shell sandbox was launched with the main checkout as its writable workspace.

That mismatch causes daily friction: normal edits and commands in the new sibling worktree can trip Codex's filesystem permission checks. The obvious Codex knob is `sandbox_workspace_write.writable_roots`, which can add another writable directory to workspace-write mode.

There are two constraints:

- Codex resolves project-config relative paths from the containing `.codex/` directory, so discern must write a path relative to that directory, not the repository root.
- A writable root is not a linked-worktree Git carve-out. Codex protects `.git` paths inside writable roots, including a linked worktree's `.git` pointer and the resolved shared Git directory. Adding the worktree directory reduces normal file-edit friction, but it does not by itself make `git add` or `git commit` inside that linked worktree approval-free.

Codex also supports project-local exec-policy rules under `.codex/rules/`. Once the project is trusted and Codex has loaded that project layer, a narrow prefix-rule file can allow the expected Git staging/commit prefixes without granting broad shell or Git access.

## Decision

discern co-manages the Codex project config in `.codex/config.toml` through the existing provider registry and writes only the narrow settings it owns:

```toml
project_doc_max_bytes = 65536

[sandbox_workspace_write]
writable_roots = ["../../<repo>.worktrees"]

[mcp_servers.discern]
command = "discern"
args = ["mcp", "--long-tool-calls"]
startup_timeout_sec = 30
tool_timeout_sec = 3600
```

`writable_roots` is merged with any existing user list. The added entry is the configured `[worktree].root`: default sibling roots are written relative to `.codex/`, relative configured roots are rewritten relative to `.codex/`, and absolute configured roots stay absolute.

When refresh runs inside a linked worktree, discern asks Git for the main checkout and computes the writable root from that main checkout. This prevents a worktree-local refresh from committing a transient `../../<worktree-id>.worktrees` path.

`project_doc_max_bytes` is set only if absent. The MCP server table is discern-owned, so refresh rewrites its command, arguments, and timeout keys, and removes any stale `cwd` override.

discern also co-manages `.codex/rules/discern.rules`, a discern-owned project rules file separate from user-owned files such as `.codex/rules/default.rules`. It contains only:

```toml
prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow the git add command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = ["git add -A", "git add src/example.ts"],
    not_match = ["git status", "git push", "git reset --hard"],
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow the git commit command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = ["git commit -m Example", "git commit --amend --no-edit"],
    not_match = ["git status", "git push", "git reset --hard"],
)
```

The rules file is idempotently re-emitted only when Codex is enabled in `[project].agents`. It is reported as `project_rules_wired`, not `mcp_wired`, because it is a provider policy artifact rather than an MCP server entry.

The explicit *no*s:

- **No broad parent-directory grant.** `../..` from `.codex/` would cover every sibling of the repository, not just discern's worktree root.
- **No `sandbox_mode`, approval-policy, network, model, profile, or MCP approval-mode settings.** Those are user and project security choices, not discern-owned wiring.
- **No broad Git or shell allowance.** The project rules allow only the exact `git add` and `git commit` prefixes. They do not allow broad `git`, `git push`, shell wrappers, destructive commands, network access, or sandbox bypass.
- **No mutation of user rules.** discern owns `.codex/rules/discern.rules`; it must not rewrite `.codex/rules/default.rules` or any other user-authored rules file.
- **No `required = true` on the MCP server.** A missing or unhealthy discern MCP server should degrade to the documented CLI fallback, not block Codex startup.

## Consequences

Codex users get fewer filesystem prompts after `discern_start`: normal file writes happen under the configured writable root, and the two expected command prefixes are allowed after the project layer is trusted. The prefix rules have no working-directory boundary, so they are narrow by command prefix rather than by path. The writable-root grant stays narrow and derives from the same `[worktree].root` setting that creates the worktrees.

The committed config can still change when a repository is cloned under a different directory name, because the default worktree root is based on the main checkout's basename. That churn is preferable to granting the whole parent directory.

The integration still relies on Codex's trust boundary. Project `.codex/` layers are inert until the user trusts the project and may require a fresh session or restart before newly written rules are loaded. The project rules smooth only the routine `git add` / `git commit` path; other Git operations remain governed by Codex's normal sandbox and approval flow.

## Alternatives considered

- **Grant the repository parent directory.** Rejected: it is portable, but it widens write access to unrelated sibling projects.
- **Set aggressive Codex security defaults from project config.** Rejected: discern should not override user security posture, model choices, network posture, or approval policy.
- **Tell users to create `.codex/rules/default.rules` by hand.** Rejected: the common linked-worktree staging/commit path is part of discern's Codex integration, and mutating a user-owned default rules file would blur ownership.
- **Do nothing and rely on approval prompts.** Rejected: the prompts occur on the common happy path and discern can compute the narrow worktree root exactly; Codex's project rules can cover the remaining Git prefixes narrowly.
