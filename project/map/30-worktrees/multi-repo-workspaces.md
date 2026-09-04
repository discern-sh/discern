---
title: Multi-repo workspaces
description: Configure discern across sibling repositories, from local package links and registries to umbrella repos and submodules.
order: 70
aliases:
  - multi-repo work
  - polyrepo
  - workspace
  - local packages
  - submodules
---

# Multi-repo workspaces

_Each repository has its own install, linked to others through trunks, registries, or submodules._

discern's unit is the repository. Each repository holds its own `discern.toml`, Gate, [trunk](../00-orientation/glossary.md#trunk), worktree fleet, and resource ledger. A workspace of several repositories runs an install in each one, and an agent session moves between them by passing `path` to the Model Context Protocol (MCP) tools ([ADR 0111](../_adr/0111-cross-project-path-and-strict-tool-schemas.md)). [Parallel and team work](team-workflow.md) covers the mechanics. There is no workspace-level config. [Proofs](../20-quality-gate/the-proof.md), Standards, and accepts never span repositories. A change that touches 2 repositories requires 2 worktrees, 2 Gate runs, and 2 landings.

## Link sibling repositories through their trunks

The common layout keeps repos side by side under one parent, with consumers wiring a library in through the package manager's local-path mechanism: `file:` dependencies in npm, `use` directives in a Go workspace, Cargo path dependencies, local Swift packages, Composer path repositories.

Point those links at the library's main checkout with an absolute path. The main checkout sits on the trunk, work happens in worktrees, and the trunk moves when `discern accept` lands a validated commit ([ADR 0110](../_adr/0110-the-landing-model.md)). A consumer linking the main checkout builds against landed states of the library and does not read an unlanded worktree branch.

Absolute paths hold on one machine only. A team keeps the committed manifest shared with one level of indirection: agree on a stable path such as `/opt/acme/shared-lib`, point the manifest there, and each developer symlinks that path to their own checkout. The symlink lives outside the repository, so every worktree resolves it with nothing to recreate. Otherwise, publish to a registry, or use relative links plus the placement below.

A relative link such as `file:../shared-lib` assumes the consumer's checkout sits beside the library. By default a worktree does not: `discern start` places it at `<parent>/<repo>.worktrees/<id>`, so `../shared-lib` may resolve to nothing even when the main checkout's gate passes. Place worktrees in the workspace parent instead:

```toml
[worktree]
root = ".."
```

Worktrees then sit beside the repositories, and `../shared-lib` resolves from a worktree the same way it does from the repo.

## Depend through a registry

Repositories that consume each other's published releases (npm, JSR, PyPI, Maven, an internal registry) need no discern configuration. Each repository is self-contained, and its gate builds against the declared versions.

A change that spans library and consumer lands in order. Land the library first, publish the release, then bump the consumer's dependency and land that. Each landing passes its own repository's gate.

## Umbrella repositories

Some workspaces add a front-door repo holding compose files, scripts, and workspace docs. Install discern in each child repository. The umbrella may also carry its own install whose gate runs the integration checks. A worktree of the umbrella isolates the umbrella's files only: the child repositories underneath are separate repos and stay shared.

## Submodules

A superproject pins child repositories by commit with `git submodule`. `discern start` creates the checkout with `git worktree add`, and Git leaves submodule directories empty in a new worktree. Populate them with repository convergence:

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

- Root discovery walks up from the working directory to the nearest `discern.toml` and does not stop at a repository boundary ([`src/shared/env.ts`](../../../src/shared/env.ts)). A repo without its own config, nested under a directory that has one, resolves to the outer project; `discern doctor`, run from the nested repo, discloses the crossing.
- A consumer's Gate reads a linked library at whatever state the linked checkout holds at that moment. Linking the main checkout keeps that state landed, and the consumer's Proof still describes only its own repository.
- `discern start` runs no submodule population of its own: the `[repository].ensure` command above is the supported path, and `start` hints at it when the fresh worktree carries a `.gitmodules` no configured command mentions.
