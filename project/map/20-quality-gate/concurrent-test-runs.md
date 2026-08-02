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

Sibling worktrees share one machine. When one suite already fills it, overlapping suites only slow each other. Set a fleet cap:

```toml
[gate]
concurrent_test_runs = 1
```

`0`, the default, disables the cap. Use `1` when one suite fills the machine; each then runs at full speed in turn.

## What the cap counts

One slot covers a whole test-stage group: `done`, `test`, the `standards` measurement pass, or acceptance's landing-checkout smoke. Test-runner worker parallelism is unchanged. Fix and check stages never wait; a capped `done` checks first so a broken check fails before admission ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Wrap direct test invocations

Gate verbs acquire automatically. Wrap a direct test command with:

```sh
discern queue -- <command> [args...]
```

Put that boundary in the canonical test task so full and targeted forms are capped by construction:

```text
test: discern queue -- your-test-runner --single-run
```

`queue` holds one slot for the child's lifetime and preserves its arguments, streams, interrupts, and status. With a zero or absent cap, or without `discern.toml`, it touches no slot files. Unusable slots warn once, then run uncapped.

The gate sets `DISCERN_TEST_SLOT=1` when it has accounted the cap, including after fail-open. Both the gate and `queue` treat any non-empty marker as upstream accounting. Every wrapper passes `1` onward. Gate-to-wrapper, wrapper-to-gate, and wrapper-to-wrapper nesting therefore consume one slot. The advisory marker establishes cooperative back-pressure. It cannot enforce a security boundary ([ADR 0252](../_adr/0252-fleet-test-run-cap-at-test-command-boundary.md)).

The wrapped task should remain the canonical test command.[^raw-test-task]

[^raw-test-task]: An environment that cannot install discern may keep a separately named raw task. The wrapped form remains the default.

## What a queued run looks like

The run explains its wait once:

```text
Tests queued: 1 of 1 concurrent test runs in use across this repository's
checkouts ([gate].concurrent_test_runs); the tests start the moment a slot
frees. In flight: done on agent/fix-upload-retry, typically ~3m.
```

The [logbook](patterns.md) supplies names and the duration estimate; disabling it omits both. The same text reaches result `hints[]`, including JSON and Model Context Protocol surfaces. A passing queued run stays green, with the wait in its recorded duration.

## Crash safety

A slot is an OS advisory lock under the shared git administrative directory. Process death releases it without a daemon, heartbeat, or cleanup step ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Where it lives in code

| Concern                           | Source                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Slot primitive and wait policy    | [`test_run_slots.ts`](../../../src/engine/test_run_slots.ts)                                                                           |
| Gate and wrapper presentation     | [`test_slots.ts`](../../../src/engine/gate/test_slots.ts), [`queue.ts`](../../../src/engine/queue.ts)                                  |
| Plan split and the enrolment seam | [`plan.ts`](../../../src/engine/gate/plan.ts), [`execute.ts`](../../../src/engine/gate/execute.ts)                                     |
| The config key                    | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                             |
| Behavioral coverage               | [`engine_gate_slots_test.ts`](../../../tests/engine_gate_slots_test.ts), [`engine_queue_test.ts`](../../../tests/engine_queue_test.ts) |

## Current state & gotchas

- Advisory locks do not promise fairness. The cap bounds concurrency, while arrival order may vary.
- During a config transition, the loosest branch value in flight wins until branches converge.
- Slot files stay in place to preserve lock identity; files above a lowered cap are inert.
