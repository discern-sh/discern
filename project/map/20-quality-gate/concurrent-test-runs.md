---
title: The fleet test-run cap
description: Cap how many test-stage runs execute at once across every checkout of the repository with [gate].concurrent_test_runs.
order: 110
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

`0`, the default, disables the cap.

## What the cap counts

One slot covers a test-stage group: `done`, `test`, a `standards` measurement, or acceptance's landing-checkout smoke. Runner workers remain unchanged. Fix and check stages never wait, so a broken check fails before admission ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Wrap direct test invocations

Gate verbs acquire automatically. Wrap the project's canonical test command so direct full and targeted runs also count:

```sh
discern queue -- <command> [args...]
```

`queue` holds one slot for the child's lifetime and preserves its arguments, streams, interrupts, and status. A missing or zero cap touches no slot files. Unusable slots warn once, then run uncapped.

`DISCERN_TEST_SLOT=1` means an ancestor accounted for the cap, including after fail-open. Any non-empty marker suppresses another acquisition and passes onward, so every nesting direction consumes one slot. The marker provides cooperative back-pressure. It cannot enforce a security boundary ([ADR 0252](../_adr/0252-fleet-test-run-cap-at-test-command-boundary.md)).[^raw-test-task]

[^raw-test-task]: Without discern, keep a separately named raw task. Default to the wrapper.

## What a queued run looks like

A waiting run names its holder:

```text
Tests queued: 1 of 1 concurrent test runs in use across this repository's
checkouts ([gate].concurrent_test_runs); the tests start the moment a slot
frees. In flight: queue on agent/profile-tests, typically ~3m.
```

The [logbook](patterns.md) begins an unmarked `queue` before admission and completes it after the child. Marker bypass writes no duplicate. Recording off omits the holder and estimate. Result `hints[]` carries the notice over JSON and Model Context Protocol.

Timing stays split:

- `duration_ms`: end-to-end wall time.
- `waited_ms`: summed slot wait; `0` for immediate capped admission, absent for uncapped and older events.
- execution time: `duration_ms - (waited_ms ?? 0)`, used by duration priors.

Positive waits sit beside step timings:

```text
Tests passed.

Waited 1m 10s for a test-run slot.
```

This preserves end-to-end duration and replaces the combined prior ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md), [ADR 0252](../_adr/0252-fleet-test-run-cap-at-test-command-boundary.md)).

## Crash safety

Slots are OS advisory locks under the shared git directory. Process death releases them without a daemon or cleanup ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Where it lives in code

| Concern                           | Source                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Slot primitive and wait policy    | [`test_run_slots.ts`](../../../src/engine/test_run_slots.ts)                                                                           |
| Gate and wrapper presentation     | [`test_slots.ts`](../../../src/engine/gate/test_slots.ts), [`queue.ts`](../../../src/engine/queue.ts)                                  |
| Plan split and the enrolment seam | [`plan.ts`](../../../src/engine/gate/plan.ts), [`execute.ts`](../../../src/engine/gate/execute.ts)                                     |
| The config key                    | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                             |
| Behavioral coverage               | [`engine_gate_slots_test.ts`](../../../tests/engine_gate_slots_test.ts), [`engine_queue_test.ts`](../../../tests/engine_queue_test.ts) |

## Current state & gotchas

- Advisory locks bound concurrency without promising arrival order.
- During config transitions, the loosest in-flight cap wins.
- Slot files persist for lock identity; excess files are inert.
