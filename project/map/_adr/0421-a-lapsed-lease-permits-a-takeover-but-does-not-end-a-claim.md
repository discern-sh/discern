# ADR 0421: A lapsed lease permits a takeover but does not end a claim

**Status**: accepted on 2026-10-02. Amends [ADR 0406](0406-completion-claims-use-renewable-bounded-leases.md).

## Context

`discern done` crashed with `Completion attempt settlement claim-lost` when its terminal stopped reading for longer than the 60-second attempt lease. Narration is written synchronously, so a terminal that stops reading blocks the write and the event loop with it. The 20-second renewal cannot fire. When the loop resumed, the overdue renewal compared the lease's expiry with the clock, declared the claim lost, and cancelled the run; settlement then made the same comparison and failed. No other run had touched the attempt record: it still named the run's token, last renewed 20 seconds after it started.

The reproduction runs `discern done` under `script(1)` with a format job that sleeps 150 seconds and pipes it into a reader that sleeps 240 seconds. A sleeping machine, a stopped process, or any long synchronous stall has the same effect.

[ADR 0406](0406-completion-claims-use-renewable-bounded-leases.md) made a lapsed lease permit recovery: another run retires the attempt by compare-and-swap before it reserves a replacement. The owner's own steps went further and treated the lapse itself as the retirement. Renewal, demand binding, the producer pre-check, Proof assembly, fenced publication, and settlement each read the lease.

## Decision

**The attempt record is the only authority on ownership.** A claim is held while its record is unfinished and names the fence's token. Only a transition written to the record ends the claim: another run's retirement or the attempt's own settlement. A lapsed lease permits a retirement and nothing more.

**Every claim-dependent step checks the record, not the clock.** Fenced publication and settlement re-read ownership under the publication lock and compare-and-swap the record. Renewal extends whatever lease the record still names. Binding, the producer pre-check, and Proof assembly use the same ownership test. Each step succeeds after a stall when nobody retired the attempt meanwhile, and each refuses with `claim-lost` only when the record is finished or names another token. A publication that does not match its attempt's binding is refused with its own reason, because it proves nothing about the claim. The record store reads no clock.

**Only proven loss ends a run.** A busy lock, a lost compare-and-swap race, or a missing or unreadable record proves nothing, so the coordinator retries on its next interval and keeps the run going. When the record proves a retirement, the run stops. Whichever step finds it, the run's outcome is the retirement. The claim coordinator reports a retired run as retired, whatever the run returned or raised, so no step's own blocker stands in for it. `done` and committed standards measurement both end as cancelled with the other run named as the reason. Settlement always re-reads the record, so a step that met the retirement without naming it ends the same way. The retirement already closed the attempt, so settlement records nothing there.

**A pass publishes its Proof in the transition that settles it.** Renewal, settlement, and recovery each read the attempt record and compare-and-swap it inside one publication. A passing run writes its Proof inside its settlement's publication, after it re-reads its claim. A retirement therefore lands before both, and the Proof is never written, or it finds the attempt already finished. Without this, a resumed owner could publish its Proof between a recovery's read and its write, and the retirement would orphan that Proof.

**Renewal does not survive a stalled event loop.** A heartbeat that outlived the stall would let a run that is not progressing hold its claim. A terminal paused with Ctrl-S blocks output for as long as it stays paused, and such a claim would stop every other run from retiring it — the condition the bounded lease exists to end. A process-wide stall such as sleep stops every thread anyway, so only checking the record covers the whole class. A stall now costs something only when another run retires the attempt during it. Recovery is repository-wide: any `done` or committed standards measurement, in any worktree, retires every lapsed attempt before it reserves its own. The retiring run usually works on another candidate, so nothing takes over the retired work; its owner runs the command again.

**Lease arithmetic stays in the claim model.** [`attempt.ts`](../../../src/engine/completion/attempt.ts) owns the lease length, the stored timestamps, the expiry, the ownership test, and the takeover test. [`completion_attempt_lease_guard_test.ts`](../../../tests/completion_attempt_lease_guard_test.ts) fails when production code elsewhere reads a claim's lease, except to report its expiry.

## Consequences

- A run that stalls past its lease finishes and records Proof when nothing retired it meanwhile. In the reproduction, the attempt record went 219 seconds without a renewal, then renewed and settled as passed.
- A retirement during a stall reaches the user of `done` or `discern standards` as a cancelled run with its reason. It never appears as a crash, as stale or missing evidence, or as a refused publication. Receipts published before the retirement stay recorded and reusable.
- An attempt still settles once: settlement compare-and-swaps an unfinished record to finished, and a finished record never reopens.
- Crash recovery keeps its bound. Recovery still retires a claim whose lease lapsed or whose recorded owner is gone, one lease at most after the owner stopped renewing.
- Every attempt transition reads and writes the record inside one publication, so of a renewal, a settlement, and a retirement, exactly one lands first and the others see it. A retired attempt cannot publish, and no Proof outlives a retirement of its attempt.
- A record that stays unreadable no longer cancels a run after one lease. The run continues, and its next publication or settlement reports the store failure.
- The reproduction needs over a minute of real time, so it stays outside the suite. [`completion_attempt_lease_test.ts`](../../../tests/completion_attempt_lease_test.ts) advances an injected clock past the lease and then fires the overdue heartbeat, which is what a resumed loop does. It covers no retirement, a retirement, a renewal that lands before the retirement's write, and a Proof racing a retirement. [`completion_attempt_retirement_test.ts`](../../../tests/completion_attempt_retirement_test.ts) retires a real `done` and a real measurement just before each claim-dependent step.

## Alternatives considered

**Lengthen the lease.** Rejected: a terminal can stop reading for any length of time, and a longer lease delays recovery from a crashed owner by the same amount.

**Renew from a worker thread.** Rejected: it keeps a wedged run's claim alive and cannot cover a process-wide stall. Renewal also takes the publication lock, whose in-process queue and lock context belong to the main thread.

**Write narration without blocking.** Rejected: while the terminal is not reading, output must either fill an unbounded buffer or be dropped, and a stall from any other cause would still lapse the lease.

**Take a fresh claim after a stall.** Rejected: a new token breaks the fence that binds published evidence to its attempt, and the record already says whether the original claim survives.
