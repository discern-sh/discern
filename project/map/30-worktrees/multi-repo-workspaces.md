---
title: Multi-repo workspaces
description: Configure discern across sibling repositories, from local package links and registries to umbrella repos and submodules.
order: 55
aliases:
  - multi-repo work
  - polyrepo
  - workspace
  - local packages
  - submodules
---

# Multi-repo workspaces

_One install per repository, linked by trunks, registries, or submodules._

discern's unit is the repository. Each repo holds its own `discern.toml`, gate, [trunk](../00-orientation/glossary.md#trunk), worktree fleet, and resource ledger. A workspace of several repositories runs one install per repo, and one agent session moves between them by passing `path` to the Model Context Protocol (MCP) tools ([ADR 0111](../_adr/0111-cross-project-path-and-strict-tool-schemas.md)). [Parallel and team work](team-workflow.md) covers the mechanics. There is no workspace-level config. [Receipts](../00-orientation/glossary.md#receipt), standards, and accepts never span repositories: a change that touches two repos is two worktrees, two gate runs, and two landings.

## Link sibling repositories through their trunks

The common layout keeps repos side by side under one parent, with consumers wiring a library in through the package manager's local-path mechanism: `file:` dependencies in npm, `use` directives in a Go workspace, Cargo path dependencies, local Swift packages, Composer path repositories.

Point those links at the library's main checkout, with an absolute path. The main checkout sits on the trunk, work happens in worktrees, and the trunk moves when `discern accept` lands a validated commit ([ADR 0110](../_adr/0110-the-landing-model.md)). A consumer linking the main checkout builds against landed, validated states of the library and never sees an unlanded branch.

Absolute paths hold on one machine only. For a team, publish to a registry instead, or use relative links plus the placement below.

A relative link such as `file:../shared-lib` assumes the consumer's checkout sits beside the library. By default a worktree does not: `discern start` places it at `<parent>/<repo>.worktrees/<id>`, so `../shared-lib` resolves to nothing, the main checkout's gate passes, and every worktree's gate fails on dependency resolution. Place worktrees in the workspace parent instead:

```toml
[worktree]
root = ".."
```

Worktrees then sit beside the repositories, and `../shared-lib` resolves from a worktree the same way it does from the repo.

## Depend through a registry

Repositories that consume each other's published releases (npm, JSR, PyPI, Maven, an internal registry) need no discern configuration. Each repo is self-contained, and its gate builds against the declared versions.

A change that spans library and consumer lands in order. Land the library first, publish the release, then bump the consumer's dependency and land that. Each landing passes its own repo's gate.

## Umbrella repositories

Some workspaces add a front-door repo holding compose files, scripts, and workspace docs. Install discern in each child repository. The umbrella may also carry its own install whose gate runs the integration checks. A worktree of the umbrella isolates the umbrella's files only: the child repositories underneath are separate repos and stay shared.

## Submodules

A superproject pins child repositories by commit with `git submodule`. `discern start` creates the checkout with `git worktree add`, and git leaves submodule directories empty in a new worktree. Populate them with repository convergence:

```toml
[repository]
ensure = ["git submodule update --init --recursive"]
```

`[repository].ensure` runs on every managed worktree pass, including `discern update`, so a submodule pointer that moves with the trunk converges on the next pass.

## Where it lives in code

| Concept                                          | File                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Default worktree placement and `[worktree].root` | [`src/lib/paths.ts`](../../../src/lib/paths.ts)                                 |
| Project-root discovery                           | [`src/shared/env.ts`](../../../src/shared/env.ts)                               |
| Repository convergence (`[repository].ensure`)   | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts) |
| Cross-project MCP routing                        | [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts)                 |

## Current state and gotchas

- Root discovery walks up from the working directory to the nearest `discern.toml` and does not stop at a repository boundary ([`src/shared/env.ts`](../../../src/shared/env.ts)). A repo without its own config, nested under a directory that has one, resolves to the outer project.
- A consumer's gate reads a linked library at whatever state the linked checkout holds at that moment. Linking the main checkout keeps that state landed and validated, and the consumer's receipt still describes its own repository only.
- Currently `discern start` runs no submodule population of its own; the `[repository].ensure` command above is the supported path.
