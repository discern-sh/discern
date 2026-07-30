---
title: Awaiting the fleet
description: Block until a sibling branch is green, its work lands, or the trunk moves — one call instead of guessed polling.
order: 60
aliases:
  - discern await
  - await a sibling
  - wait for a branch
  - fleet coordination
---

# Awaiting the fleet

_One bounded call answers "is the work I depend on ready?" — and says when to ask again if not._

A dependent task used to poll `discern status` on a guessed interval or wait for a human relay. `discern await` replaces the loop: it blocks until a fleet condition holds, then reports what it observed and the next step.

## The three conditions

Pass one condition per call:

| Condition           | Holds when                                                                           | Grounded in          |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------- |
| `--green <branch>`  | The branch's worktree holds an honored gate receipt (a watched landing also counts). | The gate receipt     |
| `--landed <branch>` | The branch's work — its tip at call start — is reachable from the trunk.             | Git ancestry         |
| `--trunk-moved`     | The trunk ref differs from its position at call start.                               | The trunk ref itself |

Every verdict comes from authoritative state: a git ancestry read or a receipt inspection. The logbook receives one append per verb completion anywhere in the fleet. It only wakes the wait early and prices the retry advice. Recorded history never decides truth ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md), [ADR 0213](../_adr/0213-await-blocks-on-authoritative-fleet-conditions.md)).

`--landed` pins the tip sha at call start, so it remains answerable after acceptance deletes the branch. A missing branch is a refusal that names both readings: not started yet, or landed and cleaned up.

Use `--green` for work in flight and `--landed` for arrival. A post-landing `--landed` call answers immediately. `--green` does not treat a freshly forked branch's trivially reachable tip as proof.

`--green` also refuses when no checkout holds the branch at call start. A gate receipt is per-worktree state and dies with the checkout, so a [reclaimed](reclaiming-contained-worktrees.md) train stage can never present one again. The refusal points at the nearest containing branch and at `--landed` for the literal arrival question.

## Timing out is an answer

A supplied `--timeout` is an exact bound. Omit it and `await` chooses a bound from this repository's logbook:

- Active work with completed samples uses the verb's observed P90 duration minus elapsed time, with a 30-second floor. The condition still returns early.
- Active work with no completed sample gets a 600-second first-run bound.
- No active work gets 300 seconds. Turning the logbook off uses the labelled fallback.

Timing sees concurrent branch actions separately and ignores the `await` invocation, which cannot complete its own condition. An underlying `done` can therefore price the call even though `await` began later. Among actions with duration evidence, the longest estimated remainder sets the bound.

Every result reports the bound in `data.timeout_seconds` and its source in `data.timeout_basis`. On expiry, the envelope remains `ok: true` with `data.met: false`, the authoritative state, and a priced `data.retry_after_seconds`. That field gives the length of another wait, so invoke the returned command immediately. `data.running` names the action, branch, and elapsed time. With samples, it adds the median, P90, and count.

The command-line interface (CLI) exits `0` when the condition holds, `1` on a refusal, and `124` on "not yet", so this composes in a shell:

```sh
discern await --landed agent/upload-retry && discern update
```

CLI and Model Context Protocol (MCP) use the same evidence-priced default ([ADR 0227](../_adr/0227-await-bounds-follow-repository-evidence.md)). A caller with a tighter request budget can pass its own bound. `--timeout 0` checks once and answers immediately.

## Compose below the trunk

The landing model's pull axis ([ADR 0110](../_adr/0110-the-landing-model.md)) makes `await` the coordination half of multi-wave delegation. A dependent brief reads: wait for the sibling to go green, then build on its unlanded branch —

```sh
discern await --green agent/upload-retry
discern update --from agent/upload-retry
```

— and when the condition fires, the result's hint names that exact follow-up: `update --from <branch>` after a green receipt, plain `discern update` after a landing or a trunk move. A met landing also previews what the update would bring in: how far behind this worktree sits and which of its own files the incoming work touched — the hot zone to re-read.

The wait itself is visible fleet activity: `await` is a begin-recorded verb, so while it holds, the blocked branch's fleet row in `discern status` reads `running: await`. That compact row answers what the branch is doing now. In a timed-out result, `data.running` answers a different question: which underlying action priced the wait. It can therefore report `done` while status reports `await`.

## Where it lives in code

| Responsibility                            | Source                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Conditions, wait loop, and timing advice  | [`src/engine/await/await.ts`](../../../src/engine/await/await.ts)       |
| Timing floors and evidence-free fallbacks | [`src/engine/await/defaults.ts`](../../../src/engine/await/defaults.ts) |
| Behavioural coverage                      | [`tests/engine_await_test.ts`](../../../tests/engine_await_test.ts)     |

## Current state and gotchas

- `await` blocks only its own caller. It gates nothing, holds no locks, and keeps no state beyond its process.
- With `[project].logbook = false` every condition still works through the polling fallback; only the retry advice degrades, and the result says so.
- A client can still cancel an MCP request before discern's chosen bound. The server cannot raise a caller-owned request budget; pass `timeout` when that client needs a shorter slice.
