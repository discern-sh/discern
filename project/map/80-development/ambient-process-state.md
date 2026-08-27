---
aliases:
  - ambient state
  - process environment
  - cwd injection
  - host boundary
---

# Ambient process state

_Where authored code may consult the host process, and how deeper code receives those values._

Environment variables and the current working directory are runtime inputs. Resolve them at a composition root and pass the resulting string or setting into deeper code. A default parameter such as `cwd: string = Deno.cwd()` is also a visible injection seam: production callers retain host behavior while tests and embeddings can pass a value directly ([ADR 0336](../_adr/0336-ambient-process-state-resolves-at-boundaries.md)).

Do not thread an environment-reader interface through several layers merely to move a read. If an executable entry point, command adapter, server, standalone script, or integration-test boundary genuinely adapts the host, give that one operation a stable entry in [`AMBIENT_READ_BOUNDARIES`](../../../scripts/ambient_state_lint.ts). Each entry names the exact path, enclosing function, primitive, semantic operation, and reason. Permission never applies to the rest of the module: another read in the same function or file needs its own entry. Feature-toggle modules retain their host-facing contract through the same registry.

Process mutation is a separate and stricter boundary. `Deno.env.set` and `Deno.env.delete` require the same exact path, function, primitive, and operation contract in `AMBIENT_MUTATION_BOUNDARIES`. Prefer an explicit value seam; the registry is empty while no unavoidable mutation exists. A default parameter never exempts mutation.

## Clock, scheduler, and jitter

Wall time, monotonic time, timer lifecycle, and non-security scheduling variation are different facts ([ADR 0347](../_adr/0347-clock-scheduler-and-jitter-are-explicit-capabilities.md)). [`Clock`](../../../src/shared/clock.ts) exposes wall milliseconds for timestamps and expiry, plus monotonic milliseconds for durations that must ignore wall-clock jumps. Pure calculations receive the instant or duration as data. Host-facing boundaries accept a `Clock`, normally defaulting to `SYSTEM_CLOCK`.

[`Scheduler`](../../../src/shared/scheduler.ts) owns timeout and interval scheduling together with their matching cancellation operations. A function that schedules a callback also owns its settlement, abort, teardown, or process-lifetime rule. Deno and browser code use realm-specific system adapters, while deeper code receives the common capability.

`JitterFn` chooses bounded scheduling variation. `SYSTEM_JITTER` is the only direct `Math.random` reader for that purpose. It is not an entropy source: identifiers, keys, single-use values, uniqueness, and random bytes require the separate secure-entropy authority.

## One authority for the trunk branch

[`integrationBranch`](../../../src/engine/worktree/git.ts) owns the `DISCERN_TRUNK` precedence contract and is its only environment reader. Call it at the boundary or pass its resolved branch name. Do not reproduce the environment lookup in a consumer.

## Enforcement and recovery

The ambient-state plugin in [`ambient_state_lint.ts`](../../../scripts/ambient_state_lint.ts) runs under `deno lint`. It recognizes environment and cwd reads, environment mutations, wall and monotonic clock reads, timeout and interval scheduling or cancellation, and scheduling jitter through their bare, `globalThis`, and Deno forms. Argument-taking `new Date(value)` remains a conversion and does not read the clock.

[`ambient_state_lint_test.ts`](../../../tests/ambient_state_lint_test.ts) applies the rules to the full Git-derived `authored-deno` universe. It binds every registry row to one live operation in both directions and rejects unknown, duplicate, moved, or stale entries. The `ambient_read_boundaries` Standard retains the earlier module-population ceiling; `ambient_read_operations` holds the exact operation population; and `ambient_mutation_boundaries`, `clock_primitive_boundaries`, `scheduler_primitive_boundaries`, and `scheduling_jitter_boundaries` hold the remaining registries under down-only limits in [`discern.toml`](../../../discern.toml).

When a rule finds a primitive, first pass the already-resolved value or capability from the nearest composition root. A direct default is appropriate when the function itself is the public seam. Add a registry row only when the named operation owns a genuine host interaction and further threading would conceal that boundary. For timers, preserve the callback's lifecycle and cancellation semantics; for duration measurements, keep monotonic time distinct from wall time.
