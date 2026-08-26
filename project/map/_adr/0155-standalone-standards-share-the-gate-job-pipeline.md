# ADR 0155: Standalone standards share the gate job pipeline

> **Amendment ([ADR 0339](0339-proposed-standard-limits-and-shared-measurements.md)):** the shared pipeline now groups measuring Standards by process execution identity. One scheduled process can supply several per-Standard readings while replay, defer, metric evaluation, verdicts, and diagnostics remain independent; [`standard_plan.ts`](../../../src/engine/gate/standard_plan.ts) is the live grouping authority.

**Status**: accepted. Extends [ADR 0133](0133-standards-join-the-gate.md), [ADR 0105](0105-interruption-reaches-detached-gate-jobs.md), [ADR 0108](0108-gate-job-timeout.md), and [ADR 0112](0112-standard-measurement-receipt.md).

## Context

The gate and standalone `standards` verb ran the same command through different paths. The gate put measurements in its parallel job group. Each job had process-tree cancellation, global and per-standard timeouts, buffered diagnostics, and a duration. Standalone execution looped serially and called the shell helper directly. This left `measure = "on-demand"` with the weakest protection. Its timeout had no effect. Model Context Protocol (MCP) cancellation stopped at the server boundary. Wall time summed every measurement, and receipts omitted durations.

Trunk-limit verification also diverged. The gate read trunk config once and found both configured and deleted standards. Standalone execution reread trunk for each configured standard. Siblings could see different snapshots. It missed deleted standards and softened unreadable or malformed trunk failures. Fresh pin measurements and same-commit receipt reuse repeated those reads.

## Decision

One standard-job projection and evaluator serves both surfaces. It turns each planned standard into a scheduler job with its timeout. It evaluates captured metric output and records the value and duration. The gate places these jobs in its mixed check-and-test group. Standalone execution uses a standards-only parallel group with fail-fast off and buffered output. Each job inherits the global timeout and caller's `AbortSignal`. The runner alone owns process spawning, watchdogs, external cancellation, and process-tree kill.

Standalone execution still measures every configured standard fresh, including `measure = "on-demand"`. It does not adopt the gate's input-keyed replay or deferral policy. Pin may still reuse a complete green receipt for the same clean commit, preserving the measure-once check-to-pin flow.

Every non-dry standalone invocation computes Tier 1 once before measurement. The plain check, fresh pin measurement, and pin receipt replay all consume that snapshot. A loosened standard fails structurally and skips its command. Every unblocked standard still measures. Deleted standards and malformed trunk config become explicit failures without short-circuiting those jobs. An unreadable trunk remains non-blocking, and the verb warns with `UNVERIFIED`.

Standalone labels, `measured <value>` notes, reproduce commands, captured failure output, and result-envelope shapes remain stable. Measurement failures use the common job diagnostic path, including genuine timeout diagnostics. A green plain run records values and scheduler durations. A red or cancelled run clears the receipt.

## Consequences

Several independent standards complete in roughly the time of the slowest one. Per-standard timeouts behave identically in `done`, terminal `standards`, JSON, pin measurement, and remote calls. Cancelling a remote request reaches the runner and kills the detached command tree instead of leaving an orphan.

One trunk read gives every standard in an invocation a consistent never-loosen view and makes deleted standards visible outside the gate. Structural failures do not suppress unrelated measurement evidence, and measurement failures do not cancel siblings.

The standalone verb now depends on the gate's generic planning, scheduling, and serialization seams. This intentional coupling applies timeout, cancellation, and diagnostic changes to both surfaces through one implementation. Human output waits for envelope rendering, so parallel output never interleaves.

## Alternatives considered

- **Add `Promise.all`, timeouts, and signals around the standalone shell loop.** Rejected because it would duplicate the runner's scheduling, kill escalation, output capture, and diagnostic semantics, allowing the paths to drift again.
- **Route standalone execution through the gate's action resolver.** Rejected because replay and deferral would violate the verb's explicit fresh-measurement contract; standalone standards exists to run on-demand measurements.
- **Abort measurements when Tier 1 or the first measurement fails.** Rejected because the standalone verb is an iteration and reporting tool. It must return every available result, while skipping only the command whose configured limit is already structurally invalid.
