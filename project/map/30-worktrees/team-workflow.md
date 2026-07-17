---
title: Parallel and team work
description: How people and agents share a repository while each change stays in its own worktree and branch.
order: 40
aliases:
  - team workflow
  - parallel agents
  - worktree fleet
  - multi-repo work
---

# Parallel and team work

_Give every task its own worktree, and use the main checkout to supervise the fleet._

One worktree represents one occupied line of work. It belongs to the agent or person handling that task until it lands or its owner discards it. Never adopt another worktree because it looks idle or clean. Git state says nothing about ownership.

## Survey concurrent work

Run `discern status` from the main checkout for the fleet view. It reports each worktree's branch, path, id, port, git cleanliness, distance from the trunk, and last activity. From inside a worktree, pass `--all` for the same survey or keep the default local view.

The survey preserves unknown states instead of guessing:

| State                                          | What status reports                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Tracked or untracked non-ignored files changed | `clean: false` with the changed-file count.                            |
| Checkout has no project config                 | `broken`, with the `worktree drop` recovery.                           |
| Git cannot read a checkout                     | Sets `git_unavailable`. Clean and ahead values stay absent.            |
| Work remains idle for 7 days                   | A hint to resume or drop the stale worktree.                           |
| `agent/*` branch has no worktree               | `unlanded_branches`, with `start --from` and `update --from` recovery. |
| Local trunk is missing                         | Ahead remains `null` because discern cannot compare it.                |

If the tools point at a pristine worktree while the main checkout accumulates changes, `status` and `done` warn about silent divergence. Move file operations into the worktree and pass its absolute path to Model Context Protocol (MCP) tools. That warning catches the common failure where editing and validation happen in different trees.

## Compose work below the trunk

The trunk is the single landing target. Build dependent phases by pulling branches into worktrees:

- `discern start --from <ref>` creates a new worktree from any branch, tag, or commit.
- `discern update --from <ref>` merges any ref into an existing worktree.
- `discern accept --confirmed` lands only the finished whole on the trunk ([ADR 0110](../_adr/0110-the-landing-model.md)).

This pull-side composition keeps half-finished phases away from the shared landing branch. Concurrent accepts are safe: if another worktree moves the trunk first, the later acceptance leaves its worktree and resources intact and asks for `update → done → accept`.

## Work across repositories

The MCP `discern_start` tool accepts an absolute `path` inside any discern project on disk. It creates the worktree from that project's trunk and re-aims later discern tools at the new root. Pass `path` to later tools when the client cannot change its own working directory ([ADR 0111](../_adr/0111-cross-project-path-and-strict-tool-schemas.md)).

Each repository keeps its own config, worktree root, resource ledger, and trunk. Cross-project starts share an agent session while retaining separate project state.

## Bring a teammate into the workflow

A clone works without the discern binary. `discern.toml`, the authored namespace, provider settings, and compiled agent files travel in git. The application still builds and tests through its ordinary commands, and coding agents read the committed guidance.

Without the binary, the clone lacks materialized skills and the `discern_*` MCP tools. To add them:

1. Install discern.
2. Run `discern refresh` in the clone.
3. Start a fresh agent session so MCP tools and hooks load.

Some agents also require folder trust. `discern doctor` names the provider-specific step.

Claude Code can create and remove worktrees through `WorktreeCreate` and `WorktreeRemove` hooks. The binary parses the hook JSON itself, with no `jq` dependency, and calls the same create, setup, and teardown cores as `discern start`. After setup, hook-created worktrees also branch from the trunk. Its session-start hook reruns resource and setup convergence ([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). Other agents use the shared lifecycle verbs directly.

## Where it lives in code

| Responsibility                  | Source                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Fleet status and recovery hints | [`src/engine/status/status.ts`](../../../src/engine/status/status.ts)             |
| Cross-project MCP routing       | [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts)                   |
| Claude Code hook adapter        | [`src/lib/worktree_hooks.ts`](../../../src/lib/worktree_hooks.ts)                 |
| Status truth tests              | [`tests/engine_status_truth_test.ts`](../../../tests/engine_status_truth_test.ts) |

## Current state and gotchas

- The main checkout is the supervisory view. Make task changes only inside a worktree.
- `discern status` only inspects state. It never creates, refreshes, or destroys a resource.
- The fleet's git-clean signal excludes ignored provider-local and generated files.
