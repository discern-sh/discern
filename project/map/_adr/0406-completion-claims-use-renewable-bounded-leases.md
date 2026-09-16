# ADR 0406: Completion claims use renewable bounded leases

**Status**: accepted on 2026-09-16.

## Context

A completion attempt keeps a durable fencing token while it plans demand, runs producers, and publishes evidence and Proof. The former expiry added every configured producer, extractor, and procedure timeout into one presumed maximum runtime. A large project therefore received a multi-hour claim. More importantly, selection treated any unfinished claim as active without applying its expiry, so a process killed outside `finally` could leave the repository blocked indefinitely even after the operating-system checkout lock disappeared.

Legitimate gates have no useful absolute maximum: their duration depends on the project and may exceed any estimate. At the same time, a replacement must not publish concurrently with an old executor that merely appears slow. Recovery therefore needs a current liveness signal and a durable fencing transition, not a larger timeout.

## Decision

An unfinished completion attempt holds a 60-second renewable lease, independent of project job and gate timeouts. Its live coordinator renews the same fencing token every 20 seconds. Renewal stops and drains before the attempt settles, so a heartbeat cannot race the terminal `passed`, `failed`, or `cancelled` transition. Lease-only revisions update the current record atomically but are not retained as semantic attempt history.

The attempt executor records its progress-journal handle when one is available. Before reserving another attempt, `done` and committed standards measurement inspect every unfinished attempt. A journal whose exact executor is gone permits immediate recovery. Otherwise, a missed lease renewal permits recovery when the bounded lease expires. Recovery compare-and-swaps the old attempt to `cancelled` before the replacement receives a new attempt and token; the old fence can no longer publish. Version-1 claims written before this decision remain readable, and their effective expiry is clamped to 60 seconds after acquisition or their last recorded renewal.

There is no long absolute runtime fence and no timeout-derived backstop. A healthy operation may renew for as long as its work genuinely runs. An unresolved current claim reports one pending cause, its attempt identity and progress handle, and the exact reconnect action; it does not report a failed check or test stage.

## Consequences

An executor whose journal reports it gone can be replaced immediately. When journal liveness is unavailable, an abandoned owner delays the next attempt by at most one minute rather than hours or forever. A live owner remains protected, and losing renewal aborts its remaining work before its fence expires.

Long operations perform a small atomic current-record write every 20 seconds. Those writes are deliberate liveness overhead; suppressing heartbeat history prevents them from creating an unbounded archive. The operation journal accelerates a definitive dead-owner decision, but a running process identifier is not treated as identity proof and cannot extend ownership without renewal.

## Alternatives considered

**Derive one lease from configured timeouts.** Rejected because those budgets bound individual work, not ownership recovery, and their sum turns project size into lockout duration.

**Keep a fixed multi-hour maximum as a safety backstop.** Rejected because an arbitrary maximum can expire under legitimate work while still making crash recovery unacceptably slow.

**Rely only on operating-system locks or journal process probes.** Operating-system locks remain right for transient capacity slots, but they do not invalidate the durable publication token. Journal probes can prove that a recorded process is gone, not that a reused process identifier is the original executor. The renewable lease supplies the bounded authority boundary in both cases.
