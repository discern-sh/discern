---
title: Subprocess boundaries
description: Route ordinary Git and buffered shell work through the shared capability and register every specialized constructor exactly.
order: 55
aliases:
  - subprocess spawning
  - spawn boundaries
  - Deno Command
---

# Subprocess boundaries

_A direct child-process constructor is either the shared capability itself or an exact, ratcheted exception._

[`subprocess.ts`](../../../src/shared/subprocess.ts) owns ordinary Git and buffered shell execution: binary resolution, safe Git arguments, working-directory injection, capture, decoding, spawn failure, optional bounds, and descendant quiescence. A caller uses `runGit` or `runShell` when those semantics fit. Specialized operations keep their own constructor when they need a different protocol, such as interactive terminal inheritance, live Gate streaming, a platform launcher, staged formatting over standard input, or a supervised process group.

[`SUBPROCESS_SPAWN_BOUNDARIES`](../../../tests/spawn_surfaces.ts) records every direct production-and-tooling constructor. Each row names the repository path, nearest stable enclosing function, operation, reason, binary class, and whether it implements the shared capability or remains a registered boundary. Tooling includes any future authored source root; test harnesses are outside this population because constructing the process under test is their infrastructure.

[`subprocess_spawn_boundaries.ts`](../../../scripts/subprocess_spawn_boundaries.ts) parses the declared Git-derived universe and matches constructors to registry rows in both directions. An unknown site reports its line and enclosing function. A stale row reports its recorded operation. The `subprocess_spawn_boundaries` Standard counts the same registered-boundary rows only after that parity check succeeds, so moving a constructor behind a newly named wrapper cannot hide it. Remove a registry row when a site moves through the shared capability, then pin the lower ceiling.

Engine spawn homes carry one further contract in [`SPAWN_INTERRUPT_CONTRACTS`](../../../tests/spawn_surfaces.ts): an end-to-end interrupt surface or a bounded exemption. [`engine_interrupt_surfaces_test.ts`](../../../tests/engine_interrupt_surfaces_test.ts) is typed over the declared surface union. [`engine_subprocess_ssot_test.ts`](../../../tests/engine_subprocess_ssot_test.ts) proves exact boundary parity, future-root enrollment, stale-entry rejection, Git and shell routing, interrupt-home parity, and unique interrupt surface ids.
