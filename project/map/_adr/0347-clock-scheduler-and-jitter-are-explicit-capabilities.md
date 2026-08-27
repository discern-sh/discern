# ADR 0347: Clock, scheduler, and jitter are explicit capabilities

**Status**: accepted. Extends the host-boundary doctrine from [ADR 0336](0336-ambient-process-state-resolves-at-boundaries.md), the test-waiting contract from [ADR 0340](0340-tests-wait-on-conditions-and-enrol-real-delays.md), and exact boundary enrollment from [ADR 0344](0344-process-egress-and-termination-have-exact-boundaries.md).

## Context

Time entered authored code through several primitives with different meanings. Wall-clock reads stamped records and decided expiry. Monotonic reads measured duration. Timer calls scheduled callbacks and separately cancelled them. Test-run-slot retries also sampled `Math.random` to vary their delay. A wall-clock function alone could not represent those contracts without inviting wall time into duration measurement or leaving timer lifecycle ambient.

The ambient process-state registry allowed reads at module granularity. That was sufficient to count host-facing modules, but permission for one environment or cwd operation also covered an unrelated future read in the same file. Extending that shape to clocks would have made a new boundary less exact than the timer and process-effect contracts around it.

Tests also need two different controls. A fixed instant proves a pure timestamp, expiry, percentile, or duration calculation. Fake time proves that callbacks are scheduled, ordered, and cancelled correctly. Substituting one technique for the other can make a test pass without exercising the behavior it names.

Scheduling jitter is pseudo-random policy, not entropy. Combining it with identifiers, single-use values, keys, or uniqueness would either make secure work injectable through an unsafe source or force harmless retry variation through an unnecessarily privileged security interface.

## Decision

[`Clock`](../../../src/shared/clock.ts) is the time-reading capability. It exposes separately named wall and monotonic millisecond functions. Wall time supplies record timestamps, leases, expiry, and civil-time decisions. Monotonic time supplies elapsed durations and deadlines that must ignore wall-clock jumps. Pure calculations receive instants and durations as data; host-facing functions accept a clock, with `SYSTEM_CLOCK` as their production default. Persisted timestamp formats remain unchanged.

[`Scheduler`](../../../src/shared/scheduler.ts) owns timeout and interval scheduling together with their matching cancellation operations. Deno code uses `SYSTEM_SCHEDULER`; browser code uses its realm-specific system adapter. A caller that schedules work retains an explicit settlement, abort, teardown, or process-lifetime owner. Watchdog escalation, child-tree termination, signal handling, callback order, and shutdown semantics remain behavior contracts rather than implementation shortcuts.

`JitterFn` owns non-security scheduling variation. The production implementation samples `Math.random` only inside the scheduler authority and applies the bounded test-run-slot delay policy. Tests may inject a deterministic function or supply a unit-interval sample to the pure policy. Secure identifiers, secrets, keys, single-use values, random bytes, and uniqueness never use this capability.

Every direct host operation is enrolled by stable id, exact path, enclosing function, primitive operation, and reason. `CLOCK_PRIMITIVE_BOUNDARIES`, `SCHEDULER_PRIMITIVE_BOUNDARIES`, and `JITTER_PRIMITIVE_BOUNDARIES` own the time authorities. `AMBIENT_READ_BOUNDARIES` and `AMBIENT_MUTATION_BOUNDARIES` use the same operation-exact shape for environment and cwd access; no module-wide permission remains.

The ambient-state lint plugin recognizes wall-clock reads, zero-argument date construction, callable `Date`, monotonic reads, timeout and interval scheduling or cancellation, and scheduling jitter, including the live bare, `globalThis`, and Deno spellings. Argument-taking `new Date(value)` remains a legal conversion. The guard binds registry rows and call sites in both directions before the census emits `ambient_read_operations`, `clock_primitive_boundaries`, `scheduler_primitive_boundaries`, or `scheduling_jitter_boundaries`. The earlier ambient read-module and mutation metrics remain independently measured so their limits keep their meaning.

Fixed injected clocks prove pure time calculations and the separation of wall from monotonic movement. `FakeTime` is reserved for behavior whose subject is actual scheduling, ordering, or cancellation. Unavoidable real waits continue through the exact test-waiting registry.

## Consequences

- Code can answer timestamp, expiry, and duration questions at an exact injected wall or monotonic instant without changing global runtime state.
- Scheduling and cancellation are one lifecycle capability. Timers cannot appear in a new module merely because that module already owns another host interaction.
- Deno and browser realms each retain a small system adapter, while consumers share one scheduler contract.
- The ambient read-module Standard remains comparable with its earlier readings; a new operation-level Standard prevents hidden growth within an already enrolled module.
- Clock, scheduler, and jitter authority populations can only fall without an owner-approved Standard change. Unknown and stale entries fail even if a raw count stays level.
- Deterministic jitter tests do not weaken secure entropy. The later secure-entropy authority can centralize cryptographic sources without inheriting timer policy.
- Capability parameters add wiring at host boundaries, accepted in exchange for pure calculations and explicit callback ownership. Public result and persisted timestamp formats do not change.

## Alternatives considered

- **Wrap only `Date.now`.** Rejected because monotonic duration reads, timer scheduling, cancellation, and jitter would remain ambient.
- **Use wall time for every measurement.** Rejected because system-clock jumps can corrupt elapsed durations and deadlines.
- **Install fake time for every time-dependent test.** Rejected because pure calculations need fixed values, while global timer replacement can change process, signal, watchdog, and tree-kill behavior.
- **Keep module-wide ambient-read permissions.** Rejected because one legitimate operation would silently authorize unrelated future reads in the same module.
- **Expose scheduling without cancellation.** Rejected because callback creation without a matching lifecycle owner leaks work across settlement and teardown boundaries.
- **Use one randomness interface for jitter and secure entropy.** Rejected because deterministic retry variation has weaker security requirements than identifiers, secrets, keys, single-use values, and random bytes.
- **Brand wall and monotonic milliseconds as incompatible numeric types throughout the codebase.** Rejected for now because persisted and external contracts already use numbers; distinct capability members and parameter names preserve semantics without a repository-wide wire-format migration.
