---
title: Subprocess boundaries
description: Route ordinary spawns through the shared capability or an exact ratcheted registry.
order: 60
aliases:
  - subprocess spawning
  - spawn boundaries
  - Deno Command
---

# Subprocess boundaries

_Every direct child-process constructor has one declared boundary._

[`subprocess.ts`](../../../src/shared/subprocess.ts) owns ordinary Git and buffered shell execution, including safe arguments, capture, bounds, and descendant quiescence. Use `runGit` or `runShell` when they fit. Specialized operations retain constructors for interactive input/output, live gate streaming, platform launch, standard-input formatting, or process-group supervision.

Native execution records bounded Git children in the same lifetime as producer children. Cancellation settles their process groups and captured streams before returning. Receipt publication excludes its own administration reads from child enrollment, so recording one child cannot recursively demand another receipt. A cancelled producer still owes safe environment return; cancellation arriving during that return preserves its frozen recovery contract when return cannot finish.

Short publications serialize even inside an enclosing common transaction. They share their owning operation's [Git discovery](../../../src/shared/git_discovery.ts) scope. Reuse across a publication requires unchanged bounded routing bytes and directory identities witnessed around fresh Git discovery. Changed or uncertain routing requires Git; topology mutations retain full invalidation. Read-only worktree listings do not invalidate routing. No discovery answer or publication capability survives its owning operation.

[`SUBPROCESS_SPAWN_BOUNDARIES`](../../../tests/spawn_surfaces.ts) records each production-and-tooling constructor by path, function, operation, reason, binary class, and role. Future authored source roots join automatically; tests construct the processes under test and remain outside the population.

[`subprocess_spawn_boundaries.ts`](../../../scripts/subprocess_spawn_boundaries.ts) matches the Git-derived universe to registry rows in both directions. Unknown sites report line and function; stale rows report their operation. The `subprocess_spawn_boundaries` Standard counts registered boundaries only after parity succeeds, so a renamed wrapper cannot hide one. Remove a row after routing its site through the shared capability, then pin the lower ceiling.

Engine spawn homes declare an end-to-end interrupt surface or bounded exemption in [`SPAWN_INTERRUPT_CONTRACTS`](../../../tests/spawn_surfaces.ts). [`engine_interrupt_surfaces_test.ts`](../../../tests/engine_interrupt_surfaces_test.ts) consumes its surface union. [`engine_subprocess_ssot_test.ts`](../../../tests/engine_subprocess_ssot_test.ts) proves boundary parity, future-root enrollment, stale-entry rejection, shared routing, interrupt-home parity, and unique ids.
