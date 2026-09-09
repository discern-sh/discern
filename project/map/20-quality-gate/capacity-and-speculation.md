---
title: Validation capacity and early validation
description: How completion.concurrency, gate.concurrent_test_runs, execution capacity, and lookahead combine, and why early validation may stay off.
order: 125
aliases:
  - completion concurrency
  - lookahead
  - speculation
  - early validation
  - execution capacity
---

# Validation capacity and early validation

_Concurrency, the test cap, and environment capacity bound different work. `lookahead` asks for early validation; it runs only when a declared environment and a spare slot exist._

## The four settings

| Setting                       | What it bounds                                                                      | What happens at the limit                            |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `[completion].concurrency`    | Efforts holding a validation slot at once, across every checkout.                   | A later `done` waits for a slot to free.             |
| `[gate].concurrent_test_runs` | Test stages running on this machine at once.                                        | The test stage queues; other checks continue.        |
| `[execution.<name>].capacity` | Checkouts prepared for a commit other than their own, in that declared environment. | Early validation waits for an environment to return. |
| `[completion].lookahead`      | Efforts past the next one to land that may validate before their predecessors land. | The effort waits for a predecessor to land.          |

One completion slot stays reserved for the effort landing next whenever a later effort asks. Early validation therefore needs `concurrency` of at least 2. Validating an effort's own commit never occupies an environment slot; only installing a different commit does.

The settings may legitimately differ. This repository runs two validations at once, allows two test stages, declares one environment with capacity 2, and looks one effort ahead: two `done` runs overlap fully, and one effort past the next landing may validate early, one at a time.

## Ordering is the default

With `lookahead = 0`, efforts validate their own commits and land in turn. After the trunk moves, the owning effort runs `discern update` and `discern done`. No environment declaration is needed.

## When early validation runs

Early validation needs `lookahead` above 0, a spare non-head slot, and a proved `[execution.<name>]` declaration for every context in `[completion].required_contexts`, all at once. A positive `lookahead` alone changes nothing; `discern doctor` reports it as requested but not operational, and setup's completion report says why.

A declaration is the project's evidence that a checkout can be prepared for another commit and returned to source-ready state. `discern setup done` proves it in the throwaway worktree it already creates: the [environment probe](../../../src/engine/execution/probe.ts) enrolls the copy as a borrowed environment, installs a commit whose tree differs from the source, and drives the real executor through a passing validation, a failing one, and one cancelled while a project command is still running. Each return must restore the exact branch, head, and index, remove the probe's own files, stop every recorded child process, and leave every ignored file the declaration covers byte-identical to the source. Git cleanliness alone cannot pass it. A failed probe is its own completion stage; the marker rolls back and the recovery names the procedure to fix or the `lookahead` to clear. When the copy could not return, the probe keeps its worktree and the recovery names `discern done --recover` for it, because only that command may finish a recorded return.

The proof is recorded once per context in the [environment proof record](../../../src/engine/execution/probe_record.ts), bound to the declaration's own identity rather than a commit. Early validation reads it: a later effort inside `lookahead` is refused with the route while its declaration is unproved, and the head effort's own validation is unaffected. `discern doctor` says whether each declaration is proved, changed since it was proved, or never rehearsed, and `discern setup done` replays a proved setup only while every declaration is still proved; otherwise it validates the marker again, probe included. Isolated declarations are never rehearsed by setup; they are reported, not probed.

## Where the facts come from

[`capacity_facts.ts`](../../../src/engine/completion/capacity_facts.ts) derives the combined effect of the four settings for a requested number of simultaneous runs and states which one binds. Doctor's `completion capacity` check and setup's completion report both read it, so the two surfaces cannot disagree. The enforcing code stays where it was: [`claims.ts`](../../../src/engine/landing_queue/claims.ts) reserves the head slot, [`test_run_slots.ts`](../../../src/engine/test_run_slots.ts) holds the test cap, and [`registry.ts`](../../../src/engine/execution/registry.ts) counts environment occupancy from live records.

Configuration describes permission, not headroom. A configured slot says a run may start; it does not say the machine can carry it. Measure CPU, memory, and existing load before raising the limits, and treat a wait reported by `done` as the binding setting doing its job. [The fleet test-run cap](concurrent-test-runs.md) covers the queued-test experience; [Execution recovery](../30-worktrees/execution-recovery.md) covers a checkout that did not return.
