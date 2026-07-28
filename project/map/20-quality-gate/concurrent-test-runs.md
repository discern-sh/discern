---
title: The fleet test-run cap
description: Cap how many test-stage runs execute at once across every checkout of the repository with [gate].concurrent_test_runs.
order: 55
aliases:
  - concurrent_test_runs
  - test slots
  - fleet test-run cap
---

# The fleet test-run cap

_`[gate].concurrent_test_runs` bounds how many test-stage runs execute at once across the main checkout and every linked worktree._

Parallel agents in sibling worktrees share one machine, and a real test suite can saturate it on its own. Two suites at once slow each other down more than a queue would. Set the cap, and a run arriving past it waits for a slot before its tests start, then continues the moment one frees:

```toml
[gate]
concurrent_test_runs = 1
```

`0`, the default, means no cap. On a machine whose suite already uses every core, `1` is the strongest choice: each suite runs at full speed, one after another.

## What the cap counts

Whole test-stage runs: `discern done`'s and `discern test`'s test group, `discern standards`' measurement pass (a coverage measurement re-runs the suite under instrumentation), and the landing-checkout smoke job during `discern accept`. A run's own test-runner worker parallelism is unchanged.

Fix and check stages never wait. Under a cap, `discern done` runs its check stage ahead of the test group, so a broken check fails fast while the queue is still ahead of it ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## What a queued run looks like

The run says why it is waiting, once:

```text
Tests queued: 1 of 1 concurrent test runs in use across this repository's
checkouts ([gate].concurrent_test_runs); the tests start the moment a slot
frees. In flight: done on agent/fix-upload-retry, typically ~3m.
```

The in-flight names and the duration estimate come from the [logbook](patterns.md); with `[project].logbook = false` the line lacks them. The same text joins the result's `hints[]`, so `--json` and Model Context Protocol callers see it too. A queued run that then passes is an ordinary green run, and its recorded duration includes the wait.

## Crash safety

A slot is an OS advisory file lock on a content-free file under the repository's shared git administrative directory. The kernel releases the lock when its holding process dies, so a killed or crashed run frees its slot with no daemon, no heartbeat, and no cleanup step ([ADR 0212](../_adr/0212-fleet-test-run-cap-os-lock-slots.md)).

## Where it lives in code

| Concern                           | Source                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Slot primitive and the wait line  | [`test_slots.ts`](../../../src/engine/gate/test_slots.ts)                                          |
| Plan split and the enrolment seam | [`plan.ts`](../../../src/engine/gate/plan.ts), [`execute.ts`](../../../src/engine/gate/execute.ts) |
| The config key                    | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                         |
| Behavioral coverage               | [`engine_gate_slots_test.ts`](../../../tests/engine_gate_slots_test.ts)                            |

## Current state & gotchas

- Advisory locks offer no queue fairness: under heavy contention a waiter can be overtaken. The cap bounds concurrency, not arrival order.
- Branches carrying different cap values probe different slot counts, so during a config transition the loosest value in flight wins. This converges as branches take the trunk's value.
- Slot files are never deleted (re-creating one would split its lock); files left behind by a lowered cap are inert.
