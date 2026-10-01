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

Read-only Git discovery can opt into the isolated environment fallback when its host grants only named environment variables. The shared planner queries the full-environment grant without prompting; when it is unavailable, the child receives only sanitized explicit overrides and no inherited environment. Ordinary Git operations still require the full environment so identity and hooks retain their context. The [subprocess tests](../../../tests/subprocess_test.ts) guard the fallback before enumeration, and the [preview tests](../../../tests/site_development_test.ts) exercise each task's declared permissions.

Native execution records bounded Git children in the same lifetime as producer children. Cancellation settles their process groups and captured streams before returning. Receipt publication excludes its own administration reads from child enrollment, so recording one child cannot recursively demand another receipt. A cancelled producer still owes safe environment return; cancellation arriving during that return preserves its frozen recovery contract when return cannot finish.

Short publications serialize even inside an enclosing common transaction. They share their owning operation's [Git discovery](../../../src/shared/git_discovery.ts) scope. Reuse across a publication requires unchanged bounded routing bytes and directory identities witnessed around fresh Git discovery. Changed or uncertain routing requires Git; topology mutations retain full invalidation. Read-only worktree listings do not invalidate routing. No discovery answer or publication capability survives its owning operation.

[`SUBPROCESS_SPAWN_BOUNDARIES`](../../../tests/spawn_surfaces.ts) records each production-and-tooling constructor by path, function, operation, reason, binary class, and role. Future authored source roots join automatically; tests construct the processes under test and remain outside the population.

[`subprocess_spawn_boundaries.ts`](../../../scripts/subprocess_spawn_boundaries.ts) matches the Git-derived universe to registry rows in both directions. Unknown sites report line and function; stale rows report their operation. The `subprocess_spawn_boundaries` Standard counts registered boundaries only after parity succeeds, so a renamed wrapper cannot hide one. Remove a row after routing its site through the shared capability, then pin the lower ceiling.

Engine spawn homes declare an end-to-end interrupt surface or bounded exemption in [`SPAWN_INTERRUPT_CONTRACTS`](../../../tests/spawn_surfaces.ts). [`engine_interrupt_surfaces_test.ts`](../../../tests/engine_interrupt_surfaces_test.ts) consumes its surface union. [`engine_subprocess_ssot_test.ts`](../../../tests/engine_subprocess_ssot_test.ts) proves boundary parity, future-root enrollment, stale-entry rejection, shared routing, interrupt-home parity, and unique ids.

## Work beside a live screen

Work that runs inside a long-lived session beside other work answers to its owner, not to the process. The desk runs its effects this way while a foreground child, such as an agent, a shell, or a Project Script, can own the terminal. A Ctrl+C typed into that child reaches the terminal's whole foreground process group, the desk's process included. [`interrupt_source.ts`](../../../src/shared/interrupt_source.ts) names the scope's interrupt source. Under the `operation` source, the work's own `AbortSignal` is its only interrupt:

- `superviseSpawn` takes `interruptSource`, defaulting to the scope's, and installs no process-signal listener for an operation. The shared watcher behind `trackRun` and `withTrackedRun` does not track the run at all.
- Captured children lead their own process group through `childLeadsOwnGroup`, so a signal the terminal sends its foreground group never reaches them directly, and none inherits a standard stream.
- A terminal-owning child, through `runOwnedChild` or the pager, refuses with `assertTerminalOwnerAllowed` before it spawns. The session runs such children only as its own foreground commands, where the process source still applies.

[`SPAWN_SESSION_CONTRACTS`](../../../tests/spawn_surfaces.ts) declares each `src/` spawn home as captured or a terminal owner, and [`SIGNAL_LISTENER_CONTRACTS`](../../../tests/spawn_surfaces.ts) declares whom each process-signal listener serves. [`in_session_isolation_guard_test.ts`](../../../tests/in_session_isolation_guard_test.ts) holds both registries to the live source. It also reads every captured constructor's streams and group, then runs each boundary inside an operation to show that nothing listens for process signals and every child leads its group.
