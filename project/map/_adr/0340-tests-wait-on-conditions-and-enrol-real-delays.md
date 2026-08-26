# ADR 0340: Tests wait on conditions and enrol real delays

**Status**: accepted.

## Context

The suite mixed three local polling helpers with direct timers spread across tests, shared support, executable fixtures, and TypeScript stored inside child-program strings. Most intervals guessed how long an external condition might take. They charged every run the full guess when the condition became true early, yet still failed when a loaded machine needed longer. A smaller population tests elapsed time itself: cancellation grace, watchdogs, terminal input pacing, delayed descendants, and other scenarios where replacing the interval with a positive condition would remove the behavior under test.

A helper that accepts milliseconds and a free-form reason cannot distinguish those populations. It moves the timer call out of a structural scan while allowing every new caller to invent its own justification. A TypeScript-module-only scan also misses executable fixture files and opaque child source, so it certifies less than the suite executes.

## Decision

**Executable test code waits for observable conditions through one `waitUntil` capability; every genuine wall-clock interval is a member of one closed `TEST_REAL_DELAY_BOUNDARIES` registry and is spent through `realDelay`.**

`waitUntil` evaluates the named condition immediately, yields through the test scheduler between attempts, and reports the unmet condition, budget, interval, elapsed time, and attempt count when its bound expires. Tests of timer behavior use the shared fake-time facility or injected control. A real elapsed interval carries a literal stable boundary id whose registry row records its exact module, enclosing test or helper, operation, and reason a condition or fake clock would not test the contract.

A text guard scans the Git-derived `tests/` universe, including executable fixtures, future fixture roots, and timer syntax embedded in strings. It rejects direct timer APIs outside the capability and binds registry entries and literal calls one-to-one in both directions. A deterministic census runs the same parity check before emitting the registry population, and the `test_real_delay_boundaries` Standard holds that count under a falling ceiling. Production clock and scheduling boundaries remain outside this decision.

## Consequences

- Eventual tests advance as soon as their observable condition becomes true and timeout failures name what remained unmet.
- Timer behavior can progress deterministically under fake time without making the whole suite depend on processor speed.
- Every real elapsed interval becomes visible in review and consumes one Standard member; adding or moving one requires editing both its registry evidence and its exact call site.
- Text scanning deliberately sees source inside strings. Tests that plant forbidden timer syntax construct it from fragments so the live guard does not mistake its own adversarial fixture for an executable violation.
- Genuine terminal, signal, cancellation, watchdog, and negative-observation scenarios still spend wall time. Their registry metadata is maintenance overhead, accepted because a free-form wrapper would hide population growth.

## Alternatives considered

- **Keep raw timers with comments.** Rejected because comments neither prevent new guesses nor make the exception population measurable.
- **Accept a free-form reason at each helper call.** Rejected because the helper would launder new sleeps and the falling ceiling would count only the helper implementation.
- **Scan parsed authored TypeScript only.** Rejected because executable fixtures and child-program source outside that universe can still run timers.
- **Install fake timers globally.** Rejected because process, terminal, signal, and watchdog integration tests need the real scheduler, while global replacement would change the behavior they exercise.
