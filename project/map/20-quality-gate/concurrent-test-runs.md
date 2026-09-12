---
title: The fleet test-run cap
description: Cap how many test-stage runs execute at once across every checkout of the repository with [gate].concurrent_test_runs.
order: 120
aliases:
  - concurrent_test_runs
  - test slots
  - fleet test-run cap
---

# The fleet test-run cap

_`[gate].concurrent_test_runs` bounds how many test-stage runs execute at once across the main checkout and every linked worktree._

Linked worktrees share one machine. Set `1` when one suite fills it:

```toml
[gate]
concurrent_test_runs = 1
```

Fresh projects default to `1`, so their test stages cannot race one another across linked worktrees. An explicit `0` disables the cap. This repository explicitly uses `2`.

## What the cap counts

A validation run acquires one slot when its first demanded test or measurement producer is ready to execute. Independent checks can run while that demand waits; a failing check cancels queued work when fail-fast is enabled. Dependencies come from the producer graph, so the capacity cap cannot make an unrelated check block extraction. A check that explicitly observes the accounting marker also needs admission. `prepare` requests no measurement. The shared gate and queue adapters retain the host-cap policy ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Wrap direct test invocations

Gate verbs acquire automatically. `[gate].concurrent_test_runs` is the capacity setting; nothing else bounds how many efforts validate at once. Wrap the project's canonical test command so direct full and targeted runs also count:

```sh
discern queue -- <command> [args...]
```

`queue` holds a slot for the child's lifetime and preserves its arguments, streams, interrupts, and status. A missing or zero cap touches no slot files. Unusable slots warn once, then run uncapped.

Nested gate and queue processes inherit an internal marker when an ancestor accounted for the cap, including after fail-open. A marked process skips another acquisition and passes the marker onward, so every nesting direction consumes one slot. This provides cooperative back-pressure. It cannot enforce a security boundary ([ADR 0252](../_adr/0252-fleet-test-run-cap-at-test-command-boundary.md)).[^raw-test-task]

[^raw-test-task]: Without discern, keep a separately named raw task. Default to the wrapper.

## What a queued run looks like

A waiting run names the slot holder:

```text
Tests queued: 1 of 1 concurrent test runs in use across this repository's
checkouts ([gate].concurrent_test_runs); the tests start the moment a slot
frees. In flight: queue on agent/profile-tests, typically ~3m.
```

The [Logbook](../70-reference/the-logbook.md) begins an unmarked `queue` before admission and completes it after the child. Marker bypass writes no duplicate. Recording off omits the holder and estimate. Result `hints[]` carries the notice over JSON and Model Context Protocol.

Timing stays split:

- `duration_ms`: end-to-end wall time.
- `waited_ms`: summed slot wait; `0` for immediate capped admission, absent for uncapped and older events.
- execution time: `duration_ms - (waited_ms ?? 0)`, used by duration priors.

Positive waits sit beside step timings:

```text
Tests passed.

Waited 1m 10s for a test-run slot.
```

`waited_ms` stays in the live result and logbook, outside Proofs and durable Proof notes ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)). End-to-end duration and execution-time priors remain separate ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md), [ADR 0252](../_adr/0252-fleet-test-run-cap-at-test-command-boundary.md)).

## Slot release after process exit

Slots are OS advisory locks under the shared git directory. Public validation retains process-signal ownership through child shutdown. Process death releases the advisory slot without a daemon or cleanup ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Where it lives in code

| Concern                            | Source                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Slot primitive and wait policy     | [`test_run_slots.ts`](../../../src/engine/test_run_slots.ts)                                                                           |
| Gate and wrapper presentation      | [`test_slots.ts`](../../../src/engine/gate/test_slots.ts), [`queue.ts`](../../../src/engine/queue.ts)                                  |
| Plan split and the enrollment seam | [`public_run.ts`](../../../src/engine/validation/public_run.ts), [`execute.ts`](../../../src/engine/gate/execute.ts)                   |
| The config key                     | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                             |
| Behavioral coverage                | [`engine_gate_slots_test.ts`](../../../tests/engine_gate_slots_test.ts), [`engine_queue_test.ts`](../../../tests/engine_queue_test.ts) |

## Current state & gotchas

- Advisory locks bound concurrency without promising arrival order.
- During config transitions, the loosest in-flight cap wins.
- Slot files persist for lock identity; excess files are inert.
